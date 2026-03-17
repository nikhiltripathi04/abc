const { Queue } = require('bullmq');
const redis = require('./redis');

const notificationQueue = new Queue('notifications', {
  connection: redis
});

module.exports = notificationQueue;
