const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    action: {
        type: String,
        required: true
    },
    performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    performedByName: {
        type: String,
        required: true
    },
    performedByRole: {
        type: String,
        required: true
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        required: false // Can be Site ID, User ID, etc.
    },
    targetModel: {
        type: String,
        required: false // 'Site', 'User', etc.
    },

    // NEW FIELD
    message: {
        type: String
    },

    details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});


// PERFORMANCE INDEXES
activityLogSchema.index({ companyId: 1, timestamp: -1 });
activityLogSchema.index({ targetId: 1, targetModel: 1 });
activityLogSchema.index({ action: 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
