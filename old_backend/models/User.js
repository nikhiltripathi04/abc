const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// models/User.js
const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: function () { return this.role === 'admin' || this.role === 'company_owner'; }, // Required for admin & owner
        sparse: true
    },
    phoneNumber: {
        type: String,
        required: function () { return this.role === 'admin' || this.role === 'company_owner'; }
    },
    firmName: {
        type: String,
        required: false
    },
    jobTitle: {
        type: String,
        required: function () { return this.role === 'company_owner'; }
    },
    firstName: {
        type: String,
        required: function () { return this.role === 'admin' || this.role === 'company_owner'; }
    },
    lastName: {
        type: String,
        required: function () { return this.role === 'admin' || this.role === 'company_owner'; }
    },
    fullName: {
        type: String,
        required: function () { return this.role === 'staff'; }
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: function () { return this.role !== 'superadmin'; }
    },
    role: {
        type: String,
        enum: ['admin', 'supervisor', 'warehouse_manager', 'staff', 'company_owner'],
        required: true
    },
    assignedSites: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site'
    }],
    assignedWarehouses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    }],
    // Legacy field - kept for backward compatibility during migration
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    expoPushToken: {
        type: String,
        default: null
    },
    fcmWebTokens: {
        type: [String],
        default: []
    },
    // Approval-specific fields
    pendingApprovalsCount: {
        type: Number,
        default: 0,
        min: 0
    },
    lastApprovalCheckTime: {
        type: Date
    },
    notificationPreferences: {
        siteOrderApprovals: { type: Boolean, default: true },
        quantityChangeApprovals: { type: Boolean, default: true },
        salesInvoiceApprovals: { type: Boolean, default: true },
        reminderAfterHours: { type: Number, default: 24 },
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
        webPush: { type: Boolean, default: true },
        email: { type: Boolean, default: false }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Hash password before saving
userSchema.pre('save', async function (next) {
    // Only hash the password if it's modified (or new)
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
