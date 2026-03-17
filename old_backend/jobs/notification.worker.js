require('dotenv').config();
const { Worker } = require('bullmq');
const redis = require('../core/redis');
const processor = require('../modules/notification/notification.processor');
const mongoose = require('mongoose');

console.log('✅ Notification worker starting...');

if (mongoose.connection.readyState !== 1) {
  mongoose
    .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management')
    .then(() => console.log('✅ Worker connected to MongoDB'))
    .catch((err) => {
      console.error('❌ Worker MongoDB connection error:', err.message);
      process.exit(1);
    });
} else {
  console.log('✅ Worker using existing MongoDB connection');
}

const worker = new Worker('notifications', processor, {
  connection: redis,
  concurrency: 5
});

worker.on('completed', (job) => {
  console.log(`✅ Notification job completed: ${job.id}`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Notification job failed: ${job?.id}`, err.message);
});
