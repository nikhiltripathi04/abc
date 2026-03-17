const notificationService = require('./notification.service');

const processor = async (job) => {
  const { type, payload } = job.data || {};
  if (!type) return;
  await notificationService.handle(type, payload || {});
};

module.exports = processor;
