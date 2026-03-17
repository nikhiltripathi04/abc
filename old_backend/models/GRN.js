const mongoose = require('mongoose');

const GRN_TYPES = ['order_based', 'standalone'];
const RECEIVING_FROM = ['warehouse', 'vendor_direct', 'site_return'];
const GRN_STATUSES = ['pending_authentication', 'authenticated', 'rejected', 'flagged'];

const grnItemSchema = new mongoose.Schema({
    itemName: { type: String, required: true, trim: true },
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },
    uom: { type: String, required: true, trim: true, default: 'pcs' },
    dispatchedQty: { type: Number, default: 0, min: 0 },
    receivedQty: { type: Number, required: true, min: 0 },
    price: { type: Number, default: 0, min: 0 },
    discrepancy: { type: Number, default: 0 },
    remarks: { type: String, trim: true, default: '' }
}, { _id: true, timestamps: false });

const timelineEventSchema = new mongoose.Schema({
    eventType: { type: String, required: true, trim: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    note: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
}, { _id: false, timestamps: false });

const grnSchema = new mongoose.Schema({
    grnId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true
    },
    grnType: {
        type: String,
        enum: GRN_TYPES,
        required: true,
        default: 'order_based'
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        index: true
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        index: true
    },
    siteName: {
        type: String,
        trim: true
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    createdByName: {
        type: String,
        required: true,
        trim: true
    },
    createdByRole: {
        type: String,
        enum: ['admin', 'company_owner', 'supervisor', 'warehouse_manager'],
        required: true
    },
    receivingFrom: {
        type: String,
        enum: RECEIVING_FROM,
        required: true,
        default: 'warehouse'
    },
    vendorName: {
        type: String,
        trim: true,
        default: ''
    },
    items: {
        type: [grnItemSchema],
        default: []
    },
    photos: {
        type: [String],
        default: []
    },
    remarks: {
        type: String,
        trim: true,
        default: ''
    },
    status: {
        type: String,
        enum: GRN_STATUSES,
        default: 'pending_authentication',
        index: true
    },
    flagged: {
        type: Boolean,
        default: false,
        index: true
    },
    flagReason: {
        type: String,
        trim: true,
        default: ''
    },
    authenticatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    authenticatedByName: {
        type: String,
        trim: true,
        default: ''
    },
    authenticatedAt: {
        type: Date
    },
    authenticationRemarks: {
        type: String,
        trim: true,
        default: ''
    },
    inventoryUpdated: {
        type: Boolean,
        default: false
    },
    inventoryUpdatedAt: {
        type: Date
    },
    timeline: {
        type: [timelineEventSchema],
        default: []
    }
}, { timestamps: true });

// Indexes for efficient queries
grnSchema.index({ companyId: 1, createdAt: -1 });
grnSchema.index({ siteId: 1, createdAt: -1 });
grnSchema.index({ orderId: 1 });
grnSchema.index({ status: 1, companyId: 1 });
grnSchema.index({ companyId: 1, flagged: 1, createdAt: -1 });
grnSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = {
    GRN: mongoose.model('GRN', grnSchema),
    GRN_TYPES,
    RECEIVING_FROM,
    GRN_STATUSES
};
