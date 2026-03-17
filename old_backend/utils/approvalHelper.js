// [BACKORDER DISABLED] const { Backorder, BACKORDER_STATUSES } = require('../models/Backorder');
const InventoryItem = require('../models/InventoryItem');
const { ApprovalLog } = require('../models/ApprovalLog');
const eventBus = require('../core/eventBus');
const Warehouse = require('../models/Warehouse');

/**
 * Determine item status based on requested and available quantities
 */
function determineItemStatus(requestedQty, availableQty) {
    if (availableQty >= requestedQty) {
        return 'in_stock';
    } else if (availableQty > 0) {
        return 'partial_stock';
    } else {
        return 'out_of_stock';
    }
}

// [BACKORDER DISABLED] calculateBackorderQty
// function calculateBackorderQty(requestedQty, approvedQty, availableQty) {
//     const totalNeeded = requestedQty;
//     const backorderQty = Math.max(0, totalNeeded - approvedQty);
//     return backorderQty;
// }

/**
 * Create timeline event for approval
 */
function createApprovalTimeline(action, userId, userName, meta = {}) {
    return {
        eventType: action,
        actorId: userId,
        actorName: userName,
        actorRole: meta.role || '',
        note: meta.note || '',
        meta: meta,
        timestamp: new Date()
    };
}

/**
 * Generate approval summary for an order
 */
function generateApprovalSummary(order) {
    const items = order.items || [];
    let totalRequested = 0;
    let totalApproved = 0;
    let totalRejected = 0;

    let inStock = 0;
    let partialStock = 0;
    let outOfStock = 0;
    let approved = 0;
    let rejected = 0;
    let pending = 0;

    items.forEach(item => {
        totalRequested += item.requestedQty;
        totalApproved += item.approvedQty;
        totalRejected += item.requestedQty - item.approvedQty;

        if (item.itemStatus === 'in_stock') inStock++;
        if (item.itemStatus === 'partial_stock') partialStock++;
        if (item.itemStatus === 'out_of_stock') outOfStock++;

        if (item.approvalDecision === 'approved') approved++;
        if (item.approvalDecision === 'rejected') rejected++;
        if (item.approvalDecision === 'pending') pending++;
    });

    return {
        totalItems: items.length,
        totalRequested,
        totalApproved,
        totalRejected,
        itemsInStock: inStock,
        itemsPartialStock: partialStock,
        itemsOutOfStock: outOfStock,
        itemsApproved: approved,
        itemsRejected: rejected,
        itemsPending: pending
    };
}

/**
 * Validate approval decisions
 */
function validateApprovalDecisions(itemDecisions) {
    if (!Array.isArray(itemDecisions)) {
        return { valid: false, error: 'itemDecisions must be an array' };
    }

    for (const decision of itemDecisions) {
        if (!decision.itemId) {
            return { valid: false, error: 'Each decision must have an itemId' };
        }
        if (decision.approvedQty === undefined || decision.approvedQty < 0) {
            return { valid: false, error: 'Each decision must have a valid approvedQty >= 0' };
        }
        if (!decision.routing || !['warehouse', 'direct_to_site'].includes(decision.routing)) {
            return { valid: false, error: 'Each decision must have a valid routing' };
        }
        if (decision.routing === 'direct_to_site' && !decision.vendorName) {
            return { valid: false, error: 'Vendor name is required for direct_to_site routing' };
        }
    }

    return { valid: true };
}

/**
 * Update inventory after approval
 */
async function updateInventoryAfterApproval(itemId, approvedQty, routing, warehouseId) {
    try {
        if (routing === 'warehouse') {
            // Reduce available quantity - item will be allocated to order
            const updatedItem = await InventoryItem.findByIdAndUpdate(
                itemId,
                { $inc: { availableQty: -approvedQty } },
                { new: true }
            );

            if (updatedItem && updatedItem.availableQty < updatedItem.minQty) {
                // Fetch warehouse name for the notification
                const warehouse = await Warehouse.findById(warehouseId).select('warehouseName companyId');
                eventBus.emit('STOCK_LOW', {
                    companyId: warehouse?.companyId || updatedItem.companyId,
                    warehouseId: warehouseId,
                    warehouseName: warehouse?.warehouseName || 'Warehouse',
                    itemId: updatedItem._id,
                    itemName: updatedItem.itemName,
                    availableQty: updatedItem.availableQty,
                    minQty: updatedItem.minQty
                });
            }
        }
        // If direct_to_site, don't reduce inventory
        return { success: true };
    } catch (error) {
        console.error('Error updating inventory:', error);
        throw error;
    }
}

