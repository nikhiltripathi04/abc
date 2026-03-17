const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    senderName: {
        type: String,
        required: true
    },
    senderRole: {
        type: String,
        enum: ['supervisor', 'admin'],
        default: 'supervisor'
    },
    recipient: { // The Admin
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true
    },
    siteName: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: false // Optional if sending only video
    },
    videoUrl: {
        type: String, // URL to video storage (Cloudinary/S3/Local)
        default: null
    },
    isRead: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    replyTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        default: null
    },
    adminComments: [{
        text: String,
        createdAt: { type: Date, default: Date.now },
        adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        adminName: String
    }]
});

// Static method to cleanup old videos
messageSchema.statics.cleanupOldVideos = async function () {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    // Find messages with videoUrl older than 15 days
    // Note: In a real production environment with S3/R2, you would first fetch these URLs 
    // and delete the actual files from the bucket using the AWS SDK.
    // For now, we are just nullifying the reference.

    // TODO: Ideally, implement actual file deletion from R2 here.

    const result = await this.updateMany(
        {
            createdAt: { $lt: fifteenDaysAgo },
            videoUrl: { $ne: null }
        },
        {
            $set: { videoUrl: null, content: '[Video deleted due to retention policy]' }
        }
    );

    return result;
};

module.exports = mongoose.model('Message', messageSchema);