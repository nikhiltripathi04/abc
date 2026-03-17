const mongoose = require('mongoose');
const { Order } = require('../models/Order');
const notificationService = require('../modules/notification/notification.service');
const { NOTIFICATION_TYPES } = require('../modules/notification/notification.constants');
const { enqueue } = require('../modules/notification/notification.eventBridge');
require('dotenv').config();

async function runTest() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management');
        console.log('Connected.');

        // Find a test order or create a dummy one
        let order = await Order.findOne({ status: 'awaiting_receipt' });
        if (!order) {
            console.log('No "awaiting_receipt" order found. Creating a dummy one...');
            order = await Order.create({
                orderId: 'TEST-REMINDER-' + Date.now(),
                companyId: new mongoose.Types.ObjectId(),
                siteId: new mongoose.Types.ObjectId(),
                siteName: 'Test Site',
                requestedBy: new mongoose.Types.ObjectId(),
                requestedByName: 'Test Supervisor',
                requestedByRole: 'supervisor',
                status: 'awaiting_receipt',
                items: [{ itemName: 'Test Item', requestedQty: 10, approvedQty: 10 }]
            });
        }

        console.log(`Testing with Order: ${order.orderId}, Status: ${order.status}`);

        const payload = {
            companyId: order.companyId,
            orderId: order.orderId,
            requestedBy: order.requestedBy,
            siteName: order.siteName,
            referenceId: order._id
        };

        console.log('--- Test 1: Handle notification when status is awaiting_receipt ---');
        // This should log processing/sending
        await notificationService.handle(NOTIFICATION_TYPES.ORDER_RECEIVING_REMINDER, payload);

        console.log('--- Test 2: Handle notification when status is NOT awaiting_receipt ---');
        const originalStatus = order.status;
        order.status = 'received';
        await order.save();

        // This should log "Skipping receiving reminder..."
        await notificationService.handle(NOTIFICATION_TYPES.ORDER_RECEIVING_REMINDER, payload);

        // Restore status
        order.status = originalStatus;
        await order.save();

        console.log('--- Test 3: Test delayed enqueueing ---');
        // Note: This requires Redis and the worker to be running to actually "process"
        // But we can verify it doesn't throw.
        await enqueue(NOTIFICATION_TYPES.ORDER_RECEIVING_REMINDER, payload, { delay: 1000 });
        console.log('Successfully enqueued delayed notification.');

    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected.');
    }
}

runTest();
