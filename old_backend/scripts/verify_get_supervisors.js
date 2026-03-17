const fetch = require('node-fetch');

const API_BASE_URL = 'http://localhost:3000';

const logSuccess = (msg) => console.log(`✅ ${msg}`);
const logError = (msg, err) => {
    console.error(`❌ ${msg}`);
    if (err) {
        console.error('Error details:', err);
        if (err.cause) console.error('Cause:', err.cause);
    }
    // process.exit(1); 
};

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
        console.log('🔹 Logging in as Admin...');
        const loginRes = await request(`${API_BASE_URL}/api/auth/login`, 'POST', {
            username: 'admin',
            password: 'admin123'
        });
        const adminId = loginRes.user.id;
        const token = loginRes.token;
        logSuccess(`Admin logged in: ${adminId}`);

        console.log('🔹 Fetching Supervisors...');
        const supervisorsRes = await request(`${API_BASE_URL}/api/auth/supervisors?adminId=${adminId}`, 'GET', null, token);

        if (supervisorsRes.success && Array.isArray(supervisorsRes.data)) {
            logSuccess(`Fetched ${supervisorsRes.count} supervisors`);
            supervisorsRes.data.forEach(sup => {
                console.log(`   - ${sup.username} (Sites: ${sup.assignedSites ? sup.assignedSites.length : 0})`);
            });
        } else {
            throw new Error('Failed to fetch supervisors or invalid format');
        }

    } catch (error) {
        logError('Verification failed', error);
    }
};

runVerification();
