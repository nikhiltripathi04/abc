const mongoose = require('mongoose');
const { Order } = require('../models/Order');
const { GRN } = require('../models/GRN');
const { uploadDispatchPhotoToR2 } = require('../utils/uploadToR2');
const { Backorder, BACKORDER_STATUSES } = require('../models/Backorder');
const Site = require('../models/Site');
const Warehouse = require('../models/Warehouse');
const InventoryItem = require('../models/InventoryItem');
const { adjustInventoryForApproval } = require('./approval.controller');
const eventBus = require('../core/eventBus');
const { NOTIFICATION_TYPES } = require('../modules/notification/notification.constants');
const { enqueue } = require('../modules/notification/notification.eventBridge');
const { getNextSequence, formatNumber, getDisplayId } = require('../utils/generateOrderId');

const DASHBOARD_CARD_STATUSES = ['pending_approval', 'draft', 'pending_dispatch', 'in_fulfillment', 'awaiting_receipt'];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const toObjectId = (value) => (mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null);
const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const toTrimmed = (value) => String(value || '').trim();

const computeOrderTotals = (orderDoc) => {
    const items = orderDoc.items || [];
    const totalItems = items.length;
    const totalRequestedQty = items.reduce((sum, item) => sum + toNumber(item.requestedQty, 0), 0);
    const totalApprovedQty = items.reduce((sum, item) => sum + toNumber(item.approvedQty, 0), 0);
    const totalReceivedQty = items.reduce((sum, item) => sum + toNumber(item.receivedQty, 0), 0);
    return { totalItems, totalRequestedQty, totalApprovedQty, totalReceivedQty };
};

const safeUserName = (user) => {
    if (!user) return 'Unknown';
    const firstName = (user.firstName || '').trim();
    const lastName = (user.lastName || '').trim();
    if (firstName || lastName) return [firstName, lastName].filter(Boolean).join(' ');
    if (user.fullName && user.fullName.trim()) return user.fullName.trim();
    return user.username || 'Unknown';
};

const pushTimeline = (order, { eventType, user, note = '', meta = {} }) => {
    order.timeline.push({
        eventType,
        actorId: user?._id,
        actorName: safeUserName(user),
        actorRole: user?.role || '',
        note,
        meta,
        timestamp: new Date()
    });
};

const canCreateOrder = (role) => ['admin', 'company_owner', 'supervisor', 'warehouse_manager'].includes(role);
const canApproveOrder = (role) => ['admin', 'company_owner'].includes(role);
const isAdminRole = (role) => ['admin', 'company_owner'].includes(role);
const getAutoApprovedStatus = (receivingFrom) => (receivingFrom === 'vendor_direct' ? 'awaiting_receipt' : 'pending_dispatch');
const getAutoApprovedStage = (receivingFrom) => (receivingFrom === 'vendor_direct' ? 'DIS' : 'ORD');

const isSupervisorAllowedForSite = (user, siteId) => {
    if (user.role !== 'supervisor') return true;
    const assigned = user.assignedSites || [];
    return assigned.some((id) => id.toString() === siteId.toString());
};

const assertCompanyAccess = (user, companyId) => {
    if (!companyId || !user?.companyId) return false;
    return companyId.toString() === user.companyId.toString();
};

const getWarehouseManagerWarehouseIds = (user) => {
    const ids = [];
    if (user?.warehouseId) ids.push(String(user.warehouseId));
    if (Array.isArray(user?.assignedWarehouses)) {
        user.assignedWarehouses.forEach((id) => {
            if (id) ids.push(String(id));
        });
    }
    return [...new Set(ids)];
};

const warehouseManagerHasAccess = (user, warehouseId) => {
    if (user?.role !== 'warehouse_manager') return true;
    const allowed = getWarehouseManagerWarehouseIds(user);
    if (!allowed.length) return false;
    return allowed.some((id) => id === String(warehouseId));
};

const getWarehouseForUser = async (warehouseId, user) => {
    if (!warehouseId) return null;
    if (!warehouseManagerHasAccess(user, warehouseId)) return null;

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) return null;

    if (!assertCompanyAccess(user, warehouse.companyId)) return null;

    return warehouse;
};

const buildListScope = async (req) => {
    const user = req.user;
    if (!user?.companyId) {
        return { error: { code: 403, message: 'User is not mapped to a company' } };
    }

    const query = {
        companyId: user.companyId,
        $or: [
            { status: { $ne: 'draft' } },
            { status: 'draft', requestedBy: user._id }
        ]
    };

    if (user.role === 'supervisor') {
        const assigned = (user.assignedSites || []).map((id) => id.toString());
        if (!assigned.length) {
            return { query: { _id: { $in: [] } } };
        }
        query.siteId = { $in: assigned.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    let allowedWarehouseIds = [];
    if (user.role === 'warehouse_manager') {
        allowedWarehouseIds = getWarehouseManagerWarehouseIds(user)
            .filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id));

        if (!allowedWarehouseIds.length) {
            return { error: { code: 403, message: 'Warehouse manager is not mapped to any warehouse' } };
        }

        // Include orders from assigned warehouse(s) OR any direct-to-site order (no warehouseId)
        const warehouseFilter = allowedWarehouseIds.length === 1
            ? allowedWarehouseIds[0]
            : { $in: allowedWarehouseIds };
        query.$and = [
            ...(query.$and || []),
            {
                $or: [
                    { warehouseId: warehouseFilter },
                    { receivingFrom: 'vendor_direct' }
                ]
            }
        ];
    }

    if (!['admin', 'company_owner', 'warehouse_manager', 'supervisor'].includes(user.role)) {
        return { error: { code: 403, message: 'Order access denied' } };
    }

    return { query, allowedWarehouseIds };
};

