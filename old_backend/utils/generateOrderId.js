const Counter = require('../models/Counter');

/**
 * Gets the next sequence number for a given counter name atomically.
 * @param {string} name - The name of the counter (e.g., "order")
 * @returns {Promise<number>} - The next sequence number
 */
async function getNextSequence(name) {
    const counter = await Counter.findByIdAndUpdate(
        name,
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return counter.seq;
}

/**
 * Formats a sequence number into a zero-padded string of a given length.
 * @param {number} num - The sequence number
 * @param {number} padLength - The desired length of the padded string
 * @returns {string} - The zero-padded string
 */
function formatNumber(num, padLength = 8) {
    return String(num).padStart(padLength, '0');
}

/**
 * Generates an initially formatted string like ORD-00000001
 * Used primarily for backward compatibility or when an explicit ID is required initially.
 * @param {string} prefix - The prefix for the ID (e.g., "ORD")
 * @returns {Promise<string>} - The generated ID string
 */
async function generateOrderId(prefix = 'ORD') {
    const sequence = await getNextSequence('order');
    return `${prefix}-${formatNumber(sequence)}`;
}

/**
 * Derives a dynamic display ID based on the order's current stage and sequence number.
 * Ensures the underlying orderId is not mutated while still reflecting lifecycle stages.
 * @param {Object} order - The order document containing currentStage and sequenceNumber
 * @returns {string} - The dynamic display ID (e.g., DIS-00000001)
 */
function getDisplayId(order) {
    if (order && order.currentStage && order.sequenceNumber) {
        return `${order.currentStage}-${formatNumber(order.sequenceNumber)}`;
    }
    // Fallback for backward compatibility with old orders
    if (order && order.orderId) {
        return order.orderId;
    }
    // Draft orders that have not yet been submitted have no assigned ID
    return null;
}

module.exports = {
    getNextSequence,
    formatNumber,
    generateOrderId,
    getDisplayId
};
