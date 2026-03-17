const { NOTIFICATION_TYPES } = require('./notification.constants');

const templates = {
  [NOTIFICATION_TYPES.ORDER_CREATED]: (data) => ({
    title: 'Order Created',
    message: `Order #${data.orderId} was created${data.siteName ? ` for ${data.siteName}` : ''}.`
  }),
  [NOTIFICATION_TYPES.ORDER_SUBMITTED]: (data) => ({
    title: 'Order Submitted',
    message: `Order #${data.orderId} was submitted for approval.`
  }),
  [NOTIFICATION_TYPES.ORDER_APPROVED]: (data) => ({
    title: 'Order Approved',
    message: `Order #${data.orderId} has been approved.`
  }),
  [NOTIFICATION_TYPES.ORDER_PARTIALLY_APPROVED]: (data) => ({
    title: 'Order Partially Approved',
    message: `Order #${data.orderId} has been partially approved.`
  }),
  [NOTIFICATION_TYPES.ORDER_REJECTED]: (data) => ({
    title: 'Order Rejected',
    message: `Order #${data.orderId} has been rejected.`
  }),
  [NOTIFICATION_TYPES.ORDER_DISPATCHED]: (data) => ({
    title: 'Order Dispatched',
    message: `Order #${data.orderId} has been dispatched.`
  }),
  [NOTIFICATION_TYPES.ORDER_RECEIVED]: (data) => ({
    title: 'Order Received',
    message: `Order #${data.orderId} has been received.`
  }),
  [NOTIFICATION_TYPES.ORDER_CANCELLED]: (data) => ({
    title: 'Order Cancelled',
    message: `Order #${data.orderId} has been cancelled.`
  }),
  [NOTIFICATION_TYPES.STOCK_LOW]: (data) => ({
    title: 'Low Stock Alert',
    message: `${data.itemName} is low on stock in ${data.warehouseName}.`
  }),
  [NOTIFICATION_TYPES.INVENTORY_UPDATED]: (data) => ({
    title: 'Inventory Updated',
    message: `${data.itemName} inventory was updated.`
  }),
  [NOTIFICATION_TYPES.GRN_CREATED]: (data) => ({
    title: 'GRN Created',
    message: `GRN #${data.grnNumber || data.grnId} has been created.`
  }),
  [NOTIFICATION_TYPES.GRN_AUTHENTICATED]: (data) => ({
    title: 'GRN Authenticated',
    message: `GRN #${data.grnNumber || data.grnId} has been authenticated.`
  }),
  [NOTIFICATION_TYPES.GRN_REJECTED]: (data) => ({
    title: 'GRN Rejected',
    message: `GRN #${data.grnNumber || data.grnId} has been rejected.`
  }),
  [NOTIFICATION_TYPES.GRN_FLAGGED]: (data) => ({
    title: 'GRN Flagged',
    message: `GRN #${data.grnNumber || data.grnId} has been flagged for review.`
  }),
  [NOTIFICATION_TYPES.QUANTITY_CHANGE_REQUESTED]: (data) => ({
    title: 'Quantity Change Requested',
    message: `Quantity change requested for ${data.itemName}.`
  }),
  [NOTIFICATION_TYPES.QUANTITY_CHANGE_APPROVED]: (data) => ({
    title: 'Quantity Change Approved',
    message: `Quantity change approved for ${data.itemName}.`
  }),
  [NOTIFICATION_TYPES.QUANTITY_CHANGE_REJECTED]: (data) => ({
    title: 'Quantity Change Rejected',
    message: `Quantity change rejected for ${data.itemName}.`
  }),
  [NOTIFICATION_TYPES.ITEM_DETAIL_CHANGE_REJECTED]: (data) => ({
    title: 'Item Detail Change Rejected',
    message: `Item detail change request for "${data.itemName}" has been rejected${data.reason ? `: ${data.reason}` : '.'}`
  }),
  [NOTIFICATION_TYPES.INVENTORY_ITEM_CREATED]: (data) => ({
    title: 'New Item Created',
    message: `A new inventory item "${data.itemName}" has been created in ${data.warehouseName}.`
  }),
  [NOTIFICATION_TYPES.ORDER_RECEIVING_REMINDER]: (data) => ({
    title: 'Receiving Reminder',
    message: `Reminder: Order #${data.orderId} dispatched 2 hours ago. Please log the receipt at the site.`
  }),
  [NOTIFICATION_TYPES.ORDER_ALLOTTED_FOR_DISPATCH]: (data) => ({
    title: 'Order Allotted for Dispatch',
    message: `Order #${data.orderId} has been allotted to your warehouse for dispatch.`
  }),
  [NOTIFICATION_TYPES.PRICING_CONFIRMED]: (data) => ({
    title: 'Pricing Confirmed',
    message: `Pricing for item "${data.itemName}" has been confirmed by Admin.`
  }),
  [NOTIFICATION_TYPES.DISCREPANCY_DETECTED]: (data) => ({
    title: 'Discrepancy Detected',
    message: `Discrepancy detected in Order #${data.orderId}. Received ${data.receivedQty} vs Dispatched ${data.dispatchedQty} for item ${data.itemName}.`
  }),
  [NOTIFICATION_TYPES.TEST_NOTIFICATION]: (data) => ({
    title: 'Test Notification',
    message: data.message || 'This is a test notification to verify the system'
  }),
  [NOTIFICATION_TYPES.SITE_RETURN_CREATED]: (data) => ({
    title: 'Return Request Created',
    message: `Return request ${data.returnId} created from ${data.siteName} to ${data.warehouseName}.`
  }),
  [NOTIFICATION_TYPES.SITE_RETURN_APPROVED]: (data) => ({
    title: 'Return Request Approved',
    message: `Your return request ${data.returnId} has been approved${data.approvedByName ? ` by ${data.approvedByName}` : ''}.`
  }),
  [NOTIFICATION_TYPES.SITE_RETURN_REJECTED]: (data) => ({
    title: 'Return Request Rejected',
    message: `Your return request ${data.returnId} has been rejected${data.rejectionReason ? `: ${data.rejectionReason}` : '.'}`
  }),
  [NOTIFICATION_TYPES.SITE_RETURN_RECEIVING_LOGGED]: (data) => ({
    title: 'Return Received',
    message: `Return ${data.returnId} has been received. GRN #${data.grnCode || 'N/A'} created.`
  })
};

module.exports = templates;