const normalizeItems = (items) => {
    if (!Array.isArray(items) || items.length === 0) {
        return { error: 'At least one order item is required' };
    }

    const normalized = [];
    for (const raw of items) {
        const itemName = toTrimmed(raw.itemName);
        const uom = toTrimmed(raw.uom || 'pcs');
        const requestedQty = Math.max(0, toNumber(raw.requestedQty, 0));
        const isCustomItem = !!raw.isCustomItem;
        if (!itemName) return { error: 'Each item must include itemName' };
        if (!requestedQty) return { error: `requestedQty must be > 0 for item ${itemName}` };

        normalized.push({
            itemName,
            inventoryItemId: toObjectId(raw.inventoryItemId) || undefined,
            uom,
            requestedQty,
            approvedQty: 0,
            dispatchedQty: 0,
            receivedQty: 0,
            isCustomItem,
            approvalDecision: 'pending',
            remarks: toTrimmed(raw.remarks)
        });
    }

    return { items: normalized };
};

const serializeOrder = (order) => {
    const totals = computeOrderTotals(order);
    const obj = order.toObject();
    // If requestedBy is populated (object with _id), derive name from name fields
    if (obj.requestedBy && typeof obj.requestedBy === 'object' && obj.requestedBy._id) {
        obj.requestedByName = safeUserName(obj.requestedBy);
    }
    return {
        ...obj,
        displayId: getDisplayId(order),
        ...totals
    };
};

