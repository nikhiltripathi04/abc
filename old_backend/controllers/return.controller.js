const mongoose = require('mongoose');
const { SiteReturn, RETURN_STATUSES } = require('../models/SiteReturn');
const { ApprovalLog } = require('../models/ApprovalLog');
const { GRN } = require('../models/GRN');
const Site = require('../models/Site');
const Warehouse = require('../models/Warehouse');
const InventoryItem = require('../models/InventoryItem');
const User = require('../models/User');
const { Order } = require('../models/Order');
const ActivityLogger = require('../utils/activityLogger');
const eventBus = require('../core/eventBus');

// Helper function to generate return ID
const generateReturnId = async (siteId) => {
    try {
        const site = await Site.findById(siteId);
        if (!site) {
            throw new Error('Site not found');
        }

        const siteName = site.siteName || 'SITE';
        const siteCode = siteName.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');

        // Use local timezone for exact date consistency
        const today = new Date();

        // Pad year, month, date to ensure 2 digit month/date
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const dateStr = `${year}${month}${day}`;

        // Find the last return for this site today using a fresh Date object
        const startOfDay = new Date(year, today.getMonth(), today.getDate(), 0, 0, 0, 0);
        const endOfDay = new Date(year, today.getMonth(), today.getDate(), 23, 59, 59, 999);

        const lastReturn = await SiteReturn.findOne({
            siteId,
            createdAt: { $gte: startOfDay, $lte: endOfDay }
        }).sort({ createdAt: -1 });

        let sequence = 1;
        if (lastReturn && lastReturn.returnId) {
            const match = lastReturn.returnId.match(/-(\d+)$/);
            if (match) {
                sequence = parseInt(match[1]) + 1;
            }
        }

        return `RET-${siteCode}-${dateStr}-${String(sequence).padStart(3, '0')}`;
    } catch (error) {
        console.error('Error generating return ID:', error);
        throw error;
    }
};

/**
 * POST /api/returns
 * Create new return request
 */
