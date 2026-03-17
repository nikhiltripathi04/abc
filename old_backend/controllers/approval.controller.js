const mongoose = require('mongoose');
const { Order, ORDER_STATUSES } = require('../models/Order');
// [BACKORDER DISABLED] const { Backorder, BACKORDER_STATUSES } = require('../models/Backorder');
const { QuantityChangeRequest, QUANTITY_CHANGE_STATUSES } = require('../models/QuantityChangeRequest');
const { ItemDetailChangeRequest } = require('../models/ItemDetailChangeRequest');
const { ApprovalLog, APPROVAL_TYPES, APPROVAL_STATUSES } = require('../models/ApprovalLog');
const { SalesRequest } = require('../models/SalesRequest');
const InventoryItem = require('../models/InventoryItem');
const Site = require('../models/Site');
const Warehouse = require('../models/Warehouse');
const User = require('../models/User');
const approvalHelper = require('../utils/approvalHelper');
const ActivityLogger = require('../utils/activityLogger');
const eventBus = require('../core/eventBus');
const { getIO } = require('../core/socket');

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const parseList = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
    if (typeof value === 'string') {
        return value.split(',').map((v) => v.trim()).filter(Boolean);
    }
    return [String(value)].filter(Boolean);
};
const parseDateOnly = (value, endOfDay = false) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    if (endOfDay) {
        date.setHours(23, 59, 59, 999);
    } else {
        date.setHours(0, 0, 0, 0);
    }
    return date;
};
const buildDateRange = (from, to) => {
    const start = parseDateOnly(from, false);
    const end = parseDateOnly(to, true);
    if (!start && !end) return null;
    const range = {};
    if (start) range.$gte = start;
    if (end) range.$lte = end;
    return range;
};

const buildInventoryItem = (item) => {
    const avgPrice = item.avgPrice || item.currentPrice || item.entryPrice || 0;
    const qty = item.availableQty || 0;
    const minQty = item.minQty || 0;
    const status = qty <= 0 ? 'out_of_stock' : qty < minQty ? 'below_min' : 'active';
    return {
        _id: item._id,
        uid: item.uid,
        itemName: item.itemName,
        category: item.category,
        location: item.location,
        uom: item.uom,
        unit: item.uom,
        availableQty: qty,
        quantity: qty,
        minQty: item.minQty,
        maxQty: item.maxQty,
        reorderQty: item.reorderQty,
        entryPrice: item.entryPrice,
        currentPrice: item.currentPrice,
        avgPrice,
        avgPricePerPiece: avgPrice,
        totalValue: qty * avgPrice,
        currency: item.currency || '₹',
        tags: item.tags || [],
        isFavorite: !!item.isFavorite,
        isActive: !!item.isActive,
        status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    };
};

const getNextSplitOrderId = async (baseOrderId) => {
    const escaped = escapeRegex(baseOrderId);
    const existing = await Order.find({
        orderId: { $regex: `^${escaped}-\\d+$` }
    }).select('orderId').lean();

    let maxSuffix = 0;
    existing.forEach((order) => {
        const match = String(order.orderId || '').match(/-(\d+)$/);
        if (match) {
            const value = Number(match[1]);
            if (Number.isFinite(value)) maxSuffix = Math.max(maxSuffix, value);
        }
    });

    return `${baseOrderId}-${maxSuffix + 1}`;
};

const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const normalizeName = (value) => String(value || '').trim().toLowerCase();

const resolveInventoryItem = async (order, item) => {
    if (!order?.warehouseId) return null;
    if (item?.inventoryItemId) {
        return InventoryItem.findById(item.inventoryItemId);
    }
    return InventoryItem.findOne({
        warehouseId: order.warehouseId,
        itemName: new RegExp(`^${escapeRegex(item.itemName)}$`, 'i')
    });
};

const adjustWarehouseSupplies = (warehouse, itemName, delta) => {
    if (!warehouse) return;
    const idx = (warehouse.supplies || []).findIndex(
        (s) => normalizeName(s.itemName) === normalizeName(itemName)
    );
    if (idx < 0) return;
    const currentQty = toNumber(warehouse.supplies[idx].quantity, 0);
    const nextQty = currentQty - delta;
    warehouse.supplies[idx].quantity = Math.max(0, nextQty);
};

const adjustInventoryForApproval = async ({ order, item, prevApprovedQty, prevRoutingDecision, prevApprovalDecision, user, warehouse }) => {
    if (!order?.warehouseId) return;

    const prevQty = Math.max(0, toNumber(prevApprovedQty, 0));
    const nextQty = Math.max(0, toNumber(item.approvedQty, 0));
    const prevWasWarehouse = prevRoutingDecision === 'warehouse' && prevApprovalDecision === 'approved' && prevQty > 0;
    const nextIsWarehouse = item.routingDecision === 'warehouse' && item.approvalDecision === 'approved' && nextQty > 0;

    let delta = 0;
    if (prevWasWarehouse && nextIsWarehouse) {
        delta = nextQty - prevQty;
    } else if (!prevWasWarehouse && nextIsWarehouse) {
        delta = nextQty;
    } else if (prevWasWarehouse && !nextIsWarehouse) {
        delta = -prevQty;
    }

    if (!delta) return;

    const inventoryItem = await resolveInventoryItem(order, item);
    if (!inventoryItem) {
        throw new Error(`Inventory item not found for ${item.itemName}`);
    }

    const available = toNumber(inventoryItem.availableQty, 0);
    if (delta > 0 && available < delta) {
        throw new Error(`Insufficient stock for ${inventoryItem.itemName}. Available: ${inventoryItem.availableQty}`);
    }

    inventoryItem.availableQty = Math.max(0, available - delta);
    inventoryItem.updatedBy = user?._id;
    await inventoryItem.save();

    if (delta > 0 && inventoryItem.availableQty < inventoryItem.minQty) {
        eventBus.emit('STOCK_LOW', {
            companyId: inventoryItem.companyId,
            warehouseId: inventoryItem.warehouseId,
            warehouseName: warehouse?.warehouseName || 'Warehouse',
            itemId: inventoryItem._id,
            itemName: inventoryItem.itemName,
            availableQty: inventoryItem.availableQty,
            minQty: inventoryItem.minQty
        });
    }

    if (warehouse) {
        adjustWarehouseSupplies(warehouse, item.itemName, delta);
        await warehouse.save();
    }
};

/**
 * GET /api/approvals/dashboard
 * Get approval dashboard with filters
 */