exports.getOrderMetaSites = async (req, res) => {
    try {
        const user = req.user;
        if (!user?.companyId) {
            return res.status(403).json({ success: false, message: 'User is not mapped to a company' });
        }
        if (!['admin', 'company_owner', 'supervisor', 'warehouse_manager'].includes(user.role)) {
            return res.status(403).json({ success: false, message: 'Order access denied' });
        }

        let query = { companyId: user.companyId };
        if (user.role === 'supervisor') {
            const assigned = (user.assignedSites || []).filter(Boolean);
            query = { _id: { $in: assigned } };
        }

        const sites = await Site.find(query).select('_id siteName location').sort({ siteName: 1 });
        return res.json({ success: true, data: sites });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getOrderMetaWarehouses = async (req, res) => {
    try {
        const user = req.user;
        if (!user?.companyId) {
            return res.status(403).json({ success: false, message: 'User is not mapped to a company' });
        }
        if (!['admin', 'company_owner', 'supervisor', 'warehouse_manager'].includes(user.role)) {
            return res.status(403).json({ success: false, message: 'Order access denied' });
        }

        let query = { companyId: user.companyId };
        if (user.role === 'warehouse_manager') {
            const allowedWarehouseIds = getWarehouseManagerWarehouseIds(user)
                .filter((id) => mongoose.isValidObjectId(id))
                .map((id) => new mongoose.Types.ObjectId(id));
            if (!allowedWarehouseIds.length) {
                return res.json({ success: true, data: [] });
            }
            query = { _id: { $in: allowedWarehouseIds } };
        }

        const warehouses = await Warehouse.find(query)
            .select('_id warehouseName location companyId managers')
            .sort({ warehouseName: 1 });

        return res.json({ success: true, data: warehouses });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.createOrder = async (req, res) => {
    try {
        const user = req.user;
        if (!canCreateOrder(user.role)) {
            return res.status(403).json({ success: false, message: 'You are not allowed to create orders' });
        }
        if (!user.companyId) {
            return res.status(403).json({ success: false, message: 'User is not mapped to a company' });
        }

        const {
            siteId,
            warehouseId,
            items,
            neededBy,
            vendorName,
            notes,
            sourcePlatform,
            receivingFrom = 'warehouse',
            asDraft = false
        } = req.body;

        if (!asDraft && (!siteId || !mongoose.isValidObjectId(siteId))) {
            return res.status(400).json({ success: false, message: 'Valid siteId is required' });
        }
        if (asDraft && siteId && !mongoose.isValidObjectId(siteId)) {
            return res.status(400).json({ success: false, message: 'Invalid siteId format' });
        }

        let site = null;
        if (siteId && mongoose.isValidObjectId(siteId)) {
            site = await Site.findById(siteId).select('siteName companyId');
            if (!site) return res.status(404).json({ success: false, message: 'Site not found' });
            if (!assertCompanyAccess(user, site.companyId)) {
                return res.status(403).json({ success: false, message: 'Site does not belong to your company' });
            }
            if (!isSupervisorAllowedForSite(user, site._id)) {
                return res.status(403).json({ success: false, message: 'Supervisor can only order for assigned site(s)' });
            }
        }

        const normalizedItems = normalizeItems(items);
        if (normalizedItems.error) {
            return res.status(400).json({ success: false, message: normalizedItems.error });
        }

        const shouldBypassApproval = !asDraft && isAdminRole(user.role);
        const autoApprovedStatus = getAutoApprovedStatus(receivingFrom);
        const preparedItems = shouldBypassApproval
            ? normalizedItems.items.map((item) => ({
                ...item,
                approvedQty: item.requestedQty,
                approvalDecision: 'approved'
            }))
            : normalizedItems.items;

        let warehouse = null;
        if (!asDraft && receivingFrom === 'warehouse') {
            if (!warehouseId || !mongoose.isValidObjectId(warehouseId)) {
                return res.status(400).json({ success: false, message: 'Valid warehouseId is required for warehouse receiving flow' });
            }
            warehouse = await getWarehouseForUser(warehouseId, user);
            if (!warehouse) {
                return res.status(403).json({ success: false, message: 'Warehouse access denied or not found' });
            }
        } else if (asDraft && warehouseId && mongoose.isValidObjectId(warehouseId)) {
            warehouse = await getWarehouseForUser(warehouseId, user);
        }

        // Snapshot the inventory avg price for each item that references a known inventory record
        for (const item of preparedItems) {
            if (item.inventoryItemId) {
                // eslint-disable-next-line no-await-in-loop
                const invItem = await InventoryItem.findById(item.inventoryItemId).select('avgPrice currentPrice entryPrice');
                if (invItem) {
                    item.inventoryPrice = invItem.avgPrice || invItem.currentPrice || invItem.entryPrice || 0;
                }
            }
        }

        let sequenceNumber;
        let orderIdValue;
        if (!asDraft) {
            sequenceNumber = await getNextSequence('order');
            const formattedSequence = formatNumber(sequenceNumber);
            orderIdValue = `ORD-${formattedSequence}`;
        }

        const order = await Order.create({
            orderId: orderIdValue,
            sequenceNumber,
            currentStage: 'ORD',
            companyId: user.companyId,
            siteId: site ? site._id : undefined,
            siteName: site ? site.siteName : '',
            warehouseId: warehouse ? warehouse._id : undefined,
            requestedBy: user._id,
            requestedByName: safeUserName(user),
            requestedByRole: user.role,
            receivingFrom,
            status: asDraft ? 'draft' : (shouldBypassApproval ? autoApprovedStatus : 'pending_approval'),
            items: preparedItems,
            neededBy: neededBy ? new Date(neededBy) : undefined,
            vendorName: toTrimmed(vendorName),
            notes: toTrimmed(notes),
            sourcePlatform: sourcePlatform === 'mobile' ? 'mobile' : 'web'
        });

        if (shouldBypassApproval) {
            order.approvedBy = user._id;
            order.approvedByName = safeUserName(user);
            order.approvedAt = new Date();
            order.currentStage = getAutoApprovedStage(order.receivingFrom);

            // Deduct inventory immediately for warehouse-sourced auto-approved orders
            if (order.receivingFrom === 'warehouse' && order.warehouseId) {
                for (const item of order.items) {
                    if (!item.isCustomItem && item.approvedQty > 0) {
                        item.routingDecision = 'warehouse';
                        await adjustInventoryForApproval({
                            order,
                            item,
                            prevApprovedQty: 0,
                            prevRoutingDecision: null,
                            prevApprovalDecision: null,
                            user,
                            warehouse
                        });
                    }
                }
            }
        }

        pushTimeline(order, {
            eventType: asDraft ? 'draft_saved' : (shouldBypassApproval ? 'order_auto_approved' : 'order_submitted'),
            user,
            note: asDraft
                ? 'Order saved as draft'
                : (shouldBypassApproval
                    ? (order.receivingFrom === 'vendor_direct'
                        ? 'Order auto-approved and moved to awaiting receipt'
                        : 'Order auto-approved and moved to pending dispatch')
                    : 'Order submitted for approval')
        });
        await order.save();

        if (!asDraft) {
            const payload = {
                companyId: user.companyId,
                orderId: order.orderId,
                requestedBy: user._id,
                siteName: order.siteName,
                referenceId: order._id
            };
            if (shouldBypassApproval) {
                eventBus.emit('ORDER_APPROVED', payload);
                if (order.status === 'pending_dispatch' && order.warehouseId) {
                    eventBus.emit('ORDER_ALLOTTED_FOR_DISPATCH', { ...payload, warehouseId: order.warehouseId });
                }
            } else {
                eventBus.emit('ORDER_SUBMITTED', payload);
            }
        }

        return res.status(201).json({ success: true, data: serializeOrder(order) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateDraftOrder = async (req, res) => {
    try {
        const user = req.user;
        const { orderId } = req.params;
        const order = await Order.findOne({ _id: orderId, companyId: user.companyId });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        const isOwner = order.requestedBy.toString() === user._id.toString();
        const isAdmin = ['admin', 'company_owner'].includes(user.role);
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Only creator/admin can edit this order' });
        }
        if (order.status !== 'draft') {
            return res.status(400).json({ success: false, message: 'Only draft orders can be edited' });
        }

        const { items, siteId, warehouseId, neededBy, vendorName, notes, receivingFrom } = req.body;

        if (siteId) {
            if (!mongoose.isValidObjectId(siteId)) {
                return res.status(400).json({ success: false, message: 'Invalid siteId' });
            }
            const site = await Site.findById(siteId).select('siteName companyId');
            if (!site) return res.status(404).json({ success: false, message: 'Site not found' });
            if (!assertCompanyAccess(user, site.companyId)) {
                return res.status(403).json({ success: false, message: 'Site does not belong to your company' });
            }
            if (!isSupervisorAllowedForSite(user, site._id)) {
                return res.status(403).json({ success: false, message: 'Supervisor can only order for assigned site(s)' });
            }
            order.siteId = site._id;
            order.siteName = site.siteName;
        }

        if (items) {
            const normalizedItems = normalizeItems(items);
            if (normalizedItems.error) {
                return res.status(400).json({ success: false, message: normalizedItems.error });
            }
            order.items = normalizedItems.items;
        }

        const receivingFromFinal = receivingFrom || order.receivingFrom;
        if (receivingFromFinal === 'warehouse') {
            const effectiveWarehouseId = warehouseId || order.warehouseId;
            const warehouse = await getWarehouseForUser(effectiveWarehouseId, user);
            if (!warehouse) {
                return res.status(403).json({ success: false, message: 'Warehouse access denied or not found' });
            }
            order.warehouseId = warehouse._id;
            order.receivingFrom = 'warehouse';
        }

        if (receivingFromFinal === 'vendor_direct') {
            order.receivingFrom = 'vendor_direct';
            order.warehouseId = undefined;
        }

        if (neededBy) order.neededBy = new Date(neededBy);
        if (vendorName !== undefined) order.vendorName = toTrimmed(vendorName);
        if (notes !== undefined) order.notes = toTrimmed(notes);

        pushTimeline(order, {
            eventType: 'draft_updated',
            user,
            note: 'Draft updated'
        });

        await order.save();
        return res.json({ success: true, data: serializeOrder(order) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.submitOrder = async (req, res) => {
    try {
        const user = req.user;
        const { orderId } = req.params;
        const order = await Order.findOne({ _id: orderId, companyId: user.companyId });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        const isOwner = order.requestedBy.toString() === user._id.toString();
        const isAdmin = ['admin', 'company_owner'].includes(user.role);
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Only creator/admin can submit this order' });
        }

        if (order.status !== 'draft') {
            return res.status(400).json({ success: false, message: 'Only draft orders can be submitted' });
        }

        if (!order.siteId) {
            return res.status(400).json({ success: false, message: 'A site must be selected before submitting an order' });
        }

        if (!order.items || order.items.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one item is required to submit an order' });
        }

        if (!order.orderId || !order.sequenceNumber) {
            const sequenceNumber = await getNextSequence('order');
            order.sequenceNumber = sequenceNumber;
            order.orderId = `ORD-${formatNumber(sequenceNumber)}`;
            order.currentStage = 'ORD';
        }

        const shouldBypassApproval = isAdminRole(user.role);
        if (shouldBypassApproval) {
            const autoApprovedStatus = getAutoApprovedStatus(order.receivingFrom);
            order.items = order.items.map((item) => {
                item.approvedQty = item.requestedQty;
                item.approvalDecision = 'approved';
                return item;
            });
            order.status = autoApprovedStatus;
            order.currentStage = getAutoApprovedStage(order.receivingFrom);
            order.approvedBy = user._id;
            order.approvedByName = safeUserName(user);
            order.approvedAt = new Date();
        } else {
            order.status = 'pending_approval';
        }
        pushTimeline(order, {
            eventType: shouldBypassApproval ? 'order_auto_approved' : 'order_submitted',
            user,
            note: shouldBypassApproval
                ? (order.receivingFrom === 'vendor_direct'
                    ? 'Draft auto-approved and moved to awaiting receipt'
                    : 'Draft auto-approved and moved to pending dispatch')
                : 'Order submitted for approval'
        });
        await order.save();

        const payload = {
            companyId: user.companyId,
            orderId: order.orderId,
            requestedBy: order.requestedBy,
            siteName: order.siteName,
            referenceId: order._id
        };
        eventBus.emit('ORDER_CREATED', payload);
        if (shouldBypassApproval) {
            eventBus.emit('ORDER_APPROVED', { ...payload, warehouseId: order.warehouseId });
            if (order.status === 'pending_dispatch' && order.warehouseId) {
                eventBus.emit('ORDER_ALLOTTED_FOR_DISPATCH', { ...payload, warehouseId: order.warehouseId });
            }
        } else {
            eventBus.emit('ORDER_SUBMITTED', payload);
        }

        return res.json({ success: true, message: 'Order submitted successfully', data: serializeOrder(order) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.listOrders = async (req, res) => {
    try {
        const scoped = await buildListScope(req);
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }

        const query = { ...scoped.query };
        const {
            search,
            status,
            siteId,
            warehouseId,
            fromDate,
            toDate,
            page = 1,
            limit = DEFAULT_LIMIT
        } = req.query;

        const rawStatuses = status
            ? String(status).split(',').map((s) => s.trim()).filter(Boolean)
            : [];
        const includeBackorders = rawStatuses.length === 0 || rawStatuses.includes('backorder');
        const orderStatuses = rawStatuses.filter((s) => s !== 'backorder');

        if (search) {
            const regex = new RegExp(String(search).trim(), 'i');
            query.$or = [{ orderId: regex }, { 'items.itemName': regex }, { requestedByName: regex }];
        }

        console.log('=== LIST ORDERS DEBUG ===');
        console.log('Raw status param:', status);
        console.log('Raw statuses array:', rawStatuses);
        console.log('Order statuses (filtered):', orderStatuses);

        if (rawStatuses.length) {
            if (orderStatuses.length) {
                const statusesToQuery = orderStatuses.includes('pending_dispatch')
                    ? [...orderStatuses, 'partially_approved']
                    : orderStatuses;
                query.status = { $in: statusesToQuery };
            } else {
                query._id = { $in: [] };
            }
        }

        if (siteId && mongoose.isValidObjectId(siteId)) {
            if (req.user.role === 'supervisor' && !isSupervisorAllowedForSite(req.user, siteId)) {
                return res.status(403).json({ success: false, message: 'Supervisor can only query assigned site(s)' });
            }
            query.siteId = new mongoose.Types.ObjectId(siteId);
        }

        if (warehouseId) {
            const warehouseIds = String(warehouseId)
                .split(',')
                .map((id) => id.trim())
                .filter((id) => mongoose.isValidObjectId(id))
                .map((id) => new mongoose.Types.ObjectId(id));
            if (warehouseIds.length) {
                if (req.user.role === 'warehouse_manager' && scoped.allowedWarehouseIds?.length) {
                    const allowedSet = new Set(scoped.allowedWarehouseIds.map((id) => String(id)));
                    const intersection = warehouseIds.filter((id) => allowedSet.has(String(id)));
                    if (!intersection.length) {
                        return res.status(403).json({ success: false, message: 'Warehouse access denied' });
                    }
                    query.warehouseId = intersection.length === 1 ? intersection[0] : { $in: intersection };
                } else {
                    query.warehouseId = warehouseIds.length === 1 ? warehouseIds[0] : { $in: warehouseIds };
                }
            }
        }

        if (fromDate || toDate) {
            query.createdAt = {};
            if (fromDate) query.createdAt.$gte = new Date(fromDate);
            if (toDate) query.createdAt.$lte = new Date(toDate);
        }

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const perPage = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT));
        const skip = (pageNum - 1) * perPage;
        const maxItems = pageNum * perPage;

        const backorderScope = { companyId: req.user.companyId };
        if (siteId && mongoose.isValidObjectId(siteId)) {
            backorderScope.siteId = new mongoose.Types.ObjectId(siteId);
        }
        if (req.user.role === 'warehouse_manager' && scoped.allowedWarehouseIds?.length) {
            const allowedOrderIds = await Order.distinct('_id', {
                $or: [
                    { warehouseId: { $in: scoped.allowedWarehouseIds } },
                    { receivingFrom: 'vendor_direct' }
                ]
            });
            backorderScope.orderId = { $in: allowedOrderIds.length ? allowedOrderIds : [] };
        }

        const orderIdsWithBackorders = await Backorder.distinct('orderId', backorderScope);
        if (orderIdsWithBackorders.length > 0) {
            if (query._id && query._id.$in) {
                query._id.$in = query._id.$in.filter((id) => !orderIdsWithBackorders.some((boId) => String(boId) === String(id)));
            } else if (query._id && query._id.$nin) {
                query._id.$nin = [...query._id.$nin, ...orderIdsWithBackorders];
            } else if (query._id) {
                query._id = { ...query._id, $nin: orderIdsWithBackorders };
            } else {
                query._id = { $nin: orderIdsWithBackorders };
            }
        }

        const [rows, totalOrders] = await Promise.all([
            Order.find(query)
                .sort({ createdAt: -1 })
                .limit(maxItems)
                .lean(),
            Order.countDocuments(query)
        ]);

        let backorderRows = [];
        let totalBackorders = 0;
        if (includeBackorders) {
            const backorderQuery = { companyId: req.user.companyId };
            if (siteId && mongoose.isValidObjectId(siteId)) {
                backorderQuery.siteId = new mongoose.Types.ObjectId(siteId);
            }
            if (req.user.role === 'warehouse_manager' && scoped.allowedWarehouseIds?.length) {
                const allowedOrderIds = await Order.distinct('_id', {
                    $or: [
                        { warehouseId: { $in: scoped.allowedWarehouseIds } },
                        { receivingFrom: 'vendor_direct' }
                    ]
                });
                backorderQuery.orderId = { $in: allowedOrderIds.length ? allowedOrderIds : [] };
            }
            if (fromDate || toDate) {
                backorderQuery.createdAt = {};
                if (fromDate) backorderQuery.createdAt.$gte = new Date(fromDate);
                if (toDate) backorderQuery.createdAt.$lte = new Date(toDate);
            }
            if (search) {
                const regex = new RegExp(String(search).trim(), 'i');
                backorderQuery.$or = [{ backorderCode: regex }, { itemName: regex }, { createdByName: regex }];
            }
            if (rawStatuses.length) {
                const backorderStatuses = rawStatuses.filter((s) => BACKORDER_STATUSES.includes(s));
                if (backorderStatuses.length) backorderQuery.status = { $in: backorderStatuses };
            }

            [backorderRows, totalBackorders] = await Promise.all([
                Backorder.find(backorderQuery)
                    .populate('siteId', 'siteName')
                    .populate('orderId', 'orderId siteName neededBy requestedByName receivingFrom')
                    .sort({ createdAt: -1 })
                    .limit(maxItems)
                    .lean(),
                Backorder.countDocuments(backorderQuery)
            ]);
        }

        const orderItems = rows.map((order) => {
            const totalItems = (order.items || []).length;
            const totalRequestedQty = (order.items || []).reduce((sum, item) => sum + toNumber(item.requestedQty, 0), 0);
            return {
                ...order,
                displayId: getDisplayId(order),
                totalItems,
                totalRequestedQty
            };
        });

        const backorderItems = backorderRows.map((backorder) => {
            const orderRef = backorder.orderId && typeof backorder.orderId === 'object' ? backorder.orderId : {};
            return {
                _id: backorder._id,
                orderRefId: orderRef._id || backorder.orderId,
                orderId: backorder.backorderCode || (orderRef.orderId ? `B-${orderRef.orderId}` : `B-${String(backorder._id).slice(-6).toUpperCase()}`),
                status: 'backorder',
                siteId: backorder.siteId,
                siteName: backorder.siteId?.siteName || orderRef.siteName || '',
                requestedByName: backorder.createdByName || orderRef.requestedByName || '',
                createdAt: backorder.createdAt,
                neededBy: backorder.expectedFulfillmentDate || orderRef.neededBy || null,
                receivingFrom: 'backorder',
                items: [
                    {
                        itemName: backorder.itemName,
                        requestedQty: backorder.backorderQty,
                        approvedQty: 0,
                        receivedQty: backorder.receivedQty || 0
                    }
                ],
                totalItems: 1,
                totalRequestedQty: backorder.backorderQty
            };
        });

        const combined = [...orderItems, ...backorderItems].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const items = combined.slice(skip, skip + perPage);
        const total = totalOrders + (includeBackorders ? totalBackorders : 0);

        console.log('=== ORDERS API RESPONSE ===');
        console.log('Query used:', JSON.stringify(query, null, 2));
        console.log('Total orders found:', totalOrders);
        console.log('Total backorders:', totalBackorders);
        console.log('Combined items:', items.length);
        console.log('First item:', items[0] ? `${items[0].orderId} - ${items[0].status}` : 'NONE');

        return res.json({
            success: true,
            data: {
                items,
                pagination: {
                    total,
                    page: pageNum,
                    limit: perPage,
                    totalPages: Math.max(1, Math.ceil(total / perPage))
                }
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getOrderById = async (req, res) => {
    try {
        const user = req.user;
        const { orderId } = req.params;

        const order = await Order.findOne({ _id: orderId, companyId: user.companyId })
            .populate('siteId', 'siteName')
            .populate('warehouseId', 'warehouseName')
            .populate('requestedBy', 'username firstName lastName fullName role');

        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        if (user.role === 'supervisor' && !isSupervisorAllowedForSite(user, order.siteId._id || order.siteId)) {
            return res.status(403).json({ success: false, message: 'Supervisor can only view assigned site orders' });
        }

        if (user.role === 'warehouse_manager') {
            const orderWarehouseId = order.warehouseId?._id || order.warehouseId;
            const isDirectToSite = order.receivingFrom === 'vendor_direct';
            if (!isDirectToSite && (!orderWarehouseId || !warehouseManagerHasAccess(user, orderWarehouseId))) {
                return res.status(403).json({ success: false, message: 'Warehouse access denied' });
            }
        }

        return res.json({ success: true, data: serializeOrder(order) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getOrderSummaryCards = async (req, res) => {
    try {
        const scoped = await buildListScope(req);
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }

        const baseQuery = { ...scoped.query };
        if (req.query.siteId && mongoose.isValidObjectId(req.query.siteId)) {
            baseQuery.siteId = new mongoose.Types.ObjectId(req.query.siteId);
        }

        const backorderScope = { companyId: req.user.companyId };
        if (req.query.siteId && mongoose.isValidObjectId(req.query.siteId)) {
            backorderScope.siteId = new mongoose.Types.ObjectId(req.query.siteId);
        }
        if (req.user.role === 'warehouse_manager' && scoped.allowedWarehouseIds?.length) {
            const allowedOrderIds = await Order.distinct('_id', {
                $or: [
                    { warehouseId: { $in: scoped.allowedWarehouseIds } },
                    { receivingFrom: 'vendor_direct' }
                ]
            });
            backorderScope.orderId = { $in: allowedOrderIds.length ? allowedOrderIds : [] };
        }

        const orderIdsWithBackorders = await Backorder.distinct('orderId', backorderScope);
        const orderExclusion = orderIdsWithBackorders.length > 0 ? { _id: { $nin: orderIdsWithBackorders } } : {};

        const data = {};
        // eslint-disable-next-line no-restricted-syntax
        for (const s of DASHBOARD_CARD_STATUSES) {
            // eslint-disable-next-line no-await-in-loop
            const statusCriteria = s === 'pending_dispatch'
                ? { $in: ['pending_dispatch', 'partially_approved'] }
                : s;
            data[s] = await Order.countDocuments({ ...baseQuery, ...orderExclusion, status: statusCriteria });
        }

        data.backorder = await Backorder.countDocuments(backorderScope);

        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.approveOrder = async (req, res) => {
    try {
        const user = req.user;
        if (!canApproveOrder(user.role)) {
            return res.status(403).json({ success: false, message: 'Only admin/company owner can approve orders' });
        }

        const { orderId } = req.params;
        const { itemApprovals } = req.body;

        const order = await Order.findOne({ _id: orderId, companyId: user.companyId });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        if (!['pending_approval'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'Only pending approval orders can be approved' });
        }

        let approvedItems = 0;
        let rejectedItems = 0;

        const approvalMap = new Map();
        if (Array.isArray(itemApprovals)) {
            for (const row of itemApprovals) {
                if (row?.itemId && mongoose.isValidObjectId(row.itemId)) {
                    approvalMap.set(String(row.itemId), row);
                }
            }
        }

        order.items = order.items.map((item) => {
            const override = approvalMap.get(String(item._id));
            if (!override) {
                item.approvedQty = item.requestedQty;
                item.approvalDecision = 'approved';
                approvedItems += 1;
                return item;
            }

            const approvedQty = Math.max(0, toNumber(override.approvedQty, 0));
            const capped = Math.min(item.requestedQty, approvedQty);

            item.approvedQty = capped;
            if (capped <= 0) {
                item.approvalDecision = 'rejected';
                rejectedItems += 1;
            } else if (capped < item.requestedQty) {
                item.approvalDecision = 'partial';
                approvedItems += 1;
                rejectedItems += 1;
            } else {
                item.approvalDecision = 'approved';
                approvedItems += 1;
            }
            item.remarks = toTrimmed(override.remarks || item.remarks);
            return item;
        });

        if (approvedItems === 0) {
            order.status = 'rejected';
        } else if (rejectedItems > 0) {
            order.status = 'partially_approved';
            order.currentStage = 'ORD';
        } else {
            order.status = 'pending_dispatch';
            order.currentStage = 'ORD';
        }

        order.approvedBy = user._id;
        order.approvedByName = safeUserName(user);
        order.approvedAt = new Date();

        pushTimeline(order, {
            eventType: 'order_approved',
            user,
            note: `Order ${order.status.replace('_', ' ')}`,
            meta: { approvedItems, rejectedItems }
        });

        await order.save();

        eventBus.emit(order.status === 'partially_approved' ? 'ORDER_PARTIALLY_APPROVED' : 'ORDER_APPROVED', {
            companyId: user.companyId,
            orderId: order.orderId,
            requestedBy: order.requestedBy,
            siteName: order.siteName,
            referenceId: order._id,
            warehouseId: order.warehouseId
        });

        if (['pending_dispatch', 'partially_approved'].includes(order.status) && order.warehouseId) {
            eventBus.emit('ORDER_ALLOTTED_FOR_DISPATCH', {
                companyId: user.companyId,
                orderId: order.orderId,
                requestedBy: order.requestedBy,
                siteName: order.siteName,
                referenceId: order._id,
                warehouseId: order.warehouseId
            });
        }

        return res.json({ success: true, data: serializeOrder(order) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.rejectOrder = async (req, res) => {
    try {
        const user = req.user;
        if (!canApproveOrder(user.role)) {
            return res.status(403).json({ success: false, message: 'Only admin/company owner can reject orders' });
        }

        const { orderId } = req.params;
        const { reason } = req.body;

        const order = await Order.findOne({ _id: orderId, companyId: user.companyId });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        if (!['pending_approval'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'Only pending approval orders can be rejected' });
        }

        order.status = 'rejected';
        order.items = order.items.map((item) => {
            item.approvedQty = 0;
            item.approvalDecision = 'rejected';
            return item;
        });

        order.rejectedBy = user._id;
        order.rejectedByName = safeUserName(user);
        order.rejectedAt = new Date();
        order.rejectionReason = toTrimmed(reason || 'Rejected by admin');

        pushTimeline(order, {
            eventType: 'order_rejected',
            user,
            note: order.rejectionReason
        });

        await order.save();
        eventBus.emit('ORDER_REJECTED', {
            companyId: user.companyId,
            orderId: order.orderId,
            requestedBy: order.requestedBy,
            siteName: order.siteName,
            referenceId: order._id
        });
        return res.json({ success: true, data: serializeOrder(order) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.dispatchOrder = async (req, res) => {
    try {
        const user = req.user;
        if (!['admin', 'company_owner', 'warehouse_manager'].includes(user.role)) {
            return res.status(403).json({ success: false, message: 'Only admin/company owner/warehouse manager can dispatch orders' });
        }

        const { orderId } = req.params;
        const { items, dispatchId, remarks, dispatchPhotos } = req.body;

        const order = await Order.findOne({ _id: orderId, companyId: user.companyId });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        if (user.role === 'warehouse_manager') {
            const orderWarehouseId = order.warehouseId?._id || order.warehouseId;
            // Direct site orders (no warehouseId) can be dispatched by any warehouse manager.
            // For warehouse-transfer orders, enforce that the manager owns the assigned warehouse.
            if (orderWarehouseId && !warehouseManagerHasAccess(user, orderWarehouseId)) {
                return res.status(403).json({ success: false, message: 'Warehouse access denied' });
            }
        }

        if (!['approved', 'partially_approved', 'pending_dispatch', 'in_fulfillment'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'Order is not in dispatchable state' });
        }

        const dispatchIdValue = toTrimmed(dispatchId || `DSP-${Date.now()}`);

        const byItemId = new Map();
        if (Array.isArray(items)) {
            items.forEach((item) => {
                if (item?.itemId && mongoose.isValidObjectId(item.itemId)) {
                    byItemId.set(String(item.itemId), Math.max(0, toNumber(item.dispatchedQty, 0)));
                }
            });
        }

        if (order.receivingFrom === 'warehouse') {
            if (!order.warehouseId) {
                return res.status(400).json({ success: false, message: 'Warehouse is required for this order flow' });
            }

            const warehouse = await getWarehouseForUser(order.warehouseId, user);
            if (!warehouse) {
                return res.status(403).json({ success: false, message: 'Warehouse access denied or not found' });
            }

            for (const item of order.items) {
                const targetQty = byItemId.has(String(item._id))
                    ? byItemId.get(String(item._id))
                    : Math.max(0, toNumber(item.approvedQty, 0));

                const cappedQty = Math.min(targetQty, Math.max(0, toNumber(item.approvedQty, 0)));
                item.dispatchedQty = cappedQty;

                if (!cappedQty) continue;
                if (item.isCustomItem) continue;

                // eslint-disable-next-line no-await-in-loop
                const inventoryItem = await InventoryItem.findOne({
                    warehouseId: warehouse._id,
                    itemName: new RegExp(`^${String(item.itemName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
                });

                if (!inventoryItem) {
                    return res.status(400).json({ success: false, message: `Inventory item not found for ${item.itemName}` });
                }

                if (!warehouse.activityLogs) warehouse.activityLogs = [];
                warehouse.activityLogs.push({
                    action: 'order_dispatched',
                    performedBy: user._id,
                    performedByName: user.username || safeUserName(user),
                    performedByRole: user.role,
                    timestamp: new Date(),
                    details: {
                        orderId: order.orderId,
                        orderRefId: order._id,
                        siteName: order.siteName,
                        itemId: inventoryItem._id,
                        itemName: inventoryItem.itemName,
                        uid: inventoryItem.uid,
                        uom: inventoryItem.uom || item.uom || '',
                        dispatchedQty: cappedQty,
                        availableQtyBefore: toNumber(inventoryItem.availableQty, 0),
                        availableQtyAfter: toNumber(inventoryItem.availableQty, 0),
                        warehouseId: warehouse._id,
                        dispatchId: dispatchIdValue
                    },
                    description: `${user.username} dispatched ${cappedQty} ${inventoryItem.uom || item.uom || ''} of "${inventoryItem.itemName}" for order ${order.orderId} to ${order.siteName}`
                });
            }

            await warehouse.save();
        } else {
            order.items = order.items.map((item) => {
                const targetQty = byItemId.has(String(item._id))
                    ? byItemId.get(String(item._id))
                    : Math.max(0, toNumber(item.approvedQty, 0));
                item.dispatchedQty = Math.min(targetQty, Math.max(0, toNumber(item.approvedQty, 0)));
                return item;
            });
        }

        order.status = 'awaiting_receipt';
        order.dispatchId = dispatchIdValue;
        order.dispatchedBy = user._id;
        order.dispatchedByName = safeUserName(user);
        order.dispatchedAt = new Date();

        // Add dispatch remarks and photos if provided
        if (remarks) {
            order.dispatchRemarks = toTrimmed(remarks);
        }
        if (Array.isArray(dispatchPhotos) && dispatchPhotos.length > 0) {
            const uploadedPhotos = await Promise.all(
                dispatchPhotos.map(async (photo, index) => {
                    if (typeof photo === 'string' && photo.startsWith('data:image')) {
                        return uploadDispatchPhotoToR2(photo, order._id, index);
                    }
                    return photo;
                })
            );
            order.dispatchPhotos = uploadedPhotos.filter(Boolean);
        }

        // Update status to awaiting_receipt (ready for GRN logging)
        order.status = 'awaiting_receipt';
        order.currentStage = 'DIS';

        pushTimeline(order, {
            eventType: 'order_dispatched',
            user,
            note: `Dispatch created ${order.dispatchId}${remarks ? ` - ${remarks}` : ''}`,
            meta: {
                remarks: toTrimmed(remarks),
                photos: order.dispatchPhotos || []
            }
        });

        await order.save();
        eventBus.emit('ORDER_DISPATCHED', {
            companyId: user.companyId,
            orderId: order.orderId,
            requestedBy: order.requestedBy,
            siteName: order.siteName,
            referenceId: order._id
        });

        // Schedule 2-hour reminder for receiving
        const delayMs = 2 * 60 * 60 * 1000;
        await enqueue(NOTIFICATION_TYPES.ORDER_RECEIVING_REMINDER, {
            companyId: user.companyId,
            orderId: order.orderId,
            requestedBy: order.requestedBy,
            siteName: order.siteName,
            referenceId: order._id
        }, { delay: delayMs });

        return res.json({ success: true, data: serializeOrder(order) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.receiveOrder = async (req, res) => {
    try {
        const user = req.user;
        if (!['admin', 'company_owner', 'supervisor', 'warehouse_manager'].includes(user.role)) {
            return res.status(403).json({ success: false, message: 'You are not allowed to receive orders' });
        }

        const { orderId } = req.params;
        const { items } = req.body;

        const order = await Order.findOne({ _id: orderId, companyId: user.companyId });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        if (user.role === 'supervisor' && !isSupervisorAllowedForSite(user, order.siteId)) {
            return res.status(403).json({ success: false, message: 'Supervisor can only receive for assigned site(s)' });
        }

        if (!['awaiting_receipt', 'dispatched'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'Order is not awaiting receipt' });
        }

        const byItemId = new Map();
        if (Array.isArray(items)) {
            items.forEach((item) => {
                if (item?.itemId && mongoose.isValidObjectId(item.itemId)) {
                    byItemId.set(String(item.itemId), Math.max(0, toNumber(item.receivedQty, 0)));
                }
            });
        }

        // Compute receivedQty for each order item and build GRN items.
        // site.supplies must NOT be updated here — that only happens when the GRN is authenticated.
        const grnItems = [];
        for (const item of order.items) {
            const targetQty = byItemId.has(String(item._id))
                ? byItemId.get(String(item._id))
                : Math.max(0, toNumber(item.dispatchedQty || item.approvedQty, 0));
            const cap = Math.min(targetQty, Math.max(0, toNumber(item.dispatchedQty || item.approvedQty, 0)));
            item.receivedQty = cap;

            if (!cap) continue;

            // Fetch price from warehouse inventory immediately so warehouse manager can see it
            let itemPrice = 0;
            if (order.warehouseId && item.inventoryItemId && order.receivingFrom !== 'vendor_direct') {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const invItem = await InventoryItem.findById(item.inventoryItemId)
                        .select('avgPrice currentPrice entryPrice').lean();
                    if (invItem) {
                        itemPrice = invItem.avgPrice || invItem.currentPrice || invItem.entryPrice || 0;
                    }
                } catch (err) {
                    console.error('Error fetching inventory price:', err);
                    // Continue with price 0 if fetch fails
                }
            }

            grnItems.push({
                itemName: item.itemName,
                inventoryItemId: item.inventoryItemId || undefined,
                uom: item.uom,
                dispatchedQty: Math.max(0, toNumber(item.dispatchedQty, 0)),
                receivedQty: cap,
                price: itemPrice, // Fetched from warehouse inventory at receipt time
                discrepancy: cap - Math.max(0, toNumber(item.dispatchedQty || item.approvedQty, 0)),
                remarks: ''
            });
        }

        if (grnItems.length === 0) {
            return res.status(400).json({ success: false, message: 'No items to receive' });
        }

        // Generate a GRN ID, deriving from orderId when possible
        let grnIdStr;
        if (order.orderId && typeof order.orderId === 'string') {
            const parts = order.orderId.split('-');
            if (parts.length > 1) {
                const candidate = `GRN-${parts.slice(1).join('-')}`;
                // eslint-disable-next-line no-await-in-loop
                if (!(await GRN.exists({ grnId: candidate }))) grnIdStr = candidate;
            }
        }
        if (!grnIdStr) {
            const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            for (let i = 0; i < 10; i += 1) {
                const rand = Math.floor(1000 + Math.random() * 9000);
                const candidate = `GRN-${stamp}-${rand}`;
                // eslint-disable-next-line no-await-in-loop
                if (!(await GRN.exists({ grnId: candidate }))) { grnIdStr = candidate; break; }
            }
        }
        if (!grnIdStr) {
            return res.status(500).json({ success: false, message: 'Unable to generate GRN id. Please retry.' });
        }

        const grn = await GRN.create({
            grnId: grnIdStr,
            grnType: 'order_based',
            companyId: user.companyId,
            orderId: order._id,
            siteId: order.siteId,
            siteName: order.siteName,
            warehouseId: order.warehouseId,
            createdBy: user._id,
            createdByName: safeUserName(user),
            createdByRole: user.role,
            receivingFrom: order.receivingFrom || 'warehouse',
            vendorName: order.vendorName || '',
            items: grnItems,
            status: 'pending_authentication',
            timeline: [{
                eventType: 'grn_created',
                actorId: user._id,
                actorName: safeUserName(user),
                actorRole: user.role,
                note: 'GRN created from order receipt — pending warehouse manager authentication',
                timestamp: new Date()
            }]
        });

        // Link GRN to order; site.supplies is updated only when the GRN is authenticated
        order.grnId = grn._id;
        order.grnCode = grn.grnId;
        order.currentStage = 'DEL';
        order.receivedBy = user._id;
        order.receivedByName = safeUserName(user);
        order.receivedAt = new Date();
        order.status = 'received';

        pushTimeline(order, {
            eventType: 'order_received',
            user,
            note: 'Order received at site, pending GRN authentication'
        });

        await order.save();
        eventBus.emit('ORDER_RECEIVED', {
            companyId: user.companyId,
            orderId: order.orderId,
            requestedBy: order.requestedBy,
            siteName: order.siteName,
            referenceId: order._id,
            dispatchedBy: order.dispatchedBy
        });

        return res.json({ success: true, data: serializeOrder(order) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.cancelOrder = async (req, res) => {
    try {
        const user = req.user;
        const { orderId } = req.params;
        const { reason } = req.body;

        const order = await Order.findOne({ _id: orderId, companyId: user.companyId });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        const isOwner = order.requestedBy.toString() === user._id.toString();
        const isAdmin = ['admin', 'company_owner'].includes(user.role);

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Only creator/admin can cancel this order' });
        }

        if (!['draft', 'pending_approval'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'Order cannot be cancelled after approval' });
        }

        order.status = 'cancelled';
        order.cancelledBy = user._id;
        order.cancelledByName = safeUserName(user);
        order.cancelledAt = new Date();
        order.cancellationReason = toTrimmed(reason || 'Cancelled by requester');

        pushTimeline(order, {
            eventType: 'order_cancelled',
            user,
            note: order.cancellationReason
        });

        await order.save();
        eventBus.emit('ORDER_CANCELLED', {
            companyId: user.companyId,
            orderId: order.orderId,
            requestedBy: order.requestedBy,
            siteName: order.siteName,
            referenceId: order._id
        });

        return res.json({ success: true, data: serializeOrder(order) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};