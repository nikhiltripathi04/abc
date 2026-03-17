const mongoose = require('mongoose');
require('dotenv').config();

async function migrateOrderIdIndex() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management';

    try {
        await mongoose.connect(uri);
        console.log('Connected to MongoDB');

        const collection = mongoose.connection.collection('orders');
        const indexes = await collection.indexes();

        const orderIdIndex = indexes.find((idx) => idx.key && idx.key.orderId === 1);

        if (!orderIdIndex) {
            await collection.createIndex({ orderId: 1 }, { unique: true, sparse: true, name: 'orderId_1' });
            console.log('Created sparse unique index for orderId');
            return;
        }

        const alreadyCompatible = orderIdIndex.unique === true && orderIdIndex.sparse === true;
        if (alreadyCompatible) {
            console.log('orderId index is already sparse + unique. No changes needed.');
            return;
        }

        console.log(`Dropping existing index: ${orderIdIndex.name}`);
        await collection.dropIndex(orderIdIndex.name);

        console.log('Creating sparse unique orderId index...');
        await collection.createIndex({ orderId: 1 }, { unique: true, sparse: true, name: 'orderId_1' });

        console.log('Successfully migrated orderId index to sparse + unique.');
    } catch (error) {
        console.error('Failed to migrate orderId index:', error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

migrateOrderIdIndex();
