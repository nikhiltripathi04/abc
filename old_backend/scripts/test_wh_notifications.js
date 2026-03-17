const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const { Order } = require('../models/Order');
const Notification = require('../models/Notification');
const eventBus = require('../core/eventBus');
require('../modules/notification/notification.eventBridge'); // Ensure events are handled

async function runTest() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // 1. Find a warehouse manager and a supervisor
        const wm = await User.findOne({ role: 'warehouse_manager' });
        const supervisor = await User.findOne({ role: 'supervisor' });
        const admin = await User.findOne({ role: 'admin' });

        if (!wm || !supervisor || !admin) {
            console.error('Missing required users for test');
            return;
        }

        console.log(`Testing with WM: ${wm.username}, Supervisor: ${supervisor.username}, Admin: ${admin.username}`);

        // 2. Test Order Allotment
        console.log('\n--- Testing ORDER_ALLOTTED_FOR_DISPATCH ---');
        const orderPayload = {
            companyId: wm.companyId,
            orderId: 'TEST-ORD-123',
            requestedBy: supervisor._id,
            siteName: 'Test Site',
            referenceId: new mongoose.Types.ObjectId(),
            warehouseId: wm.warehouseId || (wm.assignedWarehouses && wm.assignedWarehouses[0])
        };

        if (!orderPayload.warehouseId) {
            console.warn('WM has no warehouse assigned, allotment notification might not find recipients');
        }

        eventBus.emit('ORDER_ALLOTTED_FOR_DISPATCH', orderPayload);

        // Wait for processing
        await new Promise(r => setTimeout(r, 2000));

        let notifications = await Notification.find({ userId: wm._id }).sort({ createdAt: -1 }).limit(1);
        if (notifications.length > 0 && notifications[0].type === 'ORDER_ALLOTTED_FOR_DISPATCH') {
            console.log('✅ Order Allotment Notification received by WM');
        } else {
            console.log('❌ Order Allotment Notification NOT found for WM');
        }

        // 3. Test Pricing Confirmation
        console.log('\n--- Testing PRICING_CONFIRMED ---');
        const pricingPayload = {
            companyId: admin.companyId,
            itemName: 'Cement',
            addedBy: supervisor._id,
            referenceId: new mongoose.Types.ObjectId()
        };

        eventBus.emit('PRICING_CONFIRMED', pricingPayload);
        await new Promise(r => setTimeout(r, 2000));

        notifications = await Notification.find({ userId: supervisor._id }).sort({ createdAt: -1 }).limit(1);
        if (notifications.length > 0 && notifications[0].type === 'PRICING_CONFIRMED') {
            console.log('✅ Pricing Confirmation Notification received by Supervisor');
        } else {
            console.log('❌ Pricing Confirmation Notification NOT found for Supervisor');
        }

        // 4. Test Discrepancy Detection
        console.log('\n--- Testing DISCREPANCY_DETECTED ---');
        const discrepancyPayload = {
            companyId: admin.companyId,
            orderId: 'TEST-ORD-123',
            itemName: 'Steel',
            receivedQty: 8,
            dispatchedQty: 10,
            dispatchedBy: wm._id,
            referenceId: new mongoose.Types.ObjectId()
        };

        eventBus.emit('DISCREPANCY_DETECTED', discrepancyPayload);
        await new Promise(r => setTimeout(r, 2000));

        notifications = await Notification.find({ userId: wm._id }).sort({ createdAt: -1 }).limit(1);
        if (notifications.length > 0 && notifications[0].type === 'DISCREPANCY_DETECTED') {
            console.log('✅ Discrepancy Notification received by WM');
        } else {
            console.log('❌ Discrepancy Notification NOT found for WM');
        }

        // 5. Test Order Received (Dispatcher notification)
        console.log('\n--- Testing ORDER_RECEIVED (Dispatcher notification) ---');
        const receivedPayload = {
            companyId: admin.companyId,
            orderId: 'TEST-ORD-123',
            requestedBy: supervisor._id,
            siteName: 'Test Site',
            referenceId: new mongoose.Types.ObjectId(),
            dispatchedBy: wm._id
        };

        eventBus.emit('ORDER_RECEIVED', receivedPayload);
        await new Promise(r => setTimeout(r, 2000));

        notifications = await Notification.find({ userId: wm._id }).sort({ createdAt: -1 }).limit(1);
        if (notifications.length > 0 && notifications[0].type === 'ORDER_RECEIVED') {
            console.log('✅ Order Received Notification (Dispatcher) received by WM');
        } else {
            console.log('❌ Order Received Notification (Dispatcher) NOT found for WM');
        }

        // 6. Test Partial Approval Allotment
        console.log('\n--- Testing ORDER_ALLOTTED_FOR_DISPATCH (Partial Approval) ---');
        const partialApprovalPayload = {
            companyId: wm.companyId,
            orderId: 'TEST-ORD-PARTIAL',
            requestedBy: supervisor._id,
            siteName: 'Test Site',
            referenceId: new mongoose.Types.ObjectId(),
            warehouseId: wm.warehouseId || (wm.assignedWarehouses && wm.assignedWarehouses[0])
        };

        eventBus.emit('ORDER_PARTIALLY_APPROVED', { ...partialApprovalPayload, warehouseId: partialApprovalPayload.warehouseId });
        eventBus.emit('ORDER_ALLOTTED_FOR_DISPATCH', partialApprovalPayload);

        await new Promise(r => setTimeout(r, 2000));

        notifications = await Notification.find({ userId: wm._id }).sort({ createdAt: -1 }).limit(1);
        if (notifications.length > 0 && notifications[0].type === 'ORDER_ALLOTTED_FOR_DISPATCH') {
            console.log('✅ Order Allotment Notification received by WM for Partial Approval');
        } else {
            console.log('❌ Order Allotment Notification NOT found for WM for Partial Approval');
        }

        console.log('\nTests completed.');
        process.exit(0);
    } catch (err) {
        console.error('Test failed:', err);
        process.exit(1);
    }
}

runTest();
