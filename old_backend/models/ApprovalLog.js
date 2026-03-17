const mongoose = require('mongoose');

const APPROVAL_TYPES = [
    'supply_request',
    'quantity_change',
    'sales_invoice',
    'sales_request',
    'site_return'
];

const APPROVAL_STATUSES = [
    'pending',
    'approved',
    'rejected',
    'partial'
];

const approvalLogSchema = new mongoose.Schema({
    approvalType: {
        type: String,
        enum: APPROVAL_TYPES,
        required: true,
        index: true
    },
    referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    referenceName: {
        type: String,
        required: true,
        trim: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site'
    },
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    adminName: {
        type: String,
        trim: true,
        required: true
    },
    status: {
        type: String,
        enum: APPROVAL_STATUSES,
        default: 'pending',
        index: true
    },
    totalItems: {
        type: Number,
        default: 0,
        min: 0
    },
    approvedItems: {
        type: Number,
        default: 0,
        min: 0
    },
    rejectedItems: {
        type: Number,
        default: 0,
        min: 0
    },
    partialItems: {
        type: Number,
        default: 0,
        min: 0
    },
    decision: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    remarks: {
        type: String,
        trim: true,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    completedAt: {
        type: Date
    },
    timeToApproval: {
        type: Number, // milliseconds
        default: 0
    }
}, { timestamps: true });

approvalLogSchema.index({ companyId: 1, status: 1, createdAt: -1 });
approvalLogSchema.index({ adminId: 1, createdAt: -1 });
approvalLogSchema.index({ approvalType: 1, status: 1 });

module.exports = {
    ApprovalLog: mongoose.model('ApprovalLog', approvalLogSchema),
    APPROVAL_TYPES,
    APPROVAL_STATUSES
};
