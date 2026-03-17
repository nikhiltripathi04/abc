const mongoose = require('mongoose');
const Attendance = require('./models/Attendance');
require('dotenv').config();

const runCleanup = async () => {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management');
        console.log('✅ Connected.');

        console.log('🧹 Running manual attendance photo cleanup...');
        const result = await Attendance.cleanupOldPhotos();
        console.log(`✅ Cleaned up ${result.modifiedCount} old photos.`);

        console.log('🧹 Running manual message video cleanup...');
        const Message = require('./models/Message');
        const msgResult = await Message.cleanupOldVideos();
        console.log(`✅ Cleaned up ${msgResult.modifiedCount} old videos.`);

        // Check for remaining old photos just to be sure
        const fifteenDaysAgo = new Date();
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
        const remaining = await Attendance.countDocuments({
            photoUploadedAt: { $lt: fifteenDaysAgo },
            photo: { $ne: null }
        });

        if (remaining > 0) {
            console.warn(`⚠️ Warning: ${remaining} old photos still exist. Check logic.`);
        } else {
            console.log('✨ Verification: No old photos remain.');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Disconnected.');
        process.exit(0);
    }
};

runCleanup();
