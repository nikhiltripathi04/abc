const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true, index: true },
  referenceId: { type: mongoose.Schema.Types.ObjectId },
  channel: { type: [String], default: ['IN_APP'] },
  status: {
    inApp: { type: String, enum: ['SENT', 'FAILED'], default: 'SENT' },
    push: { type: String, enum: ['SENT', 'FAILED'], default: 'SENT' },
    webPush: { type: String, enum: ['SENT', 'FAILED'], default: 'SENT' }
  },
  readAt: { type: Date },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', notificationSchema);