exports.getDashboard = async (req, res) => {
    try {
        const requestStart = Date.now();
        const {
            type = 'all',
            status = 'pending',
            limit = 10,
            page = 1,
            search,
            sites,
            site,
            requestors,
            requestor,
            dateFrom,
            dateTo,
            neededBy,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;
        const adminId = req.user._id;
        const companyId = req.user.companyId;

        const siteIds = parseList(sites || site || req.query.siteId);
        const requestorIds = parseList(requestors || requestor);
        const createdRange = buildDateRange(dateFrom, dateTo);
        const neededByRange = buildDateRange(neededBy, neededBy);
        const sortDir = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
        const sortFieldMap = {
            createdAt: 'createdAt',
            neededBy: 'neededBy',
            requestor: 'requestedByName',
            site: 'siteName'
        };
        const sortField = sortFieldMap[sortBy] || 'createdAt';

        if (type === 'sales_request') {
            const salesStart = Date.now();
            const query = { companyId, status: 'pending_approval' };

            if (status === 'today') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                query.createdAt = { $gte: today };
            } else if (status === 'all') {
                delete query.status;
            }

            if (requestorIds.length > 0) {
                query.createdBy = { $in: requestorIds };
            }

            if (createdRange) {
                query.createdAt = { ...(query.createdAt || {}), ...createdRange };
            }

            if (search) {
                const regex = new RegExp(escapeRegex(search), 'i');
                query.$or = [
                    { salesRequestId: regex },
                    { createdByName: regex }
                ];
            }

            const skip = (parseInt(page) - 1) * parseInt(limit);

            const requests = await SalesRequest.find(query)
                .populate('warehouseId', 'warehouseName')
                .populate('createdBy', 'fullName firstName lastName')
                .sort({ [sortField]: sortDir, createdAt: -1 })
                .limit(parseInt(limit))
                .skip(skip)
                .lean()
                .exec();

            const total = await SalesRequest.countDocuments(query);

            console.log(`[approval] getDashboard sales_request ${Date.now() - salesStart}ms`);

            return res.json({
                type,
                count: total,
                approvals: (requests || []).map(reqDoc => ({
                    id: reqDoc._id,
                    orderId: reqDoc.salesRequestId,
                    type: 'sales_request',
                    requestorId: reqDoc.createdBy?._id || reqDoc.createdBy,
                    requestor: reqDoc.createdByName,
                    itemCount: (reqDoc.items || []).length,
                    totalQty: (reqDoc.items || []).reduce((sum, item) => sum + (item.requestedQty || 0), 0),
                    site: reqDoc.warehouseId?.warehouseName || '-',
                    createdAt: reqDoc.createdAt,
                    neededBy: undefined,
                    status: reqDoc.status
                })),
                totalPending: total,
                page,
                limit
            });
        }

        let query = { companyId, status: 'pending_approval' };

        // Add pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Get orders
        let orderQuery = { ...query };

        if (status === 'today') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            orderQuery.createdAt = { $gte: today };
        } else if (status === 'all') {
            // Don't filter by status - get all orders
            delete orderQuery.status;
        } else if (status === 'pending') {
            orderQuery.status = { $in: ['pending_approval', 'partially_approved'] };
        }

        if (siteIds.length > 0) {
            orderQuery.siteId = { $in: siteIds };
        }

        if (requestorIds.length > 0) {
            orderQuery.requestedBy = { $in: requestorIds };
        }

        if (createdRange) {
            orderQuery.createdAt = { ...(orderQuery.createdAt || {}), ...createdRange };
        }

        if (neededByRange) {
            orderQuery.neededBy = neededByRange;
        }

        if (search) {
            const regex = new RegExp(escapeRegex(search), 'i');
            orderQuery.$or = [
                { orderId: regex },
                { siteName: regex },
                { requestedByName: regex }
            ];
        }

        // [BACKORDER DISABLED] Backorder dashboard filter removed
        // const backorderScope = { companyId };
        // const backorderCheckStart = Date.now();
        // const hasBackorders = await Backorder.exists(backorderScope);
        // if (hasBackorders) {
        //     const backorderOrderIds = await Backorder.distinct('orderId', backorderScope);
        //     if (backorderOrderIds.length > 0) {
        //         orderQuery._id = { $nin: backorderOrderIds };
        //     }
        // }
        // console.log(`[approval] getDashboard backorder filter ${Date.now() - backorderCheckStart}ms`);

        const ordersStart = Date.now();
        const orders = await Order.find(orderQuery)
            .sort({ [sortField]: sortDir, createdAt: -1 })
            .limit(parseInt(limit))
            .skip(skip)
            .lean()
            .exec();

        console.log(`[approval] getDashboard orders find ${Date.now() - ordersStart}ms`);

        const countStart = Date.now();
        const totalOrders = await Order.countDocuments(orderQuery);
        console.log(`[approval] getDashboard orders count ${Date.now() - countStart}ms`);

        console.log(`[approval] getDashboard total ${Date.now() - requestStart}ms`);

        return res.json({
            type,
            count: totalOrders,
            approvals: (orders || []).map(order => {
                const effectiveItems = (order.items || []).filter(item => !item.splitOrderId);
                return {
                    id: order._id,
                    orderId: order.orderId,
                    type: 'supply_request',
                    siteId: order.siteId?._id || order.siteId,
                    requestorId: order.requestedBy?._id || order.requestedBy,
                    requestor: order.requestedByName,
                    itemCount: effectiveItems.length,
                    totalQty: effectiveItems.reduce((sum, item) => sum + item.requestedQty, 0),
                    site: order.siteName,
                    createdAt: order.createdAt,
                    neededBy: order.neededBy,
                    status: order.status // Return the actual live order status
                };
            }),
            totalPending: totalOrders,
            page,
            limit
        });
    } catch (error) {
        console.error('Error in getDashboard:', error);
        res.status(500).json({ error: error.message, approvals: [] });
    }
};

/**
 * GET /api/approvals/quantity-changes/:id
 * Get quantity change request details
 */
