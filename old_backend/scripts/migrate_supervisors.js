const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config({ path: '../.env' });

const migrateSupervisors = async () => {
    try {
        console.log('Connecting to MongoDB...');
        // Adjust connection string if needed, assuming standard env var or local default
        const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/construction-management';
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        // Find all supervisors
        // We use lean() to get plain objects, so we can see fields that might not be in the current schema anymore (like siteId if we removed it from schema but not DB)
        // However, since we just changed the code, the DB still has the data.
        // To be safe and access 'siteId' even if it's not in schema, we can use the native collection or just try to access it if strict is false.
        // But simpler: just use updateMany or find and update.

        // Actually, since I removed siteId from the schema file, Mongoose might not return it in a normal find() query if strict mode is on.
        // So I should use the native driver or a raw query.

        const usersCollection = mongoose.connection.collection('users');
        const supervisors = await usersCollection.find({ role: 'supervisor' }).toArray();

        console.log(`Found ${supervisors.length} supervisors.`);

        let migratedCount = 0;

        for (const supervisor of supervisors) {
            if (supervisor.siteId && !supervisor.assignedSites) {
                console.log(`Migrating supervisor: ${supervisor.username} (${supervisor._id})`);

                await usersCollection.updateOne(
                    { _id: supervisor._id },
                    {
                        $set: { assignedSites: [supervisor.siteId] },
                        $unset: { siteId: "" }
                    }
                );
                migratedCount++;
            } else if (supervisor.siteId && Array.isArray(supervisor.assignedSites)) {
                // If assignedSites already exists but siteId is still there (partial migration?)
                if (!supervisor.assignedSites.some(id => id.toString() === supervisor.siteId.toString())) {
                    await usersCollection.updateOne(
                        { _id: supervisor._id },
                        {
                            $push: { assignedSites: supervisor.siteId },
                            $unset: { siteId: "" }
                        }
                    );
                    migratedCount++;
                } else {
                    // Just unset siteId
                    await usersCollection.updateOne(
                        { _id: supervisor._id },
                        { $unset: { siteId: "" } }
                    );
                }
            }
        }

        console.log(`Migration complete. Migrated ${migratedCount} supervisors.`);
        process.exit(0);

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrateSupervisors();
