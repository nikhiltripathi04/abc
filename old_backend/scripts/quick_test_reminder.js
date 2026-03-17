const mongoose = require('mongoose');
const { Order } = require('../models/Order');
const { NOTIFICATION_TYPES } = require('../modules/notification/notification.constants');
const { enqueue } = require('../modules/notification/notification.eventBridge');
require('dotenv').config();

async function runQuickTest() {
    try {
        console.log('🚀 Starting Quick Test for Receiving Reminder...');
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management');
        console.log('✅ Connected to MongoDB.');

        // 1. Find or Create an order
        let order = await Order.findOne({ status: 'awaiting_receipt' });
        if (!order) {
            console.log('📝 Creating a fresh test order...');
            order = await Order.create({
                orderId: 'QR-TEST-' + Math.floor(Math.random() * 1000),
                companyId: new mongoose.Types.ObjectId(), // Change this if you have a real ID
                siteId: new mongoose.Types.ObjectId(),
                siteName: 'Test Construction Site',
                requestedBy: new mongoose.Types.ObjectId(),
                requestedByName: 'Test Supervisor',
                requestedByRole: 'supervisor',
                status: 'awaiting_receipt',
                items: [{ itemName: 'Cement', requestedQty: 50, approvedQty: 50 }]
            });
        }

        console.log(`📦 Testing with Order: ${order.orderId}`);

        // 2. Enqueue a reminder with 10 seconds delay
        console.log('⏳ Enqueueing reminder with 10s delay...');
        const payload = {
            companyId: order.companyId,
            orderId: order.orderId,
            requestedBy: order.requestedBy,
            siteName: order.siteName,
            referenceId: order._id
        };

        await enqueue(NOTIFICATION_TYPES.ORDER_RECEIVING_REMINDER, payload, { delay: 10000 });
        console.log('✅ Reminder enqueued. If your notification worker is running, it will process in 10s.');
        console.log('\n💡 TIP: Ensure your notification worker is running: "node jobs/notification.worker.js"');
        console.log('💡 TIP: Check the "Notifications" collection in your DB in ~15 seconds.');

    } catch (err) {
        console.error('❌ Test failed:', err);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Disconnected.');
    }
}

runQuickTest();
