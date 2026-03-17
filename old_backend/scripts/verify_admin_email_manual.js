const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');

const API_BASE_URL = 'http://localhost:3000/api/auth';

async function verifyAdminEmail() {
    try {
        console.log('Starting verification...');

        // Load env
        const envPath = path.join(__dirname, '../.env');
        require('dotenv').config({ path: envPath });

        // Check for MONGODB_URI
        if (!process.env.MONGODB_URI) {
            console.log('MONGODB_URI missing from .env');
            return;
        }

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const User = require('../models/User');

        // Find a company owner
        const owner = await User.findOne({ role: 'company_owner' });

        if (!owner) {
            console.error('No company_owner found in DB');
            await mongoose.disconnect();
            return;
        }

        console.log('Found company owner:', owner.username);

        // Now hit the API
        const testAdmin = {
            username: `testadmin_${Date.now()}`,
            password: 'password123',
            email: `test_admin_${Date.now()}@example.com`,
            firstName: 'Test',
            lastName: 'Admin',
            phoneNumber: '1234567890',
            authAdminId: owner._id.toString()
        };

        try {
            const response = await axios.post(`${API_BASE_URL}/create-admin`, testAdmin);
            console.log('API Response:', JSON.stringify(response.data, null, 2));

            if (response.data.success) {
                console.log('SUCCESS: Admin created. Check server logs for email sent message.');
            }
        } catch (apiError) {
            console.error('API Call failed. Status:', apiError.response ? apiError.response.status : 'Unknown');
            console.error('Response Data:', apiError.response ? JSON.stringify(apiError.response.data, null, 2) : apiError.message);
        }

        await mongoose.disconnect();

    } catch (error) {
        console.error('Test script error:', error);
    }
}

verifyAdminEmail();
