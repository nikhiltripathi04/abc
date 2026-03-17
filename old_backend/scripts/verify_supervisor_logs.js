const mongoose = require('mongoose');
const ActivityLog = require('../models/ActivityLog');
require('dotenv').config();

const verifyLogs = async () => {
    try {
        console.log('Connecting...');
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management';
        await mongoose.connect(mongoUri);

        const logs = await ActivityLog.find({
            action: { $in: ['supervisor_created', 'supervisor_added', 'supervisor_removed', 'supervisor_password_reset'] }
        }).sort({ timestamp: -1 }).limit(5);

        console.log(`Found ${logs.length} supervisor logs.`);

        logs.forEach((log, index) => {
            console.log(`\nLOG #${index + 1} [${log.action}]`);
            console.log(JSON.stringify(log.details, null, 2));
        });

    } catch (error) {
        console.error(error);
    } finally {
        await mongoose.disconnect();
    }
};

verifyLogs();
