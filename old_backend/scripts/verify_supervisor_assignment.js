const axios = require('axios');

const BASE_URL = 'http://localhost:5001/api';

async function verifyAssignment() {
    try {
        console.log('🚀 Starting Supervisor Assignment Verification...');

        // 1. Register new company to ensure clean state and valid admin
        let token;
        let adminId;
        const testUser = `test_owner_${Date.now()}`;
        const testEmail = `${testUser}@example.com`;

        console.log('1️⃣ Registering new company...');
        try {
            const regRes = await axios.post(`${BASE_URL}/company/register`, {
                companyName: `Test Company ${Date.now()}`,
                name: 'Test',
                surname: 'Owner',
                mail: testEmail,
                mobileNumber: `9${Math.floor(100000000 + Math.random() * 900000000)}`,
                companyRole: 'Owner',
                address: '123 Test St',
                gstin: `22ABCDE${Math.floor(1000 + Math.random() * 9000)}F1Z${Math.floor(Math.random() * 9)}`
            });

            if (regRes.data.success) {
                console.log('   ✅ Company registered:', regRes.data.companyId);
                const credentials = regRes.data.credentials;

                // Login
                const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
                    username: credentials.username,
                    password: credentials.password
                });

                token = loginRes.data.token;
                adminId = loginRes.data.user.id;
                console.log('   ✅ Logged in as:', loginRes.data.user.username);
            }
        } catch (e) {
            console.error('   ❌ Failed to register/login:', e.message);
            if (e.response) console.error('   Response:', e.response.data);
            return;
        }

        const headers = { Authorization: `Bearer ${token}` };

        // 2. Create a Site
        console.log('\n2️⃣ Creating a Site...');
        let siteId;
        try {
            const newSiteRes = await axios.post(`${BASE_URL}/sites`, {
                siteName: 'Test Site Assignment',
                location: 'Test Location',
                adminId: adminId
            }, { headers });
            siteId = newSiteRes.data.data._id;
            console.log(`   ✅ Site created: ${siteId}`);
        } catch (e) {
            console.error('   ❌ Failed to create site:', e.message);
            if (e.response) console.error('   Response:', e.response.data);
            return;
        }

        // 3. Create a Supervisor
        console.log('\n3️⃣ Creating a Supervisor...');
        let supervisorId;
        const supervisorUsername = `sup_assign_${Date.now()}`;
        try {
            const supRes = await axios.post(`${BASE_URL}/auth/create-supervisor`, {
                username: supervisorUsername,
                password: 'password123',
                fullName: 'Test Supervisor',
                adminId: adminId
            }, { headers });
            supervisorId = supRes.data.data.id;
            console.log(`   ✅ Supervisor created: ${supervisorId}`);
        } catch (e) {
            console.error('   ❌ Failed to create supervisor:', e.message);
            if (e.response) console.error('   Response:', e.response.data);
            return;
        }

        // 4. Assign Supervisor to Site (Frontend API Call Simulation)
        console.log('\n4️⃣ Assigning supervisor to site...');
        try {
            const assignRes = await axios.post(`${BASE_URL}/sites/${siteId}/assign-supervisor`, {
                supervisorId: supervisorId,
                adminId: adminId
            }, { headers });

            if (assignRes.data.success) {
                console.log('   ✅ Response Success:', assignRes.data.message);

                // Verify the assignment
                const siteRes = await axios.get(`${BASE_URL}/sites/${siteId}?adminId=${adminId}`, { headers });
                const supervisors = siteRes.data.data.supervisors || [];
                const assigned = supervisors.find(s => s._id === supervisorId || s.username === supervisorUsername);

                if (assigned) {
                    console.log('   ✅ Verification confirmed: Supervisor found in site supervisor list.');
                    console.log('\n✨ SUCCESS: Supervisor assignment flow verified!');
                } else {
                    console.error('   ❌ Verification failed: Supervisor NOT found in site list after assignment.');
                }
            } else {
                console.error('   ❌ Assignment API failed:', assignRes.data);
            }

        } catch (e) {
            console.error('   ❌ Assignment failed:', e.message);
            if (e.response) console.error('   Response:', e.response.data);
        }

    } catch (error) {
        console.error('❌ Verification script failed:', error.message);
    }
}

verifyAssignment();