/**
 * Check if all items in approval are processed
 */
function checkApprovalCompleteness(order) {
    const items = order.items || [];

    if (items.length === 0) {
        return { isComplete: false, remainingItems: [] };
    }

    const remainingItems = items.filter(
        item => item.approvalDecision === 'pending'
    );

    return {
        isComplete: remainingItems.length === 0,
        remainingItems: remainingItems.map(item => ({
            itemId: item._id,
            itemName: item.itemName,
            requestedQty: item.requestedQty
        }))
    };
}

// [BACKORDER DISABLED] createBackorderForItem
// async function createBackorderForItem(orderId, siteId, companyId, item, backorderQty, createdBy, createdByName, vendorName = '', expectedDate = null, orderCode = '') {
//     try {
//         const resolvedItemId = item?.inventoryItemId?._id || item?.inventoryItemId || item?._id;
//         const backorderCode = orderCode ? `B-${orderCode}` : `B-${String(orderId).slice(-6).toUpperCase()}`;
//         const backorder = new Backorder({ orderId, backorderCode, siteId, companyId, itemId: resolvedItemId,
//             itemName: item.itemName, backorderQty, originalRequestQty: item.requestedQty,
//             originalAvailableQty: item.itemAvailableQty, vendorName, status: 'pending', createdBy, createdByName,
//             expectedFulfillmentDate: expectedDate,
//             timeline: [createApprovalTimeline('backorder_created', createdBy, createdByName,
//                 { note: `Backorder created for ${backorderQty} units`, itemName: item.itemName })]
//         });
//         const savedBackorder = await backorder.save();
//         return savedBackorder;
//     } catch (error) {
//         console.error('Error creating backorder:', error);
//         throw error;
//     }
// }

/**
 * Create approval log entry
 */
async function createApprovalLog(approvalType, referenceId, referenceName, companyId, siteId, adminId, adminName, status, totalItems, approvedItems, rejectedItems, decision) {
    try {
        const approvalLog = new ApprovalLog({
            approvalType,
            referenceId,
            referenceName,
            companyId,
            siteId,
            adminId,
            adminName,
            status,
            totalItems,
            approvedItems,
            rejectedItems,
            decision,
            createdAt: new Date(),
            completedAt: status !== 'pending' ? new Date() : null,
            timeToApproval: 0
        });

        return await approvalLog.save();
    } catch (error) {
        console.error('Error creating approval log:', error);
        throw error;
    }
}

/**
 * Process item approval decision
 */
async function processItemApprovalDecision(item, decision, decidedBy, decidedByName) {
    try {
        item.routingDecision = decision.routing;
        item.approvedQty = decision.approvedQty;
        item.approvalDecision = decision.approvedQty > 0 ? 'approved' : 'rejected';
        item.approvalRemarks = decision.remarks || '';
        item.decidedAt = new Date();
        item.decidedBy = decidedBy;
        item.decidedByName = decidedByName;

        if (decision.routing === 'direct_to_site' && decision.vendorName) {
            item.approvalRemarks += ` [Vendor: ${decision.vendorName}]`;
        }

        return item;
    } catch (error) {
        console.error('Error processing item approval:', error);
        throw error;
    }
}

module.exports = {
    determineItemStatus,
    // calculateBackorderQty, // [BACKORDER DISABLED]
    createApprovalTimeline,
    generateApprovalSummary,
    validateApprovalDecisions,
    updateInventoryAfterApproval,
    checkApprovalCompleteness,
    // createBackorderForItem, // [BACKORDER DISABLED]
    createApprovalLog,
    processItemApprovalDecision
};
