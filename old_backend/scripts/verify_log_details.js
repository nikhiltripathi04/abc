const mongoose = require('mongoose');
const ActivityLog = require('../models/ActivityLog');
require('dotenv').config();

const verifyLogs = async () => {
    try {
        console.log('Connecting to DB...');
        // Use URI from server.js
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management';
        await mongoose.connect(mongoUri);
        console.log('Connected to DB');

        console.log('Fetching last 20 activity logs...');
        const logs = await ActivityLog.find().sort({ timestamp: -1 }).limit(20);

        if (logs.length === 0) {
            console.log('No logs found.');
        } else {
            logs.forEach((log, index) => {
                console.log(`\n--- Log ${index + 1} ---`);
                console.log('Action:', log.action);
                console.log('Details Keys:', Object.keys(log.details));
                console.log('Details Content:', JSON.stringify(log.details, null, 2));
            });
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected');
    }
};

verifyLogs();
