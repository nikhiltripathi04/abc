const axios = require('axios');

const API_URL = 'http://localhost:3000/api';

async function runTest() {
    try {
        console.log('🚀 Starting Company Flow Verification...');

        // 0. Health Check
        console.log('0. Checking Server Health...');
        const healthRes = await axios.get('http://localhost:3000/');
        console.log('✅ Server Health:', healthRes.data.message);
        console.log('Endpoints:', healthRes.data.endpoints);

        // 1. Register Company
        const companyData = {
            name: 'John',
            surname: 'Doe',
            mobileNumber: '9876543210',
            companyName: `Test Company ${Date.now()}`,
            companyRole: 'CEO',
            mail: `test${Date.now()}@example.com`,
            gstin: '27ABCDE1234F1Z5',
            address: '123 Test St'
        };

        console.log('1. Registering Company...');
        const registerRes = await axios.post(`${API_URL}/company/register`, companyData);
        console.log('✅ Company Registered:', registerRes.data);

        const { username, password } = registerRes.data.credentials;
        const companyId = registerRes.data.companyId;

        // 2. Login as Admin
        console.log('2. Logging in as Admin...');
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            username,
            password
        });
        console.log('✅ Login Successful. User:', loginRes.data.user);
        const token = loginRes.data.token;
        const adminId = loginRes.data.user.id;

        if (loginRes.data.user.companyId !== companyId) {
            throw new Error('Company ID mismatch in login response');
        }

        // 3. Create Site
        console.log('3. Creating Site...');
        const siteData = {
            siteName: `Test Site ${Date.now()}`,
            location: 'Test Location',
            description: 'Test Description',
            adminId: adminId
        };
        const siteRes = await axios.post(`${API_URL}/sites`, siteData, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('✅ Site Created:', siteRes.data.data);
        const siteId = siteRes.data.data._id;

        if (siteRes.data.data.companyId !== companyId) {
            throw new Error('Company ID mismatch in site creation');
        }

        // 4. Check Activity Logs
        console.log('4. Checking Activity Logs...');
        const logsRes = await axios.get(`${API_URL}/company/logs`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('✅ Logs Fetched:', logsRes.data.data.length);

        // We expect at least site creation log? 
        // Wait, site creation logs to site.activityLogs (embedded) or centralized?
        // The requirement said "Activity logs of all admin will be noted... reflected in the activity log."
        // My implementation of `ActivityLogger` (which I haven't seen yet) probably logs to `Site` model or `ActivityLog` model?
        // I created `ActivityLog` model, but I didn't update `ActivityLogger` utility to use it!
        // I need to check `utils/activityLogger.js`.

    } catch (error) {
        console.error('❌ Test Failed:', error.message);
        if (error.response) {
            console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
            console.error('Response Status:', error.response.status);
        } else {
            console.error('Error Stack:', error.stack);
        }
    }
}

runTest();