exports.createReturn = async (req, res) => {
    try {
        const {
            siteId,
            warehouseId,
            items,
            sourceType,
            sourceOrderId,
            returnReason,
            returnNotes
        } = req.body;

        const userId = req.user._id;
        const userRole = req.user.role;
        const companyId = req.user.companyId;

        // Validate required fields
        if (!siteId || !warehouseId || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Site ID, warehouse ID, and items are required'
            });
        }

        if (!sourceType || !['site_supply', 'authenticated_order'].includes(sourceType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid source type'
            });
        }

        // Fetch site and warehouse
        const site = await Site.findById(siteId);
        if (!site) {
            return res.status(404).json({
                success: false,
                message: 'Site not found'
            });
        }

        const warehouse = await Warehouse.findById(warehouseId);
        if (!warehouse) {
            return res.status(404).json({
                success: false,
                message: 'Warehouse not found'
            });
        }

        // Fetch user details
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Validate and prepare items
        const returnItems = [];
        const errors = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            if (!item.itemName || !item.requestedReturnQty || item.requestedReturnQty <= 0) {
                errors.push(`Item ${i + 1}: Item name and valid return quantity are required`);
                continue;
            }

            // Find the item in site supplies
            const siteSupply = site.supplies.find(
                s => s.itemName.toLowerCase().trim() === item.itemName.toLowerCase().trim()
            );

            if (!siteSupply) {
                errors.push(`Item "${item.itemName}": Not found in site supplies`);
                continue;
            }

            if (siteSupply.quantity < item.requestedReturnQty) {
                errors.push(`Item "${item.itemName}": Insufficient quantity in site (available: ${siteSupply.quantity}, requested: ${item.requestedReturnQty})`);
                continue;
            }

            // Try to find matching inventory item
            let inventoryItemId = null;
            const inventoryItem = await InventoryItem.findOne({
                companyId,
                itemName: { $regex: new RegExp(`^${item.itemName.trim()}$`, 'i') },
                isActive: true
            });

            if (inventoryItem) {
                inventoryItemId = inventoryItem._id;
            }

            returnItems.push({
                itemName: item.itemName.trim(),
                inventoryItemId,
                requestedReturnQty: item.requestedReturnQty,
                approvedReturnQty: 0,
                receivedQty: 0,
                uom: item.uom || siteSupply.unit || 'pcs',
                currentSiteQty: siteSupply.quantity,
                reasonForReturn: item.reasonForReturn || 'other',
                itemRemarks: item.itemRemarks || ''
            });
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Validation errors',
                errors
            });
        }

        if (returnItems.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid items to return'
            });
        }

        // Generate return ID
        const returnId = await generateReturnId(siteId);

        // Handle source order if provided
        let sourceOrderCode = '';
        if (sourceType === 'authenticated_order' && sourceOrderId) {
            const order = await Order.findById(sourceOrderId);
            if (order) {
                sourceOrderCode = order.orderId;
            }
        }

        // Create return request
        const siteReturn = new SiteReturn({
            returnId,
            companyId,
            siteId,
            siteName: site.siteName,
            warehouseId,
            warehouseName: warehouse.warehouseName,
            requestedBy: userId,
            requestedByName: user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username) || 'Unknown',
            requestedByRole: userRole,
            status: 'pending',
            items: returnItems,
            sourceType,
            sourceOrderId: sourceOrderId || null,
            sourceOrderCode,
            returnReason: returnReason || '',
            returnNotes: returnNotes || '',
            timeline: [{
                eventType: 'return_created',
                actorId: userId,
                actorName: user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username) || 'Unknown',
                actorRole: userRole,
                note: `Return request created with ${returnItems.length} item(s)`,
                timestamp: new Date()
            }]
        });

        await siteReturn.save();

        // Log activity in site
        await ActivityLogger.logActivity(
            siteId,
            'item_return_requested',
            userId,
            {
                returnId: siteReturn.returnId,
                itemCount: returnItems.length,
                warehouseName: warehouse.warehouseName
            },
            `${user.fullName || user.username || 'Unknown'} requested return of ${returnItems.length} item(s) to ${warehouse.warehouseName}`,
            'Site'
        );

        // Log activity in warehouse
        await ActivityLogger.logActivity(
            warehouseId,
            'return_received',
            userId,
            {
                returnId: siteReturn.returnId,
                siteName: site.siteName,
                itemCount: returnItems.length
            },
            `Return request received from ${site.siteName} with ${returnItems.length} item(s)`,
            'Warehouse'
        );

        // Emit event for notifications
        eventBus.emit('site_return_created', {
            returnId: siteReturn._id,
            returnCode: returnId,
            siteId,
            siteName: site.siteName,
            warehouseId,
            warehouseName: warehouse.warehouseName,
            requestedBy: userId,
            requestedByName: user.fullName || user.username || 'Unknown',
            itemCount: returnItems.length,
            companyId
        });

        res.status(201).json({
            success: true,
            message: 'Return request created successfully',
            data: siteReturn
        });
    } catch (error) {
        console.error('Create return error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create return request',
            error: error.message
        });
    }
};

/**
 * GET /api/returns
 * Get returns with filters
 */
