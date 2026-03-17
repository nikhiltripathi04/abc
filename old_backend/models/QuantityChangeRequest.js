const mongoose = require('mongoose');

const timelineEventSchema = new mongoose.Schema({
    eventType: { type: String, required: true, trim: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    note: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now }
}, { _id: false, timestamps: false });

const QUANTITY_CHANGE_STATUSES = [
    'pending',
    'approved',
    'rejected'
];

const quantityChangeRequestSchema = new mongoose.Schema({
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InventoryItem',
        required: true,
        index: true
    },
    itemName: {
        type: String,
        required: true,
        trim: true
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse',
        required: true,
        index: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    requestedByName: {
        type: String,
        trim: true,
        required: true
    },
    requestedByRole: {
        type: String,
        default: 'warehouse_manager',
        trim: true
    },
    originalQuantity: {
        type: Number,
        required: true,
        min: 0
    },
    updatedQuantity: {
        type: Number,
        required: true,
        min: 0
    },
    reason: {
        type: String,
        trim: true,
        required: true
    },
    status: {
        type: String,
        enum: QUANTITY_CHANGE_STATUSES,
        default: 'pending',
        index: true
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedByName: {
        type: String,
        trim: true,
        default: ''
    },
    approvedAt: {
        type: Date
    },
    approvalRemarks: {
        type: String,
        trim: true,
        default: ''
    },
    rejectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    rejectedByName: {
        type: String,
        trim: true,
        default: ''
    },
    rejectionReason: {
        type: String,
        trim: true,
        default: ''
    },
    rejectedAt: {
        type: Date
    },
    timeline: {
        type: [timelineEventSchema],
        default: []
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

quantityChangeRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });
quantityChangeRequestSchema.index({ warehouseId: 1, status: 1 });
quantityChangeRequestSchema.index({ itemId: 1 });
quantityChangeRequestSchema.index({ companyId: 1, status: 1, requestedBy: 1, createdAt: -1 });

module.exports = {
    QuantityChangeRequest: mongoose.model('QuantityChangeRequest', quantityChangeRequestSchema),
    QUANTITY_CHANGE_STATUSES
};