exports.getQuantityChangeDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        const request = await QuantityChangeRequest.findById(id)
            .populate('itemId', 'itemName')
            .populate('warehouseId', 'warehouseName')
            .populate('requestedBy', 'fullName firstName lastName email');

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        if (request.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        res.json({ request });
    } catch (error) {
        console.error('Error in getQuantityChangeDetails:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/approvals/:id
 * Get approval details
 */
exports.getApprovalDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.query;
        const companyId = req.user.companyId;

        if (type === 'sales_request') {
            const request = await SalesRequest.findById(id)
                .populate('warehouseId', 'warehouseName')
                .populate('createdBy', 'fullName firstName lastName email')
                .populate('approvedBy', 'fullName firstName lastName email')
                .populate('items.inventoryItemId');

            if (!request) {
                return res.status(404).json({ error: 'Sales request not found' });
            }

            if (request.companyId.toString() !== companyId.toString()) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            const summary = {
                itemCount: (request.items || []).length,
                totalQty: (request.items || []).reduce((sum, item) => sum + (item.requestedQty || 0), 0),
                totalValue: request.grandTotal || 0,
                warehouseName: request.warehouseId?.warehouseName || '-',
                status: request.status
            };

            return res.json({ order: request, summary });
        }

        const order = await Order.findById(id)
            .populate('siteId')
            .populate('warehouseId', 'warehouseName')
            .populate('requestedBy', 'fullName firstName lastName email')
            .populate('items.inventoryItemId')
            .populate('items.decidedBy', 'fullName firstName lastName');

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Hydrate item availability from the order warehouse inventory
        if (order.warehouseId && Array.isArray(order.items) && order.items.length > 0) {
            const itemNames = order.items
                .map(item => item.itemName)
                .filter(Boolean);

            const inventoryItems = await InventoryItem.find({
                warehouseId: order.warehouseId,
                itemName: { $in: itemNames }
            }).select('itemName availableQty warehouseId').lean();

            const inventoryMap = new Map(
                inventoryItems.map(inv => [inv.itemName, inv])
            );

            order.items.forEach((item) => {
                let availableQty = 0;

                if (item.inventoryItemId && item.inventoryItemId.availableQty !== undefined) {
                    if (
                        !item.inventoryItemId.warehouseId ||
                        String(item.inventoryItemId.warehouseId) === String(order.warehouseId)
                    ) {
                        availableQty = Number(item.inventoryItemId.availableQty) || 0;
                    }
                }

                if (!availableQty && inventoryMap.has(item.itemName)) {
                    availableQty = Number(inventoryMap.get(item.itemName).availableQty) || 0;
                }

                item.itemAvailableQty = availableQty;
                item.itemStatus = approvalHelper.determineItemStatus(item.requestedQty, availableQty);
            });
        }

        // Get summary
        const summary = approvalHelper.generateApprovalSummary(order);

        res.json({
            order,
            summary
        });
    } catch (error) {
        console.error('Error in getApprovalDetails:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/approvals/dashboard/filters
 * Get available filters for dashboard
 */
exports.getFilterOptions = async (req, res) => {
    try {
        const companyId = req.user.companyId;

        const [sites, supervisors, requestors] = await Promise.all([
            Site.find({ companyId }).select('_id siteName'),
            User.find({ companyId, role: 'supervisor' }).select('_id fullName firstName lastName'),
            User.find({ companyId, role: { $in: ['supervisor', 'warehouse_manager'] } }).select('_id fullName firstName lastName')
        ]);

        res.json({
            sites,
            supervisors,
            requestors
        });
    } catch (error) {
        console.error('Error in getFilterOptions:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/approvals/:orderId/approve-item
 * Approve individual item
 */
exports.approveItem = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { itemId, approvedQty, routing, vendorName, remarks /*, backorderQty [BACKORDER DISABLED] */ } = req.body;
        const adminId = req.user._id;
        const adminName = req.user.firstName + ' ' + req.user.lastName;
        const companyId = req.user.companyId;

        // Validate input
        const validation = approvalHelper.validateApprovalDecisions([{
            itemId,
            approvedQty,
            routing,
            vendorName
        }]);

        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Find the item
        const itemIndex = order.items.findIndex(item => item._id.toString() === itemId);
        if (itemIndex === -1) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const item = order.items[itemIndex];
        const prevApprovedQty = item.approvedQty;
        const prevRoutingDecision = item.routingDecision;
        const prevApprovalDecision = item.approvalDecision;

        // Process approval
        item.approvedQty = approvedQty;
        item.routingDecision = routing;
        item.approvalDecision = approvedQty > 0 ? 'approved' : 'rejected';
        item.approvalRemarks = remarks || '';
        item.decidedAt = new Date();
        item.decidedBy = adminId;
        item.decidedByName = adminName;

        if (routing === 'direct_to_site' && String(vendorName || '').trim()) {
            order.vendorName = vendorName;
        }

        // [BACKORDER DISABLED] Create backorder if needed
        // if (backorderQty && backorderQty > 0) {
        //     const backorder = await approvalHelper.createBackorderForItem(
        //         orderId,
        //         order.siteId,
        //         companyId,
        //         item,
        //         backorderQty,
        //         adminId,
        //         adminName,
        //         vendorName,
        //         null,
        //         order.orderId
        //     );
        //
        //     item.backorderCreated = true;
        //     item.backorderQty = backorderQty;
        //     item.backorderID = backorder._id;
        // }

        let splitOrder = null;
        const isMultiItemOrder = (order.items || []).length > 1;
        if (isMultiItemOrder && item.approvalDecision === 'approved' && approvedQty > 0) {
            if (!item.splitOrderId) {
                const splitOrderId = await getNextSplitOrderId(order.orderId);
                const approvedAt = new Date();
                const splitItem = {
                    itemName: item.itemName,
                    inventoryItemId: item.inventoryItemId,
                    uom: item.uom,
                    requestedQty: approvedQty,
                    approvedQty,
                    dispatchedQty: 0,
                    receivedQty: 0,
                    isCustomItem: item.isCustomItem,
                    approvalDecision: 'approved',
                    remarks: item.remarks,
                    // backorderCreated: item.backorderCreated, // [BACKORDER DISABLED]
                    // backorderQty: item.backorderQty, // [BACKORDER DISABLED]
                    // backorderID: item.backorderID, // [BACKORDER DISABLED]
                    itemAvailableQty: item.itemAvailableQty,
                    itemStatus: item.itemStatus,
                    assignedWarehouse: item.assignedWarehouse,
                    routingDecision: item.routingDecision,
                    approvalRemarks: item.approvalRemarks,
                    decidedAt: item.decidedAt,
                    decidedBy: item.decidedBy,
                    decidedByName: item.decidedByName
                };

                const splitStatus = routing === 'direct_to_site' ? 'awaiting_receipt' : 'pending_dispatch';

                splitOrder = await Order.create({
                    orderId: splitOrderId,
                    companyId: order.companyId,
                    siteId: order.siteId,
                    siteName: order.siteName,
                    warehouseId: routing === 'warehouse' ? order.warehouseId : undefined,
                    requestedBy: order.requestedBy,
                    requestedByName: order.requestedByName,
                    requestedByRole: order.requestedByRole,
                    receivingFrom: routing === 'direct_to_site' ? 'vendor_direct' : 'warehouse',
                    status: splitStatus,
                    items: [splitItem],
                    neededBy: order.neededBy,
                    vendorName: routing === 'direct_to_site' ? vendorName : '',
                    notes: order.notes,
                    sourcePlatform: order.sourcePlatform,
                    approvedBy: adminId,
                    approvedByName: adminName,
                    approvedAt,
                    approvalDetails: {
                        approvedBy: adminId,
                        approvedAt,
                        approvalRemarks: remarks || '',
                        routingDecision: routing,
                        vendorName: routing === 'direct_to_site' ? vendorName : '',
                        expectedDeliveryDate: order.approvalDetails?.expectedDeliveryDate || order.neededBy || null
                    },
                    timeline: [
                        approvalHelper.createApprovalTimeline('order_split_approved', adminId, adminName, {
                            originalOrderId: order.orderId,
                            itemName: item.itemName,
                            note: `Order created from approved item ${item.itemName}`
                        })
                    ]
                });

                item.splitOrderId = splitOrder.orderId;
            }
        }

        const warehouse = order.warehouseId
            ? await Warehouse.findById(order.warehouseId)
            : null;

        try {
            await adjustInventoryForApproval({
                order,
                item,
                prevApprovedQty,
                prevRoutingDecision,
                prevApprovalDecision,
                user: req.user,
                warehouse
            });
        } catch (inventoryError) {
            return res.status(400).json({ error: inventoryError.message });
        }

        // Add timeline
        order.timeline.push(approvalHelper.createApprovalTimeline('item_approved', adminId, adminName, {
            itemName: item.itemName,
            approvedQty,
            routing,
            vendorName: routing === 'direct_to_site' ? vendorName : '',
            remarks: remarks || '',
            note: `Item approved: ${approvedQty} units`
        }));

        const completeness = approvalHelper.checkApprovalCompleteness(order);
        if (completeness.isComplete) {
            const allRejected = (order.items || []).every(i => i.approvalDecision === 'rejected');
            if (allRejected) {
                order.status = 'rejected';
                order.rejectedBy = adminId;
                order.rejectedByName = adminName;
                order.rejectedAt = new Date();
                order.rejectionReason = remarks || 'Rejected by admin';

                eventBus.emit('ORDER_REJECTED', {
                    orderId: order.orderId,
                    referenceId: order._id,
                    companyId: order.companyId,
                    requestedBy: order.requestedBy,
                    siteName: order.siteName
                });
            } else {
                const allApprovedDirect = (order.items || []).every((i) =>
                    i.approvalDecision === 'rejected' || i.routingDecision === 'direct_to_site'
                );
                if (allApprovedDirect) {
                    order.status = 'awaiting_receipt';
                    order.receivingFrom = 'vendor_direct';
                    order.warehouseId = undefined;
                    if (vendorName) order.vendorName = vendorName;
                } else {
                    order.status = 'pending_dispatch';
                }
                order.approvedBy = adminId;
                order.approvedByName = adminName;
                order.approvedAt = new Date();

                eventBus.emit('ORDER_APPROVED', {
                    orderId: order.orderId,
                    referenceId: order._id,
                    companyId: order.companyId,
                    requestedBy: order.requestedBy,
                    siteName: order.siteName
                });
            }
        } else {
            // If it's the first item approved and order is multi-item, it's partially approved
            if (order.status === 'pending_approval') {
                order.status = 'partially_approved';
                eventBus.emit('ORDER_PARTIALLY_APPROVED', {
                    orderId: order.orderId,
                    referenceId: order._id,
                    companyId: order.companyId,
                    requestedBy: order.requestedBy,
                    siteName: order.siteName
                });
            }
        }

        await order.save();

        res.json({
            success: true,
            order,
            splitOrderId: splitOrder ? splitOrder.orderId : null,
            message: 'Item approved successfully'
        });
    } catch (error) {
        console.error('Error in approveItem:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * PATCH /api/approvals/:orderId/items/:itemId
 * Update item settings (qty, routing, remarks) without final approval
 */
exports.updateItemSettings = async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const { approvedQty, routing, vendorName, remarks } = req.body;
        const companyId = req.user.companyId;

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const itemIndex = order.items.findIndex(item => item._id.toString() === itemId);
        if (itemIndex === -1) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const item = order.items[itemIndex];

        // Only update if item is still pending or we are just refining settings
        // if (item.approvalDecision === 'approved') {
        //     return res.status(400).json({ error: 'Cannot update settings for already approved item' });
        // }

        item.approvedQty = toNumber(approvedQty, item.approvedQty);
        item.routingDecision = routing || item.routingDecision;
        item.approvalRemarks = remarks !== undefined ? remarks : item.approvalRemarks;

        if (item.routingDecision === 'direct_to_site' && String(vendorName || '').trim()) {
            // We don't update order-level vendorName yet, only on final approval
        }

        await order.save();

        const populatedOrder = await Order.findById(order._id)
            .populate('siteId')
            .populate('warehouseId', 'warehouseName')
            .populate('requestedBy', 'fullName firstName lastName email')
            .populate('items.inventoryItemId')
            .populate('items.decidedBy', 'fullName firstName lastName');

        res.json({
            success: true,
            order: populatedOrder,
            message: 'Item settings updated successfully'
        });
    } catch (error) {
        console.error('Error in updateItemSettings:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/approvals/:orderId/reject-item
 * Reject individual item
 */
exports.rejectItem = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { itemId, reason, remarks } = req.body;
        const adminId = req.user._id;
        const adminName = req.user.firstName + ' ' + req.user.lastName;
        const companyId = req.user.companyId;

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const itemIndex = order.items.findIndex(item => item._id.toString() === itemId);
        if (itemIndex === -1) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const item = order.items[itemIndex];

        item.approvalDecision = 'rejected';
        item.approvedQty = 0;
        item.approvalRemarks = remarks || reason;
        item.decidedAt = new Date();
        item.decidedBy = adminId;
        item.decidedByName = adminName;

        order.timeline.push(approvalHelper.createApprovalTimeline('item_rejected', adminId, adminName, {
            itemName: item.itemName,
            reason,
            remarks: remarks || '',
            note: `Item rejected: ${reason}`
        }));

        // Update order status if all items are decided
        const completeness = approvalHelper.checkApprovalCompleteness(order);
        if (completeness.isComplete) {
            const allRejected = (order.items || []).every(i => i.approvalDecision === 'rejected');
            if (allRejected) {
                order.status = 'rejected';
                order.rejectedBy = adminId;
                order.rejectedByName = adminName;
                order.rejectedAt = new Date();
                order.rejectionReason = remarks || reason || 'Rejected by admin';

                eventBus.emit('ORDER_REJECTED', {
                    orderId: order.orderId,
                    referenceId: order._id,
                    companyId: order.companyId,
                    requestedBy: order.requestedBy,
                    siteName: order.siteName
                });
            } else {
                const allApprovedDirect = (order.items || []).every((i) =>
                    i.approvalDecision === 'rejected' || i.routingDecision === 'direct_to_site'
                );
                if (allApprovedDirect) {
                    order.status = 'awaiting_receipt';
                    order.receivingFrom = 'vendor_direct';
                    order.warehouseId = undefined;
                } else {
                    order.status = 'pending_dispatch';
                }
                order.approvedBy = adminId;
                order.approvedByName = adminName;
                order.approvedAt = new Date();

                eventBus.emit('ORDER_APPROVED', {
                    orderId: order.orderId,
                    referenceId: order._id,
                    companyId: order.companyId,
                    requestedBy: order.requestedBy,
                    siteName: order.siteName
                });
            }
        } else if (order.status === 'pending_approval') {
            order.status = 'partially_approved';
            eventBus.emit('ORDER_PARTIALLY_APPROVED', {
                orderId: order.orderId,
                referenceId: order._id,
                companyId: order.companyId,
                requestedBy: order.requestedBy,
                siteName: order.siteName
            });
        }

        await order.save();

        res.json({
            success: true,
            order,
            message: 'Item rejected successfully'
        });
    } catch (error) {
        console.error('Error in rejectItem:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/approvals/:orderId/bulk-approve
 * Bulk approve items
 */
exports.bulkApproveItems = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { itemsDecisions } = req.body;
        const adminId = req.user._id;
        const adminName = req.user.firstName + ' ' + req.user.lastName;
        const companyId = req.user.companyId;

        // Validate decisions
        const validation = approvalHelper.validateApprovalDecisions(itemsDecisions);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const warehouse = order.warehouseId
            ? await Warehouse.findById(order.warehouseId)
            : null;

        // Process each decision
        for (const decision of itemsDecisions) {
            const itemIndex = order.items.findIndex(item => item._id.toString() === decision.itemId);
            if (itemIndex === -1) continue;

            const item = order.items[itemIndex];
            const prevApprovedQty = item.approvedQty;
            const prevRoutingDecision = item.routingDecision;
            const prevApprovalDecision = item.approvalDecision;
            item.approvedQty = decision.approvedQty;
            item.routingDecision = decision.routing;
            item.approvalDecision = decision.approvedQty > 0 ? 'approved' : 'rejected';
            item.approvalRemarks = decision.remarks || '';
            item.decidedAt = new Date();
            item.decidedBy = adminId;
            item.decidedByName = adminName;

            if (decision.routing === 'direct_to_site' && String(decision.vendorName || '').trim()) {
                order.vendorName = order.vendorName || decision.vendorName;
            }

            // [BACKORDER DISABLED] Create backorder if needed
            // if (decision.backorderQty && decision.backorderQty > 0) {
            //     const backorder = await approvalHelper.createBackorderForItem(
            //         orderId,
            //         order.siteId,
            //         companyId,
            //         item,
            //         decision.backorderQty,
            //         adminId,
            //         adminName,
            //         decision.vendorName,
            //         null,
            //         order.orderId
            //     );
            //
            //     item.backorderCreated = true;
            //     item.backorderQty = decision.backorderQty;
            //     item.backorderID = backorder._id;
            // }

            try {
                await adjustInventoryForApproval({
                    order,
                    item,
                    prevApprovedQty,
                    prevRoutingDecision,
                    prevApprovalDecision,
                    user: req.user,
                    warehouse
                });
            } catch (inventoryError) {
                return res.status(400).json({ error: inventoryError.message });
            }
        }

        // Update order status
        const completeness = approvalHelper.checkApprovalCompleteness(order);
        if (completeness.isComplete) {
            const allApprovedDirect = (order.items || []).every((item) =>
                item.approvalDecision === 'rejected' || item.routingDecision === 'direct_to_site'
            );
            if (allApprovedDirect) {
                order.status = 'awaiting_receipt';
                order.receivingFrom = 'vendor_direct';
                order.warehouseId = undefined;
                const firstVendor = (itemsDecisions || []).find((d) => (d.vendorName || '').trim());
                if (firstVendor?.vendorName) order.vendorName = firstVendor.vendorName;
            } else {
                order.status = 'pending_dispatch';
            }
            order.approvedBy = adminId;
            order.approvedByName = adminName;
            order.approvedAt = new Date();

            eventBus.emit('ORDER_APPROVED', {
                orderId: order.orderId,
                referenceId: order._id,
                companyId: order.companyId,
                requestedBy: order.requestedBy,
                siteName: order.siteName
            });
        } else {
            order.status = 'partially_approved';

            eventBus.emit('ORDER_PARTIALLY_APPROVED', {
                orderId: order.orderId,
                referenceId: order._id,
                companyId: order.companyId,
                requestedBy: order.requestedBy,
                siteName: order.siteName
            });
        }

        const decisionNotes = (itemsDecisions || [])
            .map((decision) => ({
                itemId: decision.itemId,
                routing: decision.routing,
                remarks: decision.remarks || '',
                vendorName: decision.vendorName || ''
            }))
            .filter((decision) => decision.remarks || (decision.routing === 'direct_to_site' && decision.vendorName));

        order.timeline.push(approvalHelper.createApprovalTimeline('bulk_approval', adminId, adminName, {
            itemCount: itemsDecisions.length,
            decisionNotes,
            note: `Bulk approved ${itemsDecisions.length} items`
        }));

        await order.save();

        res.json({
            success: true,
            order,
            message: 'Items approved successfully'
        });
    } catch (error) {
        console.error('Error in bulkApproveItems:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/approvals/:orderId/bulk-reject
 * Bulk reject items
 */
exports.bulkRejectItems = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { itemIds, reason } = req.body;
        const adminId = req.user._id;
        const adminName = req.user.firstName + ' ' + req.user.lastName;
        const companyId = req.user.companyId;

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Reject each item
        for (const itemId of itemIds) {
            const itemIndex = order.items.findIndex(item => item._id.toString() === itemId);
            if (itemIndex === -1) continue;

            const item = order.items[itemIndex];
            item.approvalDecision = 'rejected';
            item.approvedQty = 0;
            item.approvalRemarks = reason;
            item.decidedAt = new Date();
            item.decidedBy = adminId;
            item.decidedByName = adminName;
        }

        // Update order status
        const completeness = approvalHelper.checkApprovalCompleteness(order);
        if (completeness.isComplete) {
            const allRejected = (order.items || []).every(i => i.approvalDecision === 'rejected');
            if (allRejected) {
                order.status = 'rejected';
                order.rejectedBy = adminId;
                order.rejectedByName = adminName;
                order.rejectedAt = new Date();
                order.rejectionReason = reason;

                eventBus.emit('ORDER_REJECTED', {
                    orderId: order.orderId,
                    referenceId: order._id,
                    companyId: order.companyId,
                    requestedBy: order.requestedBy,
                    siteName: order.siteName
                });
            } else {
                const allApprovedDirect = (order.items || []).every((item) =>
                    item.approvalDecision === 'rejected' || item.routingDecision === 'direct_to_site'
                );
                if (allApprovedDirect) {
                    order.status = 'awaiting_receipt';
                    order.receivingFrom = 'vendor_direct';
                    order.warehouseId = undefined;
                } else {
                    order.status = 'pending_dispatch';
                }
                order.approvedBy = adminId;
                order.approvedByName = adminName;
                order.approvedAt = new Date();

                eventBus.emit('ORDER_APPROVED', {
                    orderId: order.orderId,
                    referenceId: order._id,
                    companyId: order.companyId,
                    requestedBy: order.requestedBy,
                    siteName: order.siteName
                });
            }
        }
        order.timeline.push(approvalHelper.createApprovalTimeline('bulk_rejection', adminId, adminName, {
            itemCount: itemIds.length,
            reason,
            note: `Bulk rejected ${itemIds.length} items: ${reason}`
        }));

        await order.save();

        res.json({
            success: true,
            order,
            message: 'Items rejected successfully'
        });
    } catch (error) {
        console.error('Error in bulkRejectItems:', error);
        res.status(500).json({ error: error.message });
    }
};

// [BACKORDER DISABLED] getBackorders API removed
// exports.getBackorders = async (req, res) => { ... };
exports.getBackorders = async (req, res) => {
    return res.status(410).json({ error: 'Backorder functionality has been disabled.' });
};

// [BACKORDER DISABLED] getBackorderDetail API removed
exports.getBackorderDetail = async (req, res) => {
    return res.status(410).json({ error: 'Backorder functionality has been disabled.' });
};

// [BACKORDER DISABLED] approveBackorder API removed
exports.approveBackorder = async (req, res) => {
    return res.status(410).json({ error: 'Backorder functionality has been disabled.' });
};

/**
 * GET /api/approvals/quantity-changes/pending
 * Get pending quantity change requests
 */
exports.getPendingQuantityChanges = async (req, res) => {
    try {
        const requestStart = Date.now();
        const {
            status = 'pending',
            limit = 10,
            page = 1,
            dateFrom,
            dateTo,
            search,
            requestors,
            requestor,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;
        const companyId = req.user.companyId;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const query = { companyId };

        if (status === 'all') {
            // no status filter
        } else if (status === 'today') {
            query.status = 'pending';
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const end = new Date();
            end.setHours(23, 59, 59, 999);
            query.createdAt = { $gte: start, $lte: end };
        } else {
            query.status = status;
        }

        if (dateFrom || dateTo) {
            const createdRange = buildDateRange(dateFrom, dateTo);
            if (createdRange) {
                query.createdAt = { ...(query.createdAt || {}), ...createdRange };
            }
        }

        const requestorIds = parseList(requestors || requestor);
        if (requestorIds.length > 0) {
            query.requestedBy = { $in: requestorIds };
        }

        if (search) {
            const regex = new RegExp(escapeRegex(search), 'i');
            query.$or = [
                { itemName: regex },
                { requestedByName: regex }
            ];
        }

        const sortDir = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
        const sortFieldMap = {
            createdAt: 'createdAt',
            requestor: 'requestedByName'
        };
        const sortField = sortFieldMap[sortBy] || 'createdAt';

        const [requests, total] = await Promise.all([
            QuantityChangeRequest.find(query)
                .populate('warehouseId', 'warehouseName')
                .sort({ [sortField]: sortDir, createdAt: -1 })
                .limit(parseInt(limit))
                .skip(skip)
                .lean(),
            QuantityChangeRequest.countDocuments(query)
        ]);

        console.log(`[approval] getPendingQuantityChanges total ${Date.now() - requestStart}ms`);

        res.json({
            requests,
            total,
            page,
            limit
        });
    } catch (error) {
        console.error('Error in getPendingQuantityChanges:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/approvals/quantity-changes/:id/approve
 * Approve quantity change request
 */
exports.approveQuantityChange = async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks } = req.body;
        const adminId = req.user._id;
        const adminName = req.user.firstName + ' ' + req.user.lastName;
        const companyId = req.user.companyId;

        const request = await QuantityChangeRequest.findById(id);
        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        if (request.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Update inventory
        const inventoryItem = await InventoryItem.findByIdAndUpdate(
            request.itemId,
            { availableQty: request.updatedQuantity },
            { new: true }
        );

        if (!inventoryItem) {
            return res.status(404).json({ error: 'Inventory item not found' });
        }

        // Mark request as approved
        request.status = 'approved';
        request.approvedBy = adminId;
        request.approvedByName = adminName;
        request.approvedAt = new Date();
        request.approvalRemarks = remarks || '';

        request.timeline.push(approvalHelper.createApprovalTimeline('quantity_change_approved', adminId, adminName, {
            originalQty: request.originalQuantity,
            updatedQty: request.updatedQuantity,
            difference: request.updatedQuantity - request.originalQuantity,
            note: `Quantity updated from ${request.originalQuantity} to ${request.updatedQuantity}`
        }));

        await request.save();
        eventBus.emit('QUANTITY_CHANGE_APPROVED', {
            companyId: request.companyId,
            requestedBy: request.requestedBy,
            itemName: request.itemName,
            referenceId: request._id
        });

        const ioApproveQty = getIO();
        if (ioApproveQty && request.warehouseId) {
            ioApproveQty.to(`warehouse:${request.warehouseId}`).emit('inventory:item_updated', buildInventoryItem(inventoryItem));
            ioApproveQty.to(`warehouse:${request.warehouseId}`).emit('quantity_change:status', {
                itemId: request.itemId,
                itemName: request.itemName,
                status: 'approved',
                updatedQuantity: request.updatedQuantity,
                originalQuantity: request.originalQuantity,
                approvedByName: adminName,
            });
        }

        // Log activity to warehouse activity log
        if (request.warehouseId) {
            await ActivityLogger.logActivity(
                request.warehouseId,
                'quantity_change_approved',
                req.user,
                {
                    itemId: inventoryItem._id,
                    itemName: inventoryItem.itemName,
                    itemUid: inventoryItem.uid,
                    originalQuantity: request.originalQuantity,
                    updatedQuantity: request.updatedQuantity,
                    difference: request.updatedQuantity - request.originalQuantity,
                    requestedBy: request.requestedByName,
                    reason: request.reason,
                    approvalRemarks: remarks || ''
                },
                `Quantity change approved for ${inventoryItem.itemName} [${inventoryItem.uid}]: ${request.originalQuantity} → ${request.updatedQuantity}`,
                'Warehouse'
            );
        }

        res.json({
            success: true,
            request,
            inventoryItem,
            message: 'Quantity change approved'
        });
    } catch (error) {
        console.error('Error in approveQuantityChange:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/approvals/quantity-changes/:id/reject
 * Reject quantity change request
 */
exports.rejectQuantityChange = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const adminId = req.user._id;
        const adminName = req.user.firstName + ' ' + req.user.lastName;
        const companyId = req.user.companyId;

        const request = await QuantityChangeRequest.findById(id);
        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        if (request.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        request.status = 'rejected';
        request.rejectedBy = adminId;
        request.rejectedByName = adminName;
        request.rejectedAt = new Date();
        request.rejectionReason = reason;

        request.timeline.push(approvalHelper.createApprovalTimeline('quantity_change_rejected', adminId, adminName, {
            reason,
            note: `Quantity change rejected: ${reason}`
        }));

        await request.save();
        eventBus.emit('QUANTITY_CHANGE_REJECTED', {
            companyId: request.companyId,
            requestedBy: request.requestedBy,
            itemName: request.itemName,
            referenceId: request._id,
            warehouseId: request.warehouseId,
            reason: reason
        });

        const ioRejectQty = getIO();
        if (ioRejectQty && request.warehouseId) {
            ioRejectQty.to(`warehouse:${request.warehouseId}`).emit('quantity_change:status', {
                itemId: request.itemId,
                itemName: request.itemName,
                status: 'rejected',
                rejectedByName: adminName,
                rejectionReason: reason,
            });
        }

        // Log activity to warehouse activity log
        if (request.warehouseId && request.itemId) {
            const inventoryItem = await InventoryItem.findById(request.itemId).select('itemName uid');
            if (inventoryItem) {
                await ActivityLogger.logActivity(
                    request.warehouseId,
                    'quantity_change_rejected',
                    req.user,
                    {
                        itemId: inventoryItem._id,
                        itemName: inventoryItem.itemName,
                        itemUid: inventoryItem.uid,
                        originalQuantity: request.originalQuantity,
                        requestedQuantity: request.updatedQuantity,
                        requestedBy: request.requestedByName,
                        reason: request.reason,
                        rejectionReason: reason
                    },
                    `Quantity change rejected for ${inventoryItem.itemName} [${inventoryItem.uid}]: Reason - ${reason}`,
                    'Warehouse'
                );
            }
        }

        res.json({
            success: true,
            request,
            message: 'Quantity change rejected'
        });
    } catch (error) {
        console.error('Error in rejectQuantityChange:', error);
        res.status(500).json({ error: error.message });
    }
};

// [BACKORDER DISABLED] createBackorderFromApproval API removed
exports.createBackorderFromApproval = async (req, res) => {
    return res.status(410).json({ error: 'Backorder functionality has been disabled.' });
};

exports.adjustInventoryForApproval = adjustInventoryForApproval;

/**
 * GET /api/approvals/item-detail-changes/:id
 * Get item detail change request details
 */
exports.getItemDetailChangeDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        const request = await ItemDetailChangeRequest.findById(id)
            .populate('itemId', 'itemName uid')
            .populate('warehouseId', 'warehouseName')
            .populate('requestedBy', 'fullName firstName lastName email');

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        if (request.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        res.json({ request });
    } catch (error) {
        console.error('Error in getItemDetailChangeDetails:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/approvals/item-changes
 * Get combined list of QuantityChangeRequests and ItemDetailChangeRequests
 */
exports.getPendingItemChanges = async (req, res) => {
    try {
        const requestStart = Date.now();
        const {
            status = 'pending',
            limit = 10,
            page = 1,
            dateFrom,
            dateTo,
            search,
            requestors,
            requestor,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;
        const companyId = req.user.companyId;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const query = { companyId };

        if (status === 'all') {
            // no status filter
        } else if (status === 'today') {
            query.status = 'pending';
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const end = new Date();
            end.setHours(23, 59, 59, 999);
            query.createdAt = { $gte: start, $lte: end };
        } else {
            query.status = status;
        }

        if (dateFrom || dateTo) {
            const createdRange = buildDateRange(dateFrom, dateTo);
            if (createdRange) {
                query.createdAt = { ...(query.createdAt || {}), ...createdRange };
            }
        }

        const requestorIds = parseList(requestors || requestor);
        if (requestorIds.length > 0) {
            query.requestedBy = { $in: requestorIds };
        }

        if (search) {
            const regex = new RegExp(escapeRegex(search), 'i');
            query.$or = [
                { itemName: regex },
                { originalItemName: regex },
                { requestedByName: regex }
            ];
        }

        const sortDir = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;

        // Fetch both collections in parallel (without pagination — combine then paginate)
        const qtyQuery = { ...query };
        if (qtyQuery.$or) {
            // QuantityChangeRequest uses itemName
            qtyQuery.$or = qtyQuery.$or.filter(c => !c.originalItemName);
            if (qtyQuery.$or.length === 0) delete qtyQuery.$or;
        }
        const detailQuery = { ...query };
        if (detailQuery.$or) {
            detailQuery.$or = detailQuery.$or.map(c => c.originalItemName ? { originalItemName: c.originalItemName } : c);
        }

        const [qtyRequests, detailRequests] = await Promise.all([
            QuantityChangeRequest.find(qtyQuery)
                .populate('warehouseId', 'warehouseName')
                .sort({ createdAt: sortDir })
                .lean(),
            ItemDetailChangeRequest.find(detailQuery)
                .populate('warehouseId', 'warehouseName')
                .sort({ createdAt: sortDir })
                .lean()
        ]);

        const combined = [
            ...qtyRequests.map(r => ({ ...r, requestType: 'quantity_change' })),
            ...detailRequests.map(r => ({ ...r, requestType: 'item_detail_change' }))
        ].sort((a, b) => (sortDir === -1 ? new Date(b.createdAt) - new Date(a.createdAt) : new Date(a.createdAt) - new Date(b.createdAt)));

        const total = combined.length;
        const paginated = combined.slice(skip, skip + parseInt(limit));

        console.log(`[approval] getPendingItemChanges total ${Date.now() - requestStart}ms`);

        res.json({
            requests: paginated,
            total,
            page,
            limit
        });
    } catch (error) {
        console.error('Error in getPendingItemChanges:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/approvals/item-detail-changes/:id/approve
 * Approve item detail change request
 */
exports.approveItemDetailChange = async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks } = req.body;
        const adminId = req.user._id;
        const adminName = req.user.firstName + ' ' + req.user.lastName;
        const companyId = req.user.companyId;

        const request = await ItemDetailChangeRequest.findById(id);
        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        if (request.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ error: `Request is already ${request.status}` });
        }

        // Update inventory item with new values
        const inventoryItem = await InventoryItem.findById(request.itemId);
        if (!inventoryItem) {
            return res.status(404).json({ error: 'Inventory item not found' });
        }

        // Build change description for activity log
        const changeLines = [];
        if (request.updatedItemName && request.updatedItemName !== request.originalItemName) {
            changeLines.push(`Item Name: ${request.originalItemName} → ${request.updatedItemName}`);
            inventoryItem.itemName = request.updatedItemName;
        }
        if (request.updatedLocation !== request.originalLocation) {
            changeLines.push(`Location: ${request.originalLocation || '(none)'} → ${request.updatedLocation || '(none)'}`);
            inventoryItem.location = request.updatedLocation;
        }
        if (request.updatedCategory !== request.originalCategory) {
            changeLines.push(`Category: ${request.originalCategory || '(none)'} → ${request.updatedCategory || '(none)'}`);
            inventoryItem.category = request.updatedCategory;
        }
        if (request.updatedUom !== request.originalUom) {
            changeLines.push(`UOM: ${request.originalUom || '(none)'} → ${request.updatedUom || '(none)'}`);
            inventoryItem.uom = request.updatedUom;
        }
        const changeDescription = changeLines.join(' | ');

        await inventoryItem.save();

        // Mark request as approved
        request.status = 'approved';
        request.approvedBy = adminId;
        request.approvedByName = adminName;
        request.approvedAt = new Date();
        request.approvalRemarks = remarks || '';

        request.timeline.push(approvalHelper.createApprovalTimeline('item_detail_change_approved', adminId, adminName, {
            changeDescription,
            note: `Item detail change approved: ${changeDescription}`
        }));

        await request.save();

        eventBus.emit('ITEM_DETAIL_CHANGE_APPROVED', {
            companyId: request.companyId,
            requestedBy: request.requestedBy,
            itemName: inventoryItem.itemName,
            referenceId: request._id
        });

        const ioApproveDetail = getIO();
        if (ioApproveDetail && request.warehouseId) {
            ioApproveDetail.to(`warehouse:${request.warehouseId}`).emit('inventory:item_updated', buildInventoryItem(inventoryItem));
            ioApproveDetail.to(`warehouse:${request.warehouseId}`).emit('item_detail_change:status', {
                itemId: inventoryItem._id,
                itemName: inventoryItem.itemName,
                itemUid: inventoryItem.uid,
                status: 'approved',
                approvedByName: adminName,
                changeDescription,
            });
        }

        if (request.warehouseId) {
            await ActivityLogger.logActivity(
                request.warehouseId,
                'item_details_updated',
                req.user,
                {
                    itemId: inventoryItem._id,
                    itemName: inventoryItem.itemName,
                    uid: inventoryItem.uid,
                    itemUid: inventoryItem.uid,
                    changeDescription,
                    requestedBy: request.requestedByName,
                    reason: request.reason,
                    approvalRemarks: remarks || ''
                },
                `Item details updated for "${inventoryItem.itemName}": ${changeDescription}`,
                'Warehouse'
            );
        }

        res.json({
            success: true,
            request,
            inventoryItem,
            message: 'Item detail change approved'
        });
    } catch (error) {
        console.error('Error in approveItemDetailChange:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/approvals/item-detail-changes/:id/reject
 * Reject item detail change request
 */
exports.rejectItemDetailChange = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const adminId = req.user._id;
        const adminName = req.user.firstName + ' ' + req.user.lastName;
        const companyId = req.user.companyId;

        const request = await ItemDetailChangeRequest.findById(id);
        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        if (request.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        request.status = 'rejected';
        request.rejectedBy = adminId;
        request.rejectedByName = adminName;
        request.rejectedAt = new Date();
        request.rejectionReason = reason || '';

        request.timeline.push(approvalHelper.createApprovalTimeline('item_detail_change_rejected', adminId, adminName, {
            reason,
            note: `Item detail change rejected: ${reason}`
        }));

        await request.save();

        eventBus.emit('ITEM_DETAIL_CHANGE_REJECTED', {
            companyId: request.companyId,
            requestedBy: request.requestedBy,
            itemName: request.originalItemName,
            referenceId: request._id,
            warehouseId: request.warehouseId,
            reason: reason || ''
        });

        const ioRejectDetail = getIO();
        if (ioRejectDetail && request.warehouseId) {
            ioRejectDetail.to(`warehouse:${request.warehouseId}`).emit('item_detail_change:status', {
                itemId: request.itemId,
                itemName: request.originalItemName,
                status: 'rejected',
                rejectedByName: adminName,
                rejectionReason: reason || '',
            });
        }

        if (request.warehouseId) {
            const rejectedItem = await InventoryItem.findById(request.itemId).select('uid').lean();
            await ActivityLogger.logActivity(
                request.warehouseId,
                'item_detail_change_rejected',
                req.user,
                {
                    itemId: request.itemId,
                    itemName: request.originalItemName,
                    uid: rejectedItem?.uid || '',
                    itemUid: rejectedItem?.uid || '',
                    requestedBy: request.requestedByName,
                    reason: request.reason,
                    rejectionReason: reason || ''
                },
                `Item detail change rejected for "${request.originalItemName}": Reason - ${reason}`,
                'Warehouse'
            );
        }

        res.json({
            success: true,
            request,
            message: 'Item detail change rejected'
        });
    } catch (error) {
        console.error('Error in rejectItemDetailChange:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = exports;
