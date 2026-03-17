const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';

async function verifySupervisorCreationWithName() {
    try {
        console.log('🚀 Starting Supervisor Creation Verification...');

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
                siteName: 'Test Site Creation',
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

        // 3. Create Supervisor WITH NAME via Site Endpoint
        console.log('\n3️⃣ Creating Supervisor with Name...');
        const supervisorUsername = `sup_name_${Date.now()}`;
        const supervisorFullName = 'John Doe Supervisor';

        try {
            const supRes = await axios.post(`${BASE_URL}/sites/${siteId}/supervisors`, {
                username: supervisorUsername,
                password: 'password123',
                fullName: supervisorFullName, // THIS IS WHAT WE ARE TESTING
                adminId: adminId
            }, { headers });

            const supervisorId = supRes.data.data.id;
            console.log(`   ✅ Supervisor created via site endpoint: ${supervisorId}`);

            // 4. Verify Full Name was saved
            console.log('\n4️⃣ Verifying Full Name...');
            const userRes = await axios.get(`${BASE_URL}/auth/supervisors?adminId=${adminId}`, { headers });
            const supervisors = userRes.data.data;
            const createdSupervisor = supervisors.find(s => s._id === supervisorId);

            if (createdSupervisor && createdSupervisor.fullName === supervisorFullName) {
                console.log(`   ✅ SUCCESS: Full Name verified as "${createdSupervisor.fullName}"`);
            } else {
                console.error(`   ❌ FAILURE: Full Name mismatch or user not found.`);
                console.error('   Actual:', createdSupervisor);
                console.error('   Expected Name:', supervisorFullName);
            }

        } catch (e) {
            console.error('   ❌ Failed to create/verify supervisor:', e.message);
            if (e.response) console.error('   Response:', e.response.data);
            return;
        }

    } catch (error) {
        console.error('❌ Verification script failed:', error.message);
    }
}

verifySupervisorCreationWithName();
