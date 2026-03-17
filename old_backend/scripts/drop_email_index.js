const mongoose = require('mongoose');
const User = require('../models/User'); // Load model to ensure connection is aware
require('dotenv').config();

async function dropEmailIndex() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management');
        console.log('Connected to MongoDB');

        const collection = mongoose.connection.collection('users');
        const indexes = await collection.indexes();

        console.log('Current Indexes:', indexes);

        const emailIndex = indexes.find(idx => idx.key.email === 1);

        if (emailIndex) {
            console.log(`Found email index: ${emailIndex.name}. Dropping...`);
            await collection.dropIndex(emailIndex.name);
            console.log('✅ Successfully dropped email index.');
        } else {
            console.log('ℹ️ No email index found to drop.');
        }

    } catch (error) {
        console.error('❌ Error dropping index:', error);
    } finally {
        await mongoose.disconnect();
    }
}

dropEmailIndex();