exports.getReturns = async (req, res) => {
    try {
        const {
            status,
            siteId,
            warehouseId,
            requestedBy,
            dateFrom,
            dateTo,
            page = 1,
            limit = 20,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const companyId = req.user.companyId;
        const userRole = req.user.role;
        const userId = req.user._id;

        const query = { companyId };

        // Apply filters based on role
        if (userRole === 'supervisor') {
            // Supervisors can only see their own returns
            query.requestedBy = userId;
        } else if (userRole === 'warehouse_manager') {
            // Warehouse managers can see returns for their assigned warehouses
            const manager = await User.findById(userId);
            if (manager && manager.assignedWarehouses && manager.assignedWarehouses.length > 0) {
                query.warehouseId = { $in: manager.assignedWarehouses };
            } else if (manager && manager.warehouseId) {
                // fallback to legacy field
                query.warehouseId = manager.warehouseId;
            }
        }
        // Admins can see all returns (no additional filter)

        // Apply query filters
        if (status) {
            query.status = status;
        }

        if (siteId) {
            query.siteId = siteId;
        }

        if (warehouseId && userRole !== 'warehouse_manager') {
            query.warehouseId = warehouseId;
        }

        if (requestedBy) {
            query.requestedBy = requestedBy;
        }

        if (dateFrom || dateTo) {
            query.createdAt = {};
            if (dateFrom) {
                query.createdAt.$gte = new Date(dateFrom);
            }
            if (dateTo) {
                const endDate = new Date(dateTo);
                endDate.setHours(23, 59, 59, 999);
                query.createdAt.$lte = endDate;
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortDir = sortOrder === 'asc' ? 1 : -1;
        const sortField = sortBy || 'createdAt';

        const [returns, total] = await Promise.all([
            SiteReturn.find(query)
                .sort({ [sortField]: sortDir })
                .skip(skip)
                .limit(parseInt(limit))
                .populate('siteId', 'siteName')
                .populate('warehouseId', 'warehouseName')
                .populate('requestedBy', 'fullName firstName lastName username email')
                .populate('timeline.actorId', 'fullName firstName lastName username')
                .lean(),
            SiteReturn.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: {
                items: returns,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(total / parseInt(limit)),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('Get returns error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch returns',
            error: error.message
        });
    }
};

/**
 * GET /api/returns/:returnId
 * Get single return by ID
 */
exports.getReturnById = async (req, res) => {
    try {
        const { returnId } = req.params;
        const companyId = req.user.companyId;

        const siteReturn = await SiteReturn.findOne({
            _id: returnId,
            companyId
        })
            .populate('siteId', 'siteName address')
            .populate('warehouseId', 'warehouseName address')
            .populate('requestedBy', 'fullName firstName lastName username email phone')
            .populate('approvalDetails.approvedBy', 'fullName firstName lastName username email')
            .populate('receivingDetails.receivedBy', 'fullName firstName lastName username email')
            .populate('rejectedBy', 'fullName firstName lastName username email')
            .populate('timeline.actorId', 'fullName firstName lastName username');

        if (!siteReturn) {
            return res.status(404).json({
                success: false,
                message: 'Return request not found'
            });
        }

        res.json({
            success: true,
            data: siteReturn
        });
    } catch (error) {
        console.error('Get return by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch return details',
            error: error.message
        });
    }
};

/**
 * PATCH /api/returns/:returnId/approve
 * Approve return request
 */
exports.approveReturn = async (req, res) => {
    try {
        const { returnId } = req.params;
        const { approvalNotes, items } = req.body;

        const userId = req.user._id;
        const userRole = req.user.role;
        const companyId = req.user.companyId;

        // Verify user is warehouse manager
        if (userRole !== 'warehouse_manager') {
            return res.status(403).json({
                success: false,
                message: 'Only warehouse managers can approve returns'
            });
        }

        const siteReturn = await SiteReturn.findOne({
            _id: returnId,
            companyId
        });

        if (!siteReturn) {
            return res.status(404).json({
                success: false,
                message: 'Return request not found'
            });
        }

        if (siteReturn.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Cannot approve return with status: ${siteReturn.status}`
            });
        }

        // If warehouse manager, verify they manage this warehouse
        if (userRole === 'warehouse_manager') {
            const manager = await User.findById(userId);
            const isAssigned =
                (manager.warehouseId && manager.warehouseId.toString() === siteReturn.warehouseId.toString()) ||
                (manager.assignedWarehouses && manager.assignedWarehouses.some(w => w.toString() === siteReturn.warehouseId.toString()));

            if (!isAssigned) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only approve returns for your assigned warehouse'
                });
            }
        }

        const user = await User.findById(userId);

        // Update approved quantities
        if (items && Array.isArray(items)) {
            siteReturn.items.forEach((returnItem, index) => {
                const approvalItem = items.find(i => i.itemName === returnItem.itemName);
                if (approvalItem && approvalItem.approvedReturnQty !== undefined) {
                    returnItem.approvedReturnQty = Math.min(
                        approvalItem.approvedReturnQty,
                        returnItem.requestedReturnQty
                    );
                } else {
                    // Default: approve full requested quantity
                    returnItem.approvedReturnQty = returnItem.requestedReturnQty;
                }
            });
        } else {
            // Approve all items with requested quantities
            siteReturn.items.forEach(item => {
                item.approvedReturnQty = item.requestedReturnQty;
            });
        }

        // Update return status and approval details
        siteReturn.status = 'approved';
        siteReturn.approvalDetails = {
            approvedBy: userId,
            approvedByName: user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username) || 'Unknown',
            approvedAt: new Date(),
            approvalNotes: approvalNotes || ''
        };

        siteReturn.timeline.push({
            eventType: 'return_approved',
            actorId: userId,
            actorName: user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username) || 'Unknown',
            actorRole: userRole,
            note: approvalNotes || 'Return request approved.',
            timestamp: new Date()
        });

        await siteReturn.save();

        // Deduct approved quantities from site supplies
        const site = await Site.findById(siteReturn.siteId);
        if (site) {
            for (const returnItem of siteReturn.items) {
                const qtyToDeduct = returnItem.approvedReturnQty;
                if (qtyToDeduct > 0) {
                    const supplyIndex = site.supplies.findIndex(
                        s => s.itemName.toLowerCase().trim() === returnItem.itemName.toLowerCase().trim()
                    );
                    if (supplyIndex !== -1) {
                        const currentQty = site.supplies[supplyIndex].quantity;
                        site.supplies[supplyIndex].quantity = Math.max(0, currentQty - qtyToDeduct);
                    }
                }
            }
            await site.save();
        }

        // Add approved quantities back to destination warehouse (InventoryItem + warehouse.supplies)
        const warehouse = await Warehouse.findById(siteReturn.warehouseId);
        if (warehouse) {
            for (const returnItem of siteReturn.items) {
                const qtyToAdd = returnItem.approvedReturnQty;
                if (qtyToAdd <= 0) continue;

                // 1. Update InventoryItem.availableQty (primary source of truth)
                const inventoryItem = await InventoryItem.findOne({
                    warehouseId: siteReturn.warehouseId,
                    companyId,
                    itemName: { $regex: new RegExp(`^${returnItem.itemName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                    isActive: true
                });

                if (inventoryItem) {
                    inventoryItem.availableQty += qtyToAdd;
                    await inventoryItem.save();

                    // 2. Sync warehouse.supplies to match InventoryItem (legacy display)
                    const supplyIndex = warehouse.supplies.findIndex(
                        s => s.itemName.toLowerCase().trim() === returnItem.itemName.toLowerCase().trim()
                    );
                    if (supplyIndex !== -1) {
                        warehouse.supplies[supplyIndex].quantity = inventoryItem.availableQty;
                    } else {
                        warehouse.supplies.push({
                            itemName: inventoryItem.itemName,
                            quantity: inventoryItem.availableQty,
                            unit: inventoryItem.uom || returnItem.uom || 'pcs',
                            currency: inventoryItem.currency || '₹',
                            entryPrice: inventoryItem.entryPrice || 0,
                            currentPrice: inventoryItem.currentPrice || 0
                        });
                    }
                } else {
                    // InventoryItem not found — fall back to updating warehouse.supplies only
                    const supplyIndex = warehouse.supplies.findIndex(
                        s => s.itemName.toLowerCase().trim() === returnItem.itemName.toLowerCase().trim()
                    );
                    if (supplyIndex !== -1) {
                        warehouse.supplies[supplyIndex].quantity =
                            (warehouse.supplies[supplyIndex].quantity || 0) + qtyToAdd;
                    } else {
                        warehouse.supplies.push({
                            itemName: returnItem.itemName,
                            quantity: qtyToAdd,
                            unit: returnItem.uom || 'pcs'
                        });
                    }
                }
            }
            await warehouse.save();
        }

        // Create approval log
        const approvalLog = new ApprovalLog({
            approvalType: 'site_return',
            referenceId: siteReturn._id,
            referenceName: siteReturn.returnId,
            companyId,
            siteId: siteReturn.siteId,
            adminId: userId,
            adminName: user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username) || 'Unknown',
            status: 'approved',
            totalItems: siteReturn.items.length,
            approvedItems: siteReturn.items.length,
            remarks: approvalNotes || '',
            completedAt: new Date()
        });

        await approvalLog.save();

        // Log activity
        await ActivityLogger.logActivity(
            siteReturn.siteId,
            'item_return_approved',
            userId,
            {
                returnId: siteReturn.returnId,
                approvedBy: user.fullName || user.username || 'Unknown'
            },
            `Return request ${siteReturn.returnId} approved by ${user.fullName || user.username || 'Unknown'}`,
            'Site'
        );

        await ActivityLogger.logActivity(
            siteReturn.warehouseId,
            'return_approved',
            userId,
            {
                returnId: siteReturn.returnId,
                siteName: siteReturn.siteName
            },
            `Return request ${siteReturn.returnId} from ${siteReturn.siteName} approved`,
            'Warehouse'
        );

        // Emit event
        eventBus.emit('site_return_approved', {
            returnId: siteReturn._id,
            returnCode: siteReturn.returnId,
            siteId: siteReturn.siteId,
            siteName: siteReturn.siteName,
            warehouseId: siteReturn.warehouseId,
            approvedBy: userId,
            approvedByName: user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username) || 'Unknown',
            requestedBy: siteReturn.requestedBy,
            companyId
        });

        res.json({
            success: true,
            message: 'Return request approved successfully',
            data: siteReturn
        });
    } catch (error) {
        console.error('Approve return error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve return request',
            error: error.message
        });
    }
};

