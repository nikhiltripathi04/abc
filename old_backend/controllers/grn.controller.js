const mongoose = require('mongoose');
const { GRN, GRN_STATUSES } = require('../models/GRN');
const InventoryItem = require('../models/InventoryItem');
const { Order } = require('../models/Order');
const Site = require('../models/Site');
const Warehouse = require('../models/Warehouse');
const eventBus = require('../core/eventBus');
const ActivityLogger = require('../utils/activityLogger');

// Internal helpers for item normalization
const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const normalizeItemNameMatch = (value) => normalizeText(value).replace(/\s+/g, '').toUpperCase();
const normalizeItemNameStore = (value) => normalizeText(value).toUpperCase();

const generateItemUid = async (warehouseId) => {
    for (let i = 0; i < 8; i += 1) {
        const candidate = `ITEM-${Math.floor(100000 + Math.random() * 900000)}`;
        const exists = await InventoryItem.exists({ warehouseId, uid: candidate });
        if (!exists) return candidate;
    }
    throw new Error('Unable to generate unique UID for new item.');
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const toObjectId = (value) => (mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null);
const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const toTrimmed = (value) => String(value || '').trim();

const safeUserName = (user) => user?.username || user?.fullName || 'Unknown';

const pushTimeline = (grn, { eventType, user, note = '' }) => {
    grn.timeline.push({
        eventType,
        actorId: user?._id,
        actorName: safeUserName(user),
        actorRole: user?.role || '',
        note,
        timestamp: new Date()
    });
};

const assertCompanyAccess = (user, companyId) => {
    if (!companyId || !user?.companyId) return false;
    return companyId.toString() === user.companyId.toString();
};

const canCreateGRN = (role) => ['admin', 'company_owner', 'supervisor', 'warehouse_manager'].includes(role);
const canAuthenticateGRN = (role) => ['admin', 'company_owner', 'warehouse_manager', 'supervisor'].includes(role);

// Generate GRN ID, optionally inheriting the suffix from an order ID
const generateGRNId = async (orderIdString = null) => {
    // If order based, try to extract the numeric suffix (e.g. from ORD-00000001 -> 00000001)
    if (orderIdString && typeof orderIdString === 'string') {
        const parts = orderIdString.split('-');
        if (parts.length > 1) {
            const suffix = parts[1];
            return `GRN-${suffix}`;
        }
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let i = 0; i < 10; i += 1) {
        const rand = Math.floor(1000 + Math.random() * 9000);
        const candidate = `GRN-${stamp}-${rand}`;
        // eslint-disable-next-line no-await-in-loop
        const exists = await GRN.exists({ grnId: candidate });
        if (!exists) return candidate;
    }
    throw new Error('Unable to generate GRN id. Please retry.');
};

const normalizeGRNItems = (items) => {
    if (!Array.isArray(items) || items.length === 0) {
        return { error: 'At least one item is required' };
    }

    const normalized = [];
    for (const raw of items) {
        const itemName = toTrimmed(raw.itemName);
        const uom = toTrimmed(raw.uom || 'pcs');
        const receivedQty = Math.max(0, toNumber(raw.receivedQty, 0));
        const dispatchedQty = Math.max(0, toNumber(raw.dispatchedQty, 0));
        const price = Math.max(0, toNumber(raw.price, 0));

        if (!itemName) return { error: 'Each item must include itemName' };
        if (!receivedQty) return { error: `receivedQty must be > 0 for item ${itemName}` };

        const discrepancy = receivedQty - dispatchedQty;

        normalized.push({
            itemName,
            inventoryItemId: toObjectId(raw.inventoryItemId) || undefined,
            uom,
            dispatchedQty,
            receivedQty,
            price,
            discrepancy,
            isNewItem: !!raw.isNewItem,
            remarks: toTrimmed(raw.remarks)
        });
    }

    return { items: normalized };
};

// Helper function to update inventory from GRN
const updateInventoryFromGRN = async (grn, user) => {
    try {
        if (grn.grnType === 'order_based' || grn.grnType === 'site' || (grn.siteId && !grn.orderId)) {
            // If GRN is for a site delivery (order-based or direct), update site supplies
            if (grn.siteId) {
                // Update site supplies
                const site = await Site.findById(grn.siteId);
                if (!site) {
                    throw new Error('Site not found');
                }

                for (const item of grn.items) {
                    const siteSupplyIndex = (site.supplies || []).findIndex(
                        (s) => String(s.itemName || '').trim().toLowerCase() === String(item.itemName || '').trim().toLowerCase()
                    );

                    if (siteSupplyIndex >= 0) {
                        const prevQty = toNumber(site.supplies[siteSupplyIndex].quantity, 0);
                        const newQty = prevQty + item.receivedQty;

                        site.supplies[siteSupplyIndex].quantity = newQty;
                        site.supplies[siteSupplyIndex].unit = item.uom;

                        if (item.price > 0) {
                            // Bootstrap totalCost for entries that predate this field:
                            // if totalCost is 0 but there is existing stock with a cost, seed from prevQty * existingCost
                            const existingAvgCost = toNumber(site.supplies[siteSupplyIndex].avgCost || site.supplies[siteSupplyIndex].cost, 0);
                            const preTotalCost = toNumber(site.supplies[siteSupplyIndex].totalCost, null);
                            const prevTotalCost = preTotalCost !== null
                                ? preTotalCost
                                : (prevQty > 0 && existingAvgCost > 0 ? prevQty * existingAvgCost : 0);

                            const batchCost = item.receivedQty * item.price;
                            const newTotalCost = prevTotalCost + batchCost;
                            const newAvgCost = newQty > 0 ? Math.round((newTotalCost / newQty) * 100) / 100 : item.price;

                            site.supplies[siteSupplyIndex].totalCost = newTotalCost;
                            site.supplies[siteSupplyIndex].avgCost = newAvgCost;
                            site.supplies[siteSupplyIndex].cost = newAvgCost; // keep cost in sync with avg
                            site.supplies[siteSupplyIndex].status = 'priced';
                        }
                    } else {
                        const supplyEntry = {
                            itemName: item.itemName,
                            quantity: item.receivedQty,
                            unit: item.uom,
                            addedBy: user._id,
                            addedByName: safeUserName(user)
                        };
                        if (item.price > 0) {
                            const batchCost = item.receivedQty * item.price;
                            supplyEntry.totalCost = batchCost;
                            supplyEntry.avgCost = item.price;
                            supplyEntry.cost = item.price;
                            supplyEntry.status = 'priced';
                        } else {
                            supplyEntry.status = 'pending_pricing';
                        }
                        site.supplies.push(supplyEntry);
                    }
                }
                await site.save();
            }
            // Mark inventory as updated even if it's a site GRN
            grn.inventoryUpdated = true;
            grn.inventoryUpdatedAt = new Date();
            await grn.save();
            return { success: true };
        }

        // Logic for warehouse GRNs
        const warehouse = await Warehouse.findById(grn.warehouseId);
        if (!warehouse) return { success: false, error: 'Warehouse not found' };

        for (const item of grn.items) {
            let inventoryItem = null;

            // 1. Try finding by ID
            if (item.inventoryItemId) {
                inventoryItem = await InventoryItem.findById(item.inventoryItemId);
            }

            // 2. If not found, look up by the indexed normalized name (O(log n), no full scan)
            if (!inventoryItem) {
                const matchKey = normalizeItemNameMatch(item.itemName);
                inventoryItem = await InventoryItem.findOne({
                    warehouseId: warehouse._id,
                    itemNameNormalized: matchKey
                });
            }

            // 3. If still not found, create new inventory item
            if (!inventoryItem) {
                const uid = await generateItemUid(warehouse._id);
                inventoryItem = await InventoryItem.create({
                    warehouseId: warehouse._id,
                    companyId: grn.companyId || user.companyId,
                    uid,
                    itemName: normalizeItemNameStore(item.itemName),
                    category: 'General', // Default category
                    uom: (item.uom || 'PCS').toUpperCase(),
                    availableQty: 0, // Will be updated below
                    entryPrice: item.price || 0,
                    currentPrice: item.price || 0,
                    currency: '₹', // Default currency
                    createdBy: user._id,
                    updatedBy: user._id
                });
            }

            // 4. Update quantity and price
            if (inventoryItem) {
                const qtyToAdd = parseFloat(item.receivedQty) || 0;
                const pricePerUnit = parseFloat(item.price) || 0;

                // Snapshot the previous qty BEFORE updating — needed for correct avg denominator
                const prevQty = inventoryItem.availableQty;

                // Concurrency-safe assignment (avoids read-modify-write race with +=)
                inventoryItem.availableQty = prevQty + qtyToAdd;
                const newQty = inventoryItem.availableQty;

                // Weighted average price — only update when a unit price is provided
                if (pricePerUnit > 0) {
                    // prevQty * prevAvgPrice gives the total value already in stock.
                    // When prevQty is 0 this correctly contributes 0, so any legacy avgPrice
                    // on an empty-stock item does not pollute the new average.
                    const prevAvgPrice =
                        inventoryItem.avgPrice ??
                        inventoryItem.currentPrice ??
                        inventoryItem.entryPrice ??
                        0;

                    const prevTotalPrice = prevQty * prevAvgPrice;
                    const batchCost = qtyToAdd * pricePerUnit;
                    const newTotalPrice = prevTotalPrice + batchCost;

                    const newAvgPrice =
                        newQty > 0
                            ? Math.round((newTotalPrice / newQty) * 100) / 100
                            : pricePerUnit;

                    inventoryItem.totalPrice = newTotalPrice;
                    inventoryItem.avgPrice = newAvgPrice;
                    inventoryItem.currentPrice = newAvgPrice; // keep currentPrice in sync

                    if (!inventoryItem.entryPrice) {
                        inventoryItem.entryPrice = pricePerUnit;
                    }
                }

                inventoryItem.updatedBy = user._id;
                await inventoryItem.save();

                // 5. Sync to warehouse.supplies (for legacy support/dashboard display)
                const existingSupplyIndex = warehouse.supplies.findIndex(
                    (s) => normalizeItemNameMatch(s.itemName) === normalizeItemNameMatch(inventoryItem.itemName)
                );

                const mappedSupply = {
                    itemName: inventoryItem.itemName,
                    quantity: inventoryItem.availableQty,
                    unit: inventoryItem.uom,
                    currency: inventoryItem.currency || '₹',
                    entryPrice: inventoryItem.entryPrice || 0,
                    currentPrice: inventoryItem.currentPrice || inventoryItem.entryPrice || 0,
                    addedBy: user._id
                };

                if (existingSupplyIndex >= 0) {
                    warehouse.supplies[existingSupplyIndex] = {
                        ...warehouse.supplies[existingSupplyIndex],
                        ...mappedSupply
                    };
                } else {
                    warehouse.supplies.push(mappedSupply);
                }
            }
        }

        await warehouse.save();

        grn.inventoryUpdated = true;
        grn.inventoryUpdatedAt = new Date();
        await grn.save();

        return { success: true };
    } catch (error) {
        console.error('Error updating inventory from GRN:', error);
        return { success: false, error: error.message };
    }
};

// Create standalone GRN
exports.createGRN = async (req, res) => {
    try {
        const user = req.user;
        if (!canCreateGRN(user.role)) {
            return res.status(403).json({ success: false, message: 'You are not allowed to create GRN' });
        }
        if (!user.companyId) {
            return res.status(403).json({ success: false, message: 'User is not mapped to a company' });
        }

        const {
            siteId,
            warehouseId,
            receivingFrom = 'vendor_direct',
            vendorName,
            items,
            photos,
            remarks
        } = req.body;

        if (!siteId && !warehouseId) {
            return res.status(400).json({ success: false, message: 'Either siteId or warehouseId is required as destination' });
        }
        if (siteId && warehouseId) {
            return res.status(400).json({ success: false, message: 'GRN cannot be for both a site and a warehouse' });
        }

        let site = null;
        let warehouse = null;

        if (siteId) {
            if (!mongoose.isValidObjectId(siteId)) {
                return res.status(400).json({ success: false, message: 'Invalid siteId' });
            }
            site = await Site.findById(siteId).select('siteName companyId');
            if (!site) return res.status(404).json({ success: false, message: 'Site not found' });
            if (!assertCompanyAccess(user, site.companyId)) {
                return res.status(403).json({ success: false, message: 'Site does not belong to your company' });
            }
        }

        if (warehouseId) {
            if (!mongoose.isValidObjectId(warehouseId)) {
                return res.status(400).json({ success: false, message: 'Invalid warehouseId' });
            }
            warehouse = await Warehouse.findById(warehouseId).select('warehouseName companyId');
            if (!warehouse) return res.status(404).json({ success: false, message: 'Warehouse not found' });
            if (!assertCompanyAccess(user, warehouse.companyId)) {
                return res.status(403).json({ success: false, message: 'Warehouse does not belong to your company' });
            }
        }

        const normalizedItems = normalizeGRNItems(items);
        if (normalizedItems.error) {
            return res.status(400).json({ success: false, message: normalizedItems.error });
        }

        // Determine status based on creator role
        const isWarehouseManager = ['admin', 'company_owner', 'warehouse_manager'].includes(user.role);
        const status = isWarehouseManager ? 'authenticated' : 'pending_authentication';

        const grnData = {
            grnId: await generateGRNId(),
            grnType: 'standalone',
            companyId: user.companyId,
            createdBy: user._id,
            createdByName: safeUserName(user),
            createdByRole: user.role,
            receivingFrom,
            vendorName: toTrimmed(vendorName),
            items: normalizedItems.items,
            photos: Array.isArray(photos) ? photos : [],
            remarks: toTrimmed(remarks),
            status
        };

        if (site) {
            grnData.siteId = site._id;
            grnData.siteName = site.siteName;
        }

        if (warehouse) {
            grnData.warehouseId = warehouse._id;
            // If it's a warehouse destination, we might want to store warehouseName in siteName field or add a new field.
            // But the model uses siteName as required (previously).
            if (!grnData.siteName) grnData.siteName = warehouse.warehouseName;
        }

        const grn = await GRN.create(grnData);

        pushTimeline(grn, {
            eventType: 'grn_created',
            user,
            note: `Standalone GRN created`
        });

        // If created by warehouse manager, auto-authenticate and update inventory
        if (isWarehouseManager) {
            grn.authenticatedBy = user._id;
            grn.authenticatedByName = safeUserName(user);
            grn.authenticatedAt = new Date();

            pushTimeline(grn, {
                eventType: 'grn_authenticated',
                user,
                note: 'Auto-authenticated by Warehouse Manager'
            });

            await grn.save();

            // Update inventory if not already updated at logging time
            if (!grn.inventoryUpdated) {
                await updateInventoryFromGRN(grn, user);
            }
        } else {
            await grn.save();
            // Site supplies are NOT updated here — they are updated only when the GRN is authenticated.
        }

        const payload = {
            companyId: user.companyId,
            grnId: grn.grnId,
            requestedBy: grn.createdBy,
            referenceId: grn._id
        };
        eventBus.emit('GRN_CREATED', payload);
        if (isWarehouseManager) {
            eventBus.emit('GRN_AUTHENTICATED', payload);
        }

        return res.status(201).json({ success: true, data: grn });
    } catch (error) {
        console.error('Error creating GRN:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Log GRN against an order
exports.logGRNAgainstOrder = async (req, res) => {
    try {
        const user = req.user;
        if (!canCreateGRN(user.role)) {
            return res.status(403).json({ success: false, message: 'You are not allowed to create GRN' });
        }

        const { orderId } = req.params;
        const { items, photos, remarks } = req.body;

        const order = await Order.findOne({ _id: orderId, companyId: user.companyId });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        if (!['dispatched', 'awaiting_receipt'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'Order is not ready for receiving' });
        }

        // Build GRN items from order items
        const byItemId = new Map();
        if (Array.isArray(items)) {
            items.forEach((item) => {
                if (item?.itemId && mongoose.isValidObjectId(item.itemId)) {
                    byItemId.set(String(item.itemId), {
                        receivedQty: Math.max(0, toNumber(item.receivedQty, 0)),
                        price: Math.max(0, toNumber(item.price, 0)),
                        remarks: toTrimmed(item.remarks)
                    });
                }
            });
        }

        const grnItems = [];
        for (const orderItem of order.items) {
            // Only process the item if it was explicitly sent in the GRN payload.
            // Items like those 'rejected' during approval will be omitted.
            if (!byItemId.has(String(orderItem._id))) {
                // Keep receivedQty at 0 for items completely omitted from GRN payload
                orderItem.receivedQty = 0;
                continue;
            }

            const override = byItemId.get(String(orderItem._id));
            const receivedQty = override.receivedQty;

            // Determine price: use explicitly provided price first, then the order-time snapshot,
            // then fall back to a live lookup of the inventory item's avg price.
            let price = override.price || orderItem.inventoryPrice || 0;
            if (!price && orderItem.inventoryItemId) {
                // eslint-disable-next-line no-await-in-loop
                const invItem = await InventoryItem.findById(orderItem.inventoryItemId).select('avgPrice currentPrice entryPrice');
                if (invItem) {
                    price = invItem.avgPrice || invItem.currentPrice || invItem.entryPrice || 0;
                }
            }

            const itemRemarks = override.remarks;

            // Write receivedQty back onto the order item so the order document reflects actual received amounts
            orderItem.receivedQty = receivedQty;

            if (receivedQty > 0) {
                grnItems.push({
                    itemName: orderItem.itemName,
                    inventoryItemId: orderItem.inventoryItemId,
                    uom: orderItem.uom,
                    dispatchedQty: Math.max(0, toNumber(orderItem.dispatchedQty, 0)),
                    receivedQty,
                    price,
                    discrepancy: receivedQty - Math.max(0, toNumber(orderItem.dispatchedQty, 0)),
                    remarks: itemRemarks
                });
            }
        }

        if (grnItems.length === 0) {
            return res.status(400).json({ success: false, message: 'No items to receive' });
        }

        const isWarehouseManager = ['admin', 'company_owner', 'warehouse_manager'].includes(user.role);
        const status = isWarehouseManager ? 'authenticated' : 'pending_authentication';

        const grn = await GRN.create({
            grnId: await generateGRNId(order.orderId),
            grnType: 'order_based',
            companyId: user.companyId,
            orderId: order._id,
            siteId: order.siteId,
            siteName: order.siteName,
            warehouseId: order.warehouseId,
            createdBy: user._id,
            createdByName: safeUserName(user),
            createdByRole: user.role,
            receivingFrom: order.receivingFrom,
            vendorName: order.vendorName,
            items: grnItems,
            photos: Array.isArray(photos) ? photos : [],
            remarks: toTrimmed(remarks),
            status
        });

        pushTimeline(grn, {
            eventType: 'grn_created',
            user,
            note: `GRN logged against order ${order.orderId}`
        });

        // Link GRN to order
        order.grnId = grn._id;
        order.grnCode = grn.grnId;
        const orderGrnMeta = {
            remarks: toTrimmed(remarks),
            photos: Array.isArray(photos) ? photos : []
        };

        // If created by warehouse manager, auto-authenticate and update inventory
        if (isWarehouseManager) {
            grn.authenticatedBy = user._id;
            grn.authenticatedByName = safeUserName(user);
            grn.authenticatedAt = new Date();

            pushTimeline(grn, {
                eventType: 'grn_authenticated',
                user,
                note: 'Auto-authenticated by Warehouse Manager'
            });

            await grn.save();

            // Update inventory
            await updateInventoryFromGRN(grn, user);

            // Update order status to authenticated (warehouse manager auto-authenticates)
            order.status = 'authenticated';
            order.receivedBy = user._id;
            order.receivedByName = safeUserName(user);
            order.receivedAt = new Date();

            order.timeline.push({
                eventType: 'order_authenticated',
                actorId: user._id,
                actorName: safeUserName(user),
                actorRole: user.role,
                note: 'Order received and GRN auto-authenticated by Warehouse Manager',
                meta: orderGrnMeta,
                timestamp: new Date()
            });
        } else {
            // Supervisor submission - set order to received, pending authentication.
            // Site supplies are NOT updated here — they are updated only when the GRN is authenticated.
            await grn.save();

            order.status = 'received';
            order.receivedBy = user._id;
            order.receivedByName = safeUserName(user);
            order.receivedAt = new Date();

            order.timeline.push({
                eventType: 'order_received',
                actorId: user._id,
                actorName: safeUserName(user),
                actorRole: user.role,
                note: 'Order received by Supervisor, pending authentication',
                meta: orderGrnMeta,
                timestamp: new Date()
            });
        }

        await order.save();

        const payload = {
            companyId: user.companyId,
            grnId: grn.grnId,
            requestedBy: grn.createdBy,
            referenceId: grn._id
        };
        eventBus.emit('GRN_CREATED', payload);
        if (isWarehouseManager) {
            eventBus.emit('GRN_AUTHENTICATED', payload);
        }

        // Emit ORDER_RECEIVED to notify the dispatcher
        eventBus.emit('ORDER_RECEIVED', {
            companyId: user.companyId,
            orderId: order.orderId,
            requestedBy: order.requestedBy,
            siteName: order.siteName,
            referenceId: order._id,
            dispatchedBy: order.dispatchedBy
        });

        // Check for discrepancies and notify (skip for direct-to-site/vendor orders)
        if (grn.receivingFrom !== 'vendor_direct' && grn.items && grn.items.length > 0) {
            for (const item of grn.items) {
                if (item.discrepancy !== 0) {
                    eventBus.emit('DISCREPANCY_DETECTED', {
                        companyId: user.companyId,
                        orderId: order.orderId,
                        itemName: item.itemName,
                        receivedQty: item.receivedQty,
                        dispatchedQty: item.dispatchedQty,
                        dispatchedBy: order.dispatchedBy,
                        referenceId: order._id
                    });
                }
            }
        }

        return res.status(201).json({ success: true, data: grn });
    } catch (error) {
        require('fs').appendFileSync('/tmp/grn_error.log', error.stack + '\n');
        console.error('Error logging GRN:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Get list of GRNs
exports.getGRNList = async (req, res) => {
    try {
        const user = req.user;
        if (!user?.companyId) {
            return res.status(403).json({ success: false, message: 'User is not mapped to a company' });
        }

        const {
            search,
            status,
            siteId,
            fromDate,
            toDate,
            page = 1,
            limit = DEFAULT_LIMIT
        } = req.query;

        const query = { companyId: user.companyId };

        // Role-based filtering
        if (user.role === 'supervisor') {
            query.createdBy = user._id;
        }

        // Status filter
        if (status === 'flagged') {
            query.flagged = true;
            query.status = { $in: ['pending_authentication', 'flagged'] };
        } else if (status && GRN_STATUSES.includes(status)) {
            query.status = status;
        }

        // Site filter
        if (siteId && mongoose.isValidObjectId(siteId)) {
            query.siteId = new mongoose.Types.ObjectId(siteId);
        }

        // Search
        if (search) {
            const regex = new RegExp(String(search).trim(), 'i');
            query.$or = [
                { grnId: regex },
                { 'items.itemName': regex },
                { createdByName: regex },
                { siteName: regex }
            ];
        }

        // Date range
        if (fromDate || toDate) {
            query.createdAt = {};
            if (fromDate) query.createdAt.$gte = new Date(fromDate);
            if (toDate) query.createdAt.$lte = new Date(toDate);
        }

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const perPage = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT));
        const skip = (pageNum - 1) * perPage;

        const [grns, total] = await Promise.all([
            GRN.find(query)
                .populate('siteId', 'siteName')
                .populate('orderId', 'orderId')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(perPage)
                .lean(),
            GRN.countDocuments(query)
        ]);

        return res.json({
            success: true,
            data: {
                items: grns,
                pagination: {
                    total,
                    page: pageNum,
                    limit: perPage,
                    totalPages: Math.max(1, Math.ceil(total / perPage))
                }
            }
        });
    } catch (error) {
        console.error('Error fetching GRN list:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Get GRN history (alias for getGRNList)
exports.getGRNHistory = exports.getGRNList;

// Get GRN by ID
exports.getGRNById = async (req, res) => {
    try {
        const user = req.user;
        const { grnId } = req.params;

        const grn = await GRN.findOne({ _id: grnId, companyId: user.companyId })
            .populate('siteId', 'siteName')
            .populate('orderId', 'orderId siteName')
            .populate('createdBy', 'username role')
            .populate('authenticatedBy', 'username role');

        if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });

        // Check access: creator or warehouse manager can view
        const isCreator = grn.createdBy._id.toString() === user._id.toString();
        const isWarehouseManager = canAuthenticateGRN(user.role);

        if (!isCreator && !isWarehouseManager) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        return res.json({ success: true, data: grn });
    } catch (error) {
        console.error('Error fetching GRN:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Get orders pending receiving
exports.getPendingReceiving = async (req, res) => {
    try {
        const user = req.user;
        if (!user?.companyId) {
            return res.status(403).json({ success: false, message: 'User is not mapped to a company' });
        }

        const query = {
            companyId: user.companyId,
            status: { $in: ['dispatched', 'awaiting_receipt'] }
        };

        // Supervisors see only their assigned sites
        if (user.role === 'supervisor') {
            const assigned = (user.assignedSites || []).map((id) => id.toString());
            if (!assigned.length) {
                return res.json({ success: true, data: [] });
            }
            query.siteId = { $in: assigned.map((id) => new mongoose.Types.ObjectId(id)) };
        }

        const orders = await Order.find(query)
            .populate('siteId', 'siteName')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        return res.json({ success: true, data: orders });
    } catch (error) {
        console.error('Error fetching pending receiving orders:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Get GRNs pending authentication (Admin, Manager, Supervisor)
exports.getPendingAuthentication = async (req, res) => {
    try {
        const user = req.user;
        if (!canAuthenticateGRN(user.role)) {
            return res.status(403).json({ success: false, message: 'Only authorized personnel can access this' });
        }

        const query = {
            companyId: user.companyId,
            status: { $in: ['pending_authentication', 'flagged'] }
        };

        const grns = await GRN.find(query)
            .populate('siteId', 'siteName')
            .populate('orderId', 'orderId')
            .populate('createdBy', 'username role')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        return res.json({ success: true, data: grns });
    } catch (error) {
        console.error('Error fetching pending authentication GRNs:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Authenticate GRN (Admin, Manager, Supervisor)
exports.authenticateGRN = async (req, res) => {
    try {
        const user = req.user;
        if (!canAuthenticateGRN(user.role)) {
            return res.status(403).json({ success: false, message: 'Only authorized personnel can authenticate GRN' });
        }

        const { grnId } = req.params;
        const { action, items, authenticationRemarks } = req.body;
        const trimmedRemarks = toTrimmed(authenticationRemarks);

        if (!['approve', 'reject', 'flag', 'unflag'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Action must be either approve, reject, flag or unflag' });
        }

        const grn = await GRN.findOne({ _id: grnId, companyId: user.companyId });
        if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });

        // Backward compatibility for legacy records where flagging was stored in status.
        if (grn.status === 'flagged' && !grn.flagged) {
            grn.flagged = true;
        }

        if (['approve', 'reject'].includes(action) && ['authenticated', 'rejected'].includes(grn.status)) {
            return res.status(400).json({ success: false, message: 'GRN already processed' });
        }

        if (['flag', 'unflag'].includes(action) && grn.status === 'rejected') {
            return res.status(400).json({ success: false, message: 'Rejected GRN cannot be flagged or unflagged' });
        }

        if (action === 'approve') {
            if (!['pending_authentication', 'flagged'].includes(grn.status)) {
                return res.status(400).json({ success: false, message: 'Only pending GRN can be approved' });
            }

            grn.authenticatedBy = user._id;
            grn.authenticatedByName = safeUserName(user);
            grn.authenticatedAt = new Date();
            grn.authenticationRemarks = trimmedRemarks;

            // Build a map of explicitly provided prices from the request payload
            const byItemId = new Map();
            if (Array.isArray(items)) {
                items.forEach((item) => {
                    if (item?.itemId && mongoose.isValidObjectId(item.itemId)) {
                        byItemId.set(String(item.itemId), Math.max(0, toNumber(item.price, 0)));
                    }
                });
            }

            // Apply pricing: use provided prices to override, or keep existing auto-fetched price
            // Price should already be set from warehouse inventory during GRN creation (receiveOrder)
            for (const item of grn.items) {
                if (byItemId.has(String(item._id))) {
                    // Warehouse manager explicitly provided/updated the price
                    item.price = byItemId.get(String(item._id));
                }
                // If no explicit price provided, keep the existing auto-fetched price from GRN creation
                // No need to fetch again - it was already fetched during receiveOrder
            }

            grn.status = 'authenticated';

            pushTimeline(grn, {
                eventType: 'grn_authenticated',
                user,
                note: trimmedRemarks || 'GRN authenticated'
            });

            await grn.save();

            // Update inventory
            await updateInventoryFromGRN(grn, user);

            // If GRN is linked to an order, update order status to authenticated
            if (grn.orderId) {
                const order = await Order.findById(grn.orderId);
                if (order) {
                    order.status = 'authenticated';

                    // Only set receivedBy/receivedAt if not already set (in case supervisor already received)
                    if (!order.receivedBy) {
                        order.receivedBy = user._id;
                        order.receivedByName = safeUserName(user);
                        order.receivedAt = new Date();
                    }

                    // Sync receivedQty from GRN items back to order items (by item name match)
                    const grnByName = new Map();
                    for (const gi of grn.items) {
                        grnByName.set(String(gi.itemName || '').trim().toLowerCase(), gi.receivedQty || 0);
                    }
                    for (const oi of order.items) {
                        const key = String(oi.itemName || '').trim().toLowerCase();
                        if (grnByName.has(key)) {
                            oi.receivedQty = grnByName.get(key);
                        }
                    }

                    order.timeline.push({
                        eventType: 'order_authenticated',
                        actorId: user._id,
                        actorName: safeUserName(user),
                        actorRole: user.role,
                        note: 'Order authenticated via GRN authentication',
                        meta: {
                            remarks: grn.authenticationRemarks || ''
                        },
                        timestamp: new Date()
                    });

                    await order.save();
                }
            }
        } else if (action === 'flag') {
            if (!trimmedRemarks) {
                return res.status(400).json({ success: false, message: 'Flag reason is required' });
            }

            // Flag is metadata and does not block future approval/rejection.
            grn.flagged = true;
            grn.flagReason = trimmedRemarks;
            grn.authenticationRemarks = trimmedRemarks;
            if (grn.status === 'flagged') {
                grn.status = 'pending_authentication';
            }

            pushTimeline(grn, {
                eventType: 'grn_flagged',
                user,
                note: trimmedRemarks || 'GRN flagged by manager'
            });

            await grn.save();
        } else if (action === 'unflag') {
            grn.flagged = false;
            grn.flagReason = '';
            grn.authenticationRemarks = trimmedRemarks;
            if (grn.status === 'flagged') {
                grn.status = 'pending_authentication';
            }

            pushTimeline(grn, {
                eventType: 'grn_unflagged',
                user,
                note: trimmedRemarks || 'GRN unflagged'
            });

            await grn.save();
        } else {
            // Reject
            if (!['pending_authentication', 'flagged'].includes(grn.status)) {
                return res.status(400).json({ success: false, message: 'Only pending GRN can be rejected' });
            }

            grn.authenticatedBy = user._id;
            grn.authenticatedByName = safeUserName(user);
            grn.authenticatedAt = new Date();
            grn.authenticationRemarks = trimmedRemarks;
            grn.status = 'rejected';

            pushTimeline(grn, {
                eventType: 'grn_rejected',
                user,
                note: trimmedRemarks || 'GRN rejected'
            });

            await grn.save();
        }

        const payload = {
            companyId: user.companyId,
            grnId: grn.grnId,
            requestedBy: grn.createdBy,
            referenceId: grn._id
        };
        if (action === 'approve') {
            eventBus.emit('GRN_AUTHENTICATED', payload);

            // Check for discrepancies and notify (skip for direct-to-site/vendor orders)
            if (grn.receivingFrom !== 'vendor_direct' && grn.items && grn.items.length > 0) {
                for (const item of grn.items) {
                    // Emit PRICING_CONFIRMED if price was provided during auth
                    if (item.price > 0) {
                        eventBus.emit('PRICING_CONFIRMED', {
                            companyId: user.companyId,
                            itemName: item.itemName,
                            addedBy: grn.createdBy,
                            referenceId: grn.siteId
                        });
                    }

                    if (item.discrepancy !== 0) {
                        eventBus.emit('DISCREPANCY_DETECTED', {
                            companyId: user.companyId,
                            orderId: grn.orderId ? (await Order.findById(grn.orderId))?.orderId : 'N/A',
                            itemName: item.itemName,
                            receivedQty: item.receivedQty,
                            dispatchedQty: item.dispatchedQty,
                            dispatchedBy: grn.createdBy, // For standalone GRN, notify creator? Or if order based, use order dispatcher
                            referenceId: grn.orderId || grn._id
                        });
                    }
                }
            }
        } else if (action === 'flag') {
            eventBus.emit('GRN_FLAGGED', payload);
        } else if (action === 'unflag') {
            eventBus.emit('GRN_UNFLAGGED', payload);
        } else {
            eventBus.emit('GRN_REJECTED', payload);
        }

        return res.json({ success: true, data: grn });
    } catch (error) {
        console.error('Error authenticating GRN:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};