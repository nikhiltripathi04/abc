const API_URL = 'http://localhost:3000/api';

// Helper to log steps
const logStep = (step) => console.log(`\n🔹 ${step}`);
const logSuccess = (msg) => console.log(`✅ ${msg}`);
const logError = (msg, err) => {
    console.error(`❌ ${msg}`);
    if (err) {
        console.error('Error details:', err);
        if (err.cause) console.error('Cause:', err.cause);
    }
    // process.exit(1); // Don't exit immediately to allow logs to flush
};

// Helper wrapper for fetch
const request = async (url, method, body = null, token = null) => {
    const headers = {
        'Content-Type': 'application/json'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = {
        method,
        headers
    };

    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || response.statusText);
    }

    return data;
};

const runVerification = async () => {
    try {
        // 1. Login as Admin
        logStep('Logging in as Admin...');
        const loginRes = await request(`${API_URL}/auth/login`, 'POST', {
            username: 'admin',
            password: 'admin123'
        });
        const adminToken = loginRes.token;
        const adminId = loginRes.user.id;
        logSuccess('Admin logged in');

        // 2. Create a new Supervisor (without site)
        logStep('Creating new Supervisor...');
        const supervisorUsername = `sup_test_${Date.now()}`;
        const createSupRes = await request(`${API_URL}/auth/create-supervisor`, 'POST', {
            username: supervisorUsername,
            password: 'password123',
            adminId: adminId
        }, adminToken);

        const supervisorId = createSupRes.data.id;
        logSuccess(`Supervisor created: ${supervisorUsername} (${supervisorId})`);

        // 3. Create Site 1 and assign to Supervisor
        logStep('Creating Site 1 and assigning to Supervisor...');
        const site1Res = await request(`${API_URL}/sites`, 'POST', {
            siteName: `Site 1 ${Date.now()}`,
            location: 'Test Location 1',
            adminId: adminId,
            existingSupervisorId: supervisorId
        }, adminToken);

        const site1Id = site1Res.data._id;
        logSuccess(`Site 1 created and assigned: ${site1Id}`);

        // 4. Create Site 2 (initially unassigned)
        logStep('Creating Site 2 (unassigned)...');
        const site2Res = await request(`${API_URL}/sites`, 'POST', {
            siteName: `Site 2 ${Date.now()}`,
            location: 'Test Location 2',
            adminId: adminId
        }, adminToken);

        const site2Id = site2Res.data._id;
        logSuccess(`Site 2 created: ${site2Id}`);

        // 5. Assign Supervisor to Site 2
        logStep('Assigning Supervisor to Site 2...');
        await request(`${API_URL}/sites/${site2Id}/assign-supervisor`, 'POST', {
            supervisorId: supervisorId
        }, adminToken);
        logSuccess('Supervisor assigned to Site 2');

        // 6. Verify Supervisor Login and Assigned Sites
        logStep('Verifying Supervisor Login...');
        const supLoginRes = await request(`${API_URL}/auth/login`, 'POST', {
            username: supervisorUsername,
            password: 'password123',
            expectedRole: 'supervisor'
        });

        const assignedSites = supLoginRes.user.assignedSites;
        logSuccess(`Supervisor logged in. Assigned Sites: ${JSON.stringify(assignedSites)}`);

        if (assignedSites.length === 2) {
            logSuccess('Verification PASSED: Supervisor has 2 assigned sites.');
        } else {
            logError(`Verification FAILED: Expected 2 sites, found ${assignedSites.length}`);
        }

    } catch (error) {
        logError('Verification process failed', error);
    }
};

runVerification();