/**
 * PATCH /api/returns/:returnId/reject
 * Reject return request
 */
exports.rejectReturn = async (req, res) => {
    try {
        const { returnId } = req.params;
        const { rejectionReason } = req.body;

        const userId = req.user._id;
        const userRole = req.user.role;
        const companyId = req.user.companyId;

        if (userRole !== 'warehouse_manager') {
            return res.status(403).json({
                success: false,
                message: 'Only warehouse managers can reject returns'
            });
        }

        if (!rejectionReason || rejectionReason.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Rejection reason is required'
            });
        }

        const siteReturn = await SiteReturn.findOne({
            _id: returnId,
            companyId
        });

        if (!siteReturn) {
            return res.status(404).json({
                success: false,
                message: 'Return request not found'
            });
        }

        if (siteReturn.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Cannot reject return with status: ${siteReturn.status}`
            });
        }

        // If warehouse manager, verify they manage this warehouse
        if (userRole === 'warehouse_manager') {
            const manager = await User.findById(userId);
            const isAssigned =
                (manager.warehouseId && manager.warehouseId.toString() === siteReturn.warehouseId.toString()) ||
                (manager.assignedWarehouses && manager.assignedWarehouses.some(w => w.toString() === siteReturn.warehouseId.toString()));

            if (!isAssigned) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only reject returns for your assigned warehouse'
                });
            }
        }

        const user = await User.findById(userId);

        siteReturn.status = 'rejected';
        siteReturn.rejectedBy = userId;
        siteReturn.rejectedByName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username) || 'Unknown';
        siteReturn.rejectedAt = new Date();
        siteReturn.rejectionReason = rejectionReason;

        siteReturn.timeline.push({
            eventType: 'return_rejected',
            actorId: userId,
            actorName: user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username) || 'Unknown',
            actorRole: userRole,
            note: rejectionReason,
            timestamp: new Date()
        });

        await siteReturn.save();

        // Create approval log
        const approvalLog = new ApprovalLog({
            approvalType: 'site_return',
            referenceId: siteReturn._id,
            referenceName: siteReturn.returnId,
            companyId,
            siteId: siteReturn.siteId,
            adminId: userId,
            adminName: user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username) || 'Unknown',
            status: 'rejected',
            totalItems: siteReturn.items.length,
            rejectedItems: siteReturn.items.length,
            remarks: rejectionReason,
            completedAt: new Date()
        });

        await approvalLog.save();

        // Log activity
        await ActivityLogger.logActivity(
            siteReturn.siteId,
            'item_return_rejected',
            userId,
            {
                returnId: siteReturn.returnId,
                rejectedBy: user.fullName || user.username || 'Unknown',
                reason: rejectionReason
            },
            `Return request ${siteReturn.returnId} rejected by ${user.fullName || user.username || 'Unknown'}`,
            'Site'
        );

        await ActivityLogger.logActivity(
            siteReturn.warehouseId,
            'return_rejected',
            userId,
            {
                returnId: siteReturn.returnId,
                siteName: siteReturn.siteName,
                reason: rejectionReason
            },
            `Return request ${siteReturn.returnId} from ${siteReturn.siteName} rejected`,
            'Warehouse'
        );

        // Emit event
        eventBus.emit('site_return_rejected', {
            returnId: siteReturn._id,
            returnCode: siteReturn.returnId,
            siteId: siteReturn.siteId,
            siteName: siteReturn.siteName,
            rejectedBy: userId,
            rejectedByName: user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username) || 'Unknown',
            reason: rejectionReason,
            requestedBy: siteReturn.requestedBy,
            companyId
        });

        res.json({
            success: true,
            message: 'Return request rejected',
            data: siteReturn
        });
    } catch (error) {
        console.error('Reject return error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reject return request',
            error: error.message
        });
    }
};

/**
 * POST /api/returns/:returnId/log-receiving
 * Log receiving of returned items and update inventory
 */
exports.logReceiving = async (req, res) => {
    try {
        const { returnId } = req.params;
        const { items, receivingNotes, receivingPhotos } = req.body;

        const userId = req.user._id;
        const userRole = req.user.role;
        const companyId = req.user.companyId;

        if (!['admin', 'warehouse_manager', 'company_owner'].includes(userRole)) {
            return res.status(403).json({
                success: false,
                message: 'Only admins and warehouse managers can log receiving'
            });
        }

        const siteReturn = await SiteReturn.findOne({
            _id: returnId,
            companyId
        }).populate('siteId').populate('warehouseId');

        if (!siteReturn) {
            return res.status(404).json({
                success: false,
                message: 'Return request not found'
            });
        }

        if (siteReturn.status !== 'approved') {
            return res.status(400).json({
                success: false,
                message: 'Can only log receiving for approved returns'
            });
        }

        // If warehouse manager, verify they manage this warehouse
        if (userRole === 'warehouse_manager') {
            const manager = await User.findById(userId);
            const isAssigned =
                (manager.warehouseId && manager.warehouseId.toString() === siteReturn.warehouseId._id.toString()) ||
                (manager.assignedWarehouses && manager.assignedWarehouses.some(w => w.toString() === siteReturn.warehouseId._id.toString()));

            if (!isAssigned) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only log receiving for your assigned warehouse'
                });
            }
        }

        const user = await User.findById(userId);
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Update received quantities
            if (items && Array.isArray(items)) {
                for (const receivedItem of items) {
                    const returnItem = siteReturn.items.find(i => i.itemName === receivedItem.itemName);
                    if (returnItem) {
                        returnItem.receivedQty = Math.min(
                            receivedItem.receivedQty || 0,
                            returnItem.approvedReturnQty
                        );
                    }
                }
            } else {
                // Default: all approved quantities received
                siteReturn.items.forEach(item => {
                    item.receivedQty = item.approvedReturnQty;
                });
            }

            // Update warehouse inventory (add returned items)
            const warehouse = siteReturn.warehouseId;
            for (const returnItem of siteReturn.items) {
                if (returnItem.receivedQty > 0 && returnItem.inventoryItemId) {
                    const inventoryItem = await InventoryItem.findById(returnItem.inventoryItemId).session(session);
                    if (inventoryItem) {
                        inventoryItem.availableQty = (inventoryItem.availableQty || 0) + returnItem.receivedQty;
                        await inventoryItem.save({ session });
                    }
                }
            }

            // Generate GRN
            const grnId = `GRN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

            const grn = new GRN({
                grnId,
                grnType: 'standalone',
                companyId,
                warehouseId: siteReturn.warehouseId._id,
                warehouseName: siteReturn.warehouseId.warehouseName,
                receivingFrom: 'site_return',
                status: 'authenticated',
                items: siteReturn.items.map(item => ({
                    itemName: item.itemName,
                    inventoryItemId: item.inventoryItemId,
                    uom: item.uom,
                    dispatchedQty: item.approvedReturnQty,
                    receivedQty: item.receivedQty,
                    price: 0,
                    discrepancy: item.approvedReturnQty - item.receivedQty,
                    remarks: item.itemRemarks
                })),
                receivedBy: userId,
                receivedByName: user.name || 'Unknown',
                receivedAt: new Date(),
                authenticatedBy: userId,
                authenticatedByName: user.name || 'Unknown',
                authenticatedAt: new Date(),
                notes: receivingNotes || `Return from ${siteReturn.siteName}`,
                photos: receivingPhotos || [],
                timeline: [{
                    eventType: 'grn_created',
                    actorId: userId,
                    actorName: user.name || 'Unknown',
                    actorRole: userRole,
                    note: `GRN created for return ${siteReturn.returnId}`,
                    timestamp: new Date()
                }]
            });

            await grn.save({ session });

            // Update return status
            siteReturn.status = 'completed';
            siteReturn.receivingDetails = {
                receivedBy: userId,
                receivedByName: user.name || 'Unknown',
                receivedAt: new Date(),
                grnId: grn._id,
                grnCode: grnId,
                receivingNotes: receivingNotes || '',
                receivingPhotos: receivingPhotos || []
            };

            siteReturn.timeline.push({
                eventType: 'receiving_logged',
                actorId: userId,
                actorName: user.name || 'Unknown',
                actorRole: userRole,
                note: `Receiving logged - GRN ${grnId} created`,
                meta: { grnId: grn._id, grnCode: grnId },
                timestamp: new Date()
            });

            await siteReturn.save({ session });

            await session.commitTransaction();

            // Log activities
            await ActivityLogger.logActivity(
                siteReturn.siteId._id,
                'item_return_received',
                userId,
                {
                    returnId: siteReturn.returnId,
                    grnCode: grnId,
                    itemCount: siteReturn.items.length
                },
                `Return ${siteReturn.returnId} completed - items received at warehouse`,
                'Site'
            );

            await ActivityLogger.logActivity(
                siteReturn.warehouseId._id,
                'return_logged',
                userId,
                {
                    returnId: siteReturn.returnId,
                    grnCode: grnId,
                    siteName: siteReturn.siteName,
                    itemCount: siteReturn.items.length
                },
                `Return ${siteReturn.returnId} received and logged - GRN ${grnId} created`,
                'Warehouse'
            );

            // Emit event
            eventBus.emit('site_return_receiving_logged', {
                returnId: siteReturn._id,
                returnCode: siteReturn.returnId,
                grnId: grn._id,
                grnCode: grnId,
                siteId: siteReturn.siteId._id,
                siteName: siteReturn.siteName,
                warehouseId: siteReturn.warehouseId._id,
                receivedBy: userId,
                receivedByName: user.name || 'Unknown',
                requestedBy: siteReturn.requestedBy,
                companyId
            });

            res.json({
                success: true,
                message: 'Receiving logged successfully',
                data: {
                    return: siteReturn,
                    grn
                }
            });
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Log receiving error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to log receiving',
            error: error.message
        });
    }
};

