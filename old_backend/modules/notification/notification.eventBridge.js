const eventBus = require('../../core/eventBus');
const notificationQueue = require('../../core/queue');

const enqueue = async (type, payload, options = {}) => {
  try {
    await notificationQueue.add('send-notification', { type, payload }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      ...options
    });
  } catch (err) {
    console.error('❌ Failed to enqueue notification:', err.message);
  }
};

const register = (type) => {
  eventBus.on(type, (payload) => enqueue(type, payload));
};

const events = [
  'ORDER_CREATED',
  'ORDER_SUBMITTED',
  'ORDER_APPROVED',
  // 'ORDER_PARTIALLY_APPROVED',
  'ORDER_REJECTED',
  'ORDER_DISPATCHED',
  'ORDER_RECEIVED',
  'ORDER_CANCELLED',
  'STOCK_LOW',
  'INVENTORY_UPDATED',
  'GRN_CREATED',
  'GRN_AUTHENTICATED',
  'GRN_REJECTED',
  'GRN_FLAGGED',
  'QUANTITY_CHANGE_REQUESTED',
  'QUANTITY_CHANGE_APPROVED',
  'QUANTITY_CHANGE_REJECTED',
  'ITEM_DETAIL_CHANGE_REJECTED',
  'INVENTORY_ITEM_CREATED',
  'ORDER_ALLOTTED_FOR_DISPATCH',
  'PRICING_CONFIRMED',
  'DISCREPANCY_DETECTED',
  'TEST_NOTIFICATION'
];

events.forEach(register);

module.exports = {
  enqueue
};
