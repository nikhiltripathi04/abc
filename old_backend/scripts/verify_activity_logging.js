const axios = require('axios');
const mongoose = require('mongoose');

const BASE_URL = 'http://localhost:3000/api';

async function verifyActivityLogging() {
    try {
        console.log('🚀 Starting Activity Logging Verification...');

        // 1. Login as Company Owner (or create one if needed, but assuming one exists)
        // We'll use a hardcoded fallback or create one
        let token;
        let adminId;
        let companyId;

        // Try to login with a known test account or create new
        const testUser = `test_owner_${Date.now()}`;
        const testPass = 'password123';
        const testEmail = `${testUser}@example.com`;

        // Register new company to be clean
        console.log('1️⃣ Registering new company to ensure clean state...');
        try {
            const regRes = await axios.post(`${BASE_URL}/company/register`, {
                companyName: `Test Company ${Date.now()}`,
                name: 'Test',
                surname: 'Owner',
                mail: testEmail,
                mobileNumber: `9${Math.floor(100000000 + Math.random() * 900000000)}`,
                companyRole: 'Owner',
                address: '123 Test St',
                gstin: `22ABCDE${Math.floor(1000 + Math.random() * 9000)}F1Z${Math.floor(Math.random() * 9)}` // Random dummy GSTIN
            });

            if (regRes.data.success) {
                console.log('✅ Company registered:', regRes.data.companyId);
                const credentials = regRes.data.credentials;

                // Login
                const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
                    username: credentials.username,
                    password: credentials.password
                });

                token = loginRes.data.token;
                adminId = loginRes.data.user.id;
                companyId = regRes.data.companyId;
                console.log('✅ Logged in as new admin:', loginRes.data.user.username);
            }
        } catch (e) {
            console.error('❌ Failed to register/login:', e);
            if (e.response) {
                console.error('Response Status:', e.response.status);
                console.error('Response Data:', e.response.data);
            }
            return;
        }

        const headers = { Authorization: `Bearer ${token}` };

        // 2. Perform various actions to generate logs
        console.log('\n2️⃣ Performing actions to generate logs...');

        // Action A: Create Staff
        console.log('   - Creating staff member...');
        const staffUser = `staff_${Date.now()}`;
        try {
            await axios.post(`${BASE_URL}/staff`, {
                fullName: 'Test Staff',
                username: staffUser,
                password: 'password123'
            }, { headers });
            console.log('     ✅ Staff created');
        } catch (e) {
            console.error('     ❌ Failed to create staff:', e.response?.data || e.message);
        }

        // Action B: Create Supervisor
        console.log('   - Creating supervisor...');
        const supUser = `sup_${Date.now()}`;
        try {
            await axios.post(`${BASE_URL}/auth/create-supervisor`, {
                username: supUser,
                password: 'password123',
                adminId: adminId,
                fullName: 'Test Supervisor'
            }, { headers });
            console.log('     ✅ Supervisor created');
        } catch (e) {
            console.error('     ❌ Failed to create supervisor:', e.response?.data || e.message);
        }

        // Action C: Create Warehouse
        console.log('   - Creating warehouse...');
        let warehouseId;
        try {
            const whRes = await axios.post(`${BASE_URL}/warehouses`, {
                warehouseName: `Warehouse ${Date.now()}`,
                location: 'Test Location',
                managerUsername: `mgr_${Date.now()}`,
                managerPassword: 'password123'
            }, { headers });
            warehouseId = whRes.data.warehouse._id;
            console.log('     ✅ Warehouse created');
        } catch (e) {
            console.error('     ❌ Failed to create warehouse:', e.response?.data || e.message);
        }

        // Action D: Add Supply to Warehouse
        if (warehouseId) {
            console.log('   - Adding supply to warehouse...');
            try {
                await axios.post(`${BASE_URL}/warehouses/${warehouseId}/supplies`, {
                    itemName: 'Test Item',
                    quantity: 100,
                    unit: 'pcs',
                    currency: 'INR',
                    entryPrice: 50
                }, { headers });
                console.log('     ✅ Supply added');
            } catch (e) {
                console.error('     ❌ Failed to add supply:', e.response?.data || e.message);
            }
        }

        // 3. Verify Logs
        console.log('\n3️⃣ Verifying Activity Logs...');
        // Wait a moment for logs to be processed/saved
        await new Promise(r => setTimeout(r, 1000));

        try {
            const logsRes = await axios.get(`${BASE_URL}/company/logs`, { headers });
            const logs = logsRes.data.data;

            console.log(`   Found ${logs.length} activity logs.`);

            const expectedActions = [
                'staff_created',
                'supervisor_created',
                'warehouse_created',
                'supply_added'
            ];

            const foundActions = logs.map(l => l.action);
            console.log('   Actions found in logs:', [...new Set(foundActions)]); // unique logs

            let allFound = true;
            expectedActions.forEach(action => {
                const logEntry = logs.find(l => l.action === action);
                if (logEntry) {
                    console.log(`   ✅ Log found for action: ${action}`);

                    // Verify performedByName is NOT 'Unknown User'
                    if (logEntry.performedByName === 'Unknown User' || logEntry.performedByName === 'System') {
                        console.error(`     ❌ FAIL: PerformedBy is '${logEntry.performedByName}' for action ${action}`);
                        allFound = false;
                    } else {
                        console.log(`     ✅ PerformedBy: ${logEntry.performedByName}`);
                    }

                } else {
                    console.error(`   ❌ FAIL: No log found for action: ${action}`);
                    allFound = false;
                }
            });

            if (allFound) {
                console.log('\n✨ SUCCESS: All expected actions were logged successfully!');
            } else {
                console.error('\n⚠️ FAILURE: Some expected logs are missing.');
            }

        } catch (e) {
            console.error('❌ Failed to fetch logs:', e.response?.data || e.message);
        }

    } catch (error) {
        console.error('Verification script failed:', error);
    }
}

verifyActivityLogging();
