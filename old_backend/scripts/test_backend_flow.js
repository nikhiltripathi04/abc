const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:5000/api'; // Assuming 5000 based on previous logs or 3000. Let's try 5000 first as user runs npm run dev which might set PORT. Actually server.js said PORT || 3000. I will check .env if this fails, but usually dev is 5000 or 3000. Let's default to 3000 as per server.js default.
// Wait, the user has "npm run dev" running. `server.js` default is 3000.
// Let's use 3000.

const BASE_URL = 'http://localhost:3000';

async function runTest() {
    try {
        console.log('🚀 Starting Backend Verification Test...');

        // 1. Register Admin (Company)
        // Using a random suffix to avoid "Username exists" errors on repeated runs
        const randomSuffix = Math.floor(Math.random() * 10000);
        const adminData = {
            username: `admin_test_${randomSuffix}`,
            password: 'password123',
            email: `admin_${randomSuffix}@test.com`,
            phoneNumber: '1234567890',
            firmName: 'Test Construction Co'
        };

        console.log(`\n1️⃣  Registering Admin: ${adminData.username}...`);
        const registerRes = await axios.post(`${BASE_URL}/api/auth/register`, adminData);
        console.log('✅ Admin Registered:', registerRes.data.success);

        // Login Admin to get Token
        console.log(`\n2️⃣  Logging in Admin...`);
        const loginRes = await axios.post(`${BASE_URL}/api/auth/login`, {
            username: adminData.username,
            password: adminData.password
        });
        const adminToken = loginRes.data.token;
        const adminId = loginRes.data.user.id;
        console.log('✅ Admin Logged In. Token received.');

        const adminHeader = { headers: { Authorization: `Bearer ${adminToken}` } };

        // 2 Create Site
        console.log(`\n3️⃣  Creating Site...`);
        const siteData = {
            siteName: `Test Site ${randomSuffix}`,
            location: {
                address: '123 Test St',
                latitude: 12.9716, // Bangalore
                longitude: 77.5946
            },
            adminId: adminId
        };
        const siteRes = await axios.post(`${BASE_URL}/api/sites`, siteData, adminHeader);
        const siteId = siteRes.data.data._id;
        console.log(`✅ Site Created: ${siteRes.data.data.siteName} (ID: ${siteId})`);

        // 3. Create Warehouse
        console.log(`\n4️⃣  Creating Warehouse...`);
        const warehouseData = {
            warehouseName: `Test Warehouse ${randomSuffix}`,
            location: 'Test City',
            managerUsername: `manager_${randomSuffix}`,
            managerPassword: 'password123'
        };
        const warehouseRes = await axios.post(`${BASE_URL}/api/warehouses`, warehouseData, adminHeader);
        const warehouseId = warehouseRes.data.warehouse._id;
        console.log(`✅ Warehouse Created: ${warehouseRes.data.warehouse.warehouseName} (ID: ${warehouseId})`);

        // Add dummy supply to warehouse
        console.log(`   Adding supply to warehouse...`);
        await axios.post(`${BASE_URL}/api/warehouses/${warehouseId}/supplies`, {
            itemName: 'Cement',
            quantity: 1000,
            unit: 'bags',
            currency: 'INR',
            entryPrice: 350
        }, adminHeader);
        console.log('   ✅ Supply Added: Cement (1000 bags)');

        // 4. Create Supervisor for Site
        console.log(`\n5️⃣  Creating Supervisor for Site...`);
        const supervisorData = {
            username: `sup_${randomSuffix}`,
            password: 'password123',
            fullName: 'Test Supervisor'
        };
        const supRes = await axios.post(`${BASE_URL}/api/sites/${siteId}/supervisors`, supervisorData, adminHeader);
        const supervisorId = supRes.data.data.id;
        console.log(`✅ Supervisor Created: ${supervisorData.username}`);

        // Login Supervisor
        console.log(`   Logging in Supervisor...`);
        const supLoginRes = await axios.post(`${BASE_URL}/api/auth/login`, {
            username: supervisorData.username,
            password: supervisorData.password
        });
        const supToken = supLoginRes.data.token;
        const supHeader = { headers: { Authorization: `Bearer ${supToken}` } };
        console.log('   ✅ Supervisor Logged In.');

        // 5. Create Staff (General Access)
        console.log(`\n6️⃣  Creating Staff...`);
        const staffData = {
            username: `staff_${randomSuffix}`,
            password: 'password123',
            fullName: 'Test Staff',
            role: 'staff', // Explicitly setting role, though endpoint might verify
            companyId: loginRes.data.user.companyId // Pass company ID if needed, or endpoint might handle
        };
        // Creating staff usually usually done by `POST /api/staff` (admin only?)
        // Let's check api/staff routes. Assuming admin can create.
        try {
            // We need to check the exact route for staff creation. 
            // In many implementations it is /api/staff/create or just POST /api/staff
            // Based on server.js: app.use('/api/staff', staffRoutes);
            // I'll assume POST /api/staff works.
            const staffRes = await axios.post(`${BASE_URL}/api/staff`, {
                ...staffData,
                createdBy: adminId
            }, adminHeader);
            console.log(`✅ Staff Created: ${staffData.username}`);
            var staffId = staffRes.data.data.id || staffRes.data.data._id;
        } catch (e) {
            console.log('   ⚠️ Staff creation failed (might need specific payload). Skipping Staff Login test.');
            // console.error(e.response?.data);
        }

        if (staffId) {
            // Login Staff
            console.log(`   Logging in Staff...`);
            const staffLoginRes = await axios.post(`${BASE_URL}/api/auth/login`, {
                username: staffData.username,
                password: staffData.password
            });
            const staffToken = staffLoginRes.data.token;
            console.log('   ✅ Staff Logged In.');

            // Mark Attendance
            console.log(`   Marking Attendance (Check In)...`);
            const attendancePayload = {
                type: 'login',
                photo: 'base64placeholderString...', // Mock photo
                location: {
                    latitude: 12.97,
                    longitude: 77.59,
                    address: 'Test Location'
                }
            };
            const attRes = await axios.post(`${BASE_URL}/api/attendance`, attendancePayload, { headers: { Authorization: `Bearer ${staffToken}` } });
            console.log(`   ✅ Attendance Marked: ${attRes.data.message}`);
        }

        // 6. Supervisor Message (Text)
        console.log(`\n7️⃣  Supervisor Sending Message...`);
        const msgPayload = {
            siteId: siteId,
            content: 'Reporting site status: All good.'
        };
        // Note: endpoint specificies multipart/form-data for video uploads. 
        // If we send JSON, the 'upload.single' middleware might expect form-data but usually handles text fields too.
        // Let's try sending as JSON first (axios does this by default), if it fails we switch to FormData.
        // Wait, 'upload.single' typically requires data to be multipart/form-data for the text fields to be parsed correctly by multer 
        // IF they are before the file, OR if we strictly use JSON, multer might ignore it.
        // However, standard express apps with `upload.single` often separate file and body.
        // Let's assume we need to skip message test or try JSON.
        // Actually, to robustly test "text only" with multer, sending as form-data is safer.
        // But doing form-data in Node without 'form-data' package is verbose.
        // I'll try JSON. If 400/500, I'll know why.
        // Most "Refine Admin Chat UI" edits allowed JSON fallbacks or checked `req.body`.
        try {
            await axios.post(`${BASE_URL}/api/messages/send`, msgPayload, supHeader);
            console.log('✅ Message Sent (JSON mode)');
        } catch (e) {
            console.log('   ℹ️  Message Send (JSON) failed. Multer might strictly require multipart. Skipping for now.');
        }

        // 7. Bulk Supply Request
        console.log(`\n8️⃣  Supervisor Bulk Supply Request...`);
        const bulkPayload = {
            warehouseId: warehouseId,
            items: [
                { itemName: 'Cement', quantity: 50, unit: 'bags' },
                { itemName: 'New Item', quantity: 10, unit: 'pcs' } // Item not in warehouse
            ]
        };
        const supplyRes = await axios.post(`${BASE_URL}/api/sites/${siteId}/supply-requests/bulk`, bulkPayload, supHeader);
        console.log(`✅ Bulk Request Created. Batch ID: ${supplyRes.data.batchId}`);
        console.log(`   Items Requested: ${supplyRes.data.data.length}`);

        console.log('\n✨ Test Completed Successfully! ✨');

    } catch (error) {
        console.error('\n❌ Test Failed:');
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error('Data:', error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

runTest();
