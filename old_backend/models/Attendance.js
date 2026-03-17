const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
    staffId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['login', 'logout'],
        required: true
    },
    photo: {
        type: String, // Base64 encoded image
        required: true
    },
    photoUploadedAt: {
        type: Date,
        default: Date.now,
        index: true // For efficient cleanup queries
    },
    location: {
        latitude: {
            type: Number,
            required: true
        },
        longitude: {
            type: Number,
            required: true
        },
        displayText: {
            type: String,
            required: true
        }
    },
    timestamp: {
        type: Date,
        default: Date.now,
        required: true
    },
    reminder10pmSent: {
        type: Boolean,
        default: false
    },
    reminder1145pmSent: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index for efficient queries
attendanceSchema.index({ staffId: 1, timestamp: -1 });

// Virtual to check if photo should be deleted (15 days)
attendanceSchema.virtual('shouldDeletePhoto').get(function () {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    return this.photoUploadedAt < fifteenDaysAgo;
});

// Static method to cleanup old photos
attendanceSchema.statics.cleanupOldPhotos = async function () {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    const result = await this.updateMany(
        {
            photoUploadedAt: { $lt: fifteenDaysAgo },
            photo: { $ne: null }
        },
        {
            $set: { photo: null }
        }
    );

    return result;
};

module.exports = mongoose.model('Attendance', attendanceSchema);
