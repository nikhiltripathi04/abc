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

const ITEM_DETAIL_CHANGE_STATUSES = [
    'pending',
    'approved',
    'rejected'
];

const itemDetailChangeRequestSchema = new mongoose.Schema({
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InventoryItem',
        required: true,
        index: true
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
    // Original values (snapshot at time of request)
    originalItemName: {
        type: String,
        trim: true,
        default: ''
    },
    originalLocation: {
        type: String,
        trim: true,
        default: ''
    },
    originalCategory: {
        type: String,
        trim: true,
        default: ''
    },
    originalUom: {
        type: String,
        trim: true,
        default: ''
    },
    // Updated values (what the requester wants to change to)
    updatedItemName: {
        type: String,
        trim: true,
        default: ''
    },
    updatedLocation: {
        type: String,
        trim: true,
        default: ''
    },
    updatedCategory: {
        type: String,
        trim: true,
        default: ''
    },
    updatedUom: {
        type: String,
        trim: true,
        default: ''
    },
    reason: {
        type: String,
        trim: true,
        required: true
    },
    status: {
        type: String,
        enum: ITEM_DETAIL_CHANGE_STATUSES,
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
    rejectedAt: {
        type: Date
    },
    rejectionReason: {
        type: String,
        trim: true,
        default: ''
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
}, { timestamps: { createdAt: false, updatedAt: 'updatedAt' } });

itemDetailChangeRequestSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const ItemDetailChangeRequest = mongoose.model('ItemDetailChangeRequest', itemDetailChangeRequestSchema);

module.exports = { ItemDetailChangeRequest, ITEM_DETAIL_CHANGE_STATUSES };
