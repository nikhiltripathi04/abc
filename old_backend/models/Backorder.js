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

const BACKORDER_STATUSES = [
    'pending',
    'approved',
    'in_fulfillment',
    'fulfilled',
    'cancelled'
];

const backorderSchema = new mongoose.Schema({
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
        index: true
    },
    backorderCode: {
        type: String,
        trim: true,
        default: '',
        index: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true,
        index: true
    },
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
    backorderQty: {
        type: Number,
        required: true,
        min: 1
    },
    originalRequestQty: {
        type: Number,
        required: true,
        min: 1
    },
    originalAvailableQty: {
        type: Number,
        required: true,
        min: 0
    },
    vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor'
    },
    vendorName: {
        type: String,
        trim: true,
        default: ''
    },
    status: {
        type: String,
        enum: BACKORDER_STATUSES,
        default: 'pending',
        index: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    createdByName: {
        type: String,
        trim: true,
        default: ''
    },
    expectedFulfillmentDate: {
        type: Date
    },
    approvedAt: {
        type: Date
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
    receivedQty: {
        type: Number,
        default: 0,
        min: 0
    },
    completedAt: {
        type: Date
    },
    completedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    completedByName: {
        type: String,
        trim: true,
        default: ''
    },
    notes: {
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
}, { timestamps: true });

backorderSchema.index({ companyId: 1, status: 1, createdAt: -1 });
backorderSchema.index({ siteId: 1, status: 1 });
backorderSchema.index({ orderId: 1 });
backorderSchema.index({ companyId: 1, orderId: 1 });

module.exports = {
    Backorder: mongoose.model('Backorder', backorderSchema),
    BACKORDER_STATUSES
};