/**
 * GET /api/returns/pending-for-warehouse/:warehouseId
 * Get pending returns for a specific warehouse
 */
exports.getPendingReturnsForWarehouse = async (req, res) => {
    try {
        const { warehouseId } = req.params;
        const companyId = req.user.companyId;

        const returns = await SiteReturn.find({
            companyId,
            warehouseId,
            status: { $in: ['pending', 'approved'] }
        })
            .sort({ createdAt: -1 })
            .populate('siteId', 'siteName')
            .populate('requestedBy', 'name email')
            .lean();

        res.json({
            success: true,
            data: returns
        });
    } catch (error) {
        console.error('Get pending returns error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch pending returns',
            error: error.message
        });
    }
};

/**
 * GET /api/returns/site/:siteId
 * Get returns for a specific site
 */
exports.getReturnsBySite = async (req, res) => {
    try {
        const { siteId } = req.params;
        const { status, limit = 20 } = req.query;
        const companyId = req.user.companyId;

        const query = {
            companyId,
            siteId
        };

        if (status) {
            query.status = status;
        }

        const returns = await SiteReturn.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .populate('warehouseId', 'warehouseName')
            .populate('requestedBy', 'name')
            .lean();

        res.json({
            success: true,
            data: returns
        });
    } catch (error) {
        console.error('Get returns by site error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch site returns',
            error: error.message
        });
    }
};
