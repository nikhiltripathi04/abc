const mongoose = require('mongoose');

const ORDER_STATUSES = [
    'draft',
    'pending_approval',
    'partially_approved',
    'approved',
    'rejected',
    'pending_dispatch',
    'in_fulfillment',
    'dispatched',
    'awaiting_receipt',
    'received',
    'authenticated',
    'price_confirmed',
    'cancelled'
];

const RECEIVING_FROM = ['warehouse', 'vendor_direct'];

const orderItemSchema = new mongoose.Schema({
    itemName: { type: String, required: true, trim: true },
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },
    uom: { type: String, required: true, trim: true, default: 'pcs' },
    requestedQty: { type: Number, required: true, min: 0 },
    approvedQty: { type: Number, default: 0, min: 0 },
    dispatchedQty: { type: Number, default: 0, min: 0 },
    receivedQty: { type: Number, default: 0, min: 0 },
    isCustomItem: { type: Boolean, default: false },
    approvalDecision: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'partial'],
        default: 'pending'
    },
    remarks: { type: String, trim: true, default: '' },
    // Approval-specific fields
    backorderCreated: { type: Boolean, default: false },
    backorderQty: { type: Number, default: 0, min: 0 },
    backorderID: { type: mongoose.Schema.Types.ObjectId, ref: 'Backorder' },
    itemAvailableQty: { type: Number, default: 0, min: 0 }, // snapshot at approval time
    itemStatus: {
        type: String,
        enum: ['in_stock', 'partial_stock', 'out_of_stock'],
        default: 'in_stock'
    },
    assignedWarehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
    routingDecision: {
        type: String,
        enum: ['warehouse', 'direct_to_site'],
        default: 'warehouse'
    },
    approvalRemarks: { type: String, trim: true, default: '' },
    decidedAt: { type: Date },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedByName: { type: String, trim: true, default: '' },
    splitOrderId: { type: String, trim: true, default: '' },
    // Snapshot of the avg price from inventory at the time the order was created
    inventoryPrice: { type: Number, default: 0, min: 0 }
}, { _id: true, timestamps: false });

const timelineEventSchema = new mongoose.Schema({
    eventType: { type: String, required: true, trim: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    note: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now }
}, { _id: false, timestamps: false });

const orderSchema = new mongoose.Schema({
    orderId: {
        type: String,
        required: false,
        unique: true,
        sparse: true,
        trim: true,
        uppercase: true
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
        required: false,
        index: true
    },
    siteName: {
        type: String,
        required: false,
        trim: true,
        default: ''
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    },
    requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    requestedByName: {
        type: String,
        required: true,
        trim: true
    },
    requestedByRole: {
        type: String,
        enum: ['admin', 'company_owner', 'supervisor', 'warehouse_manager'],
        required: true
    },
    receivingFrom: {
        type: String,
        enum: RECEIVING_FROM,
        default: 'warehouse'
    },
    status: {
        type: String,
        enum: ORDER_STATUSES,
        default: 'draft',
        index: true
    },
    items: {
        type: [orderItemSchema],
        default: []
    },
    neededBy: {
        type: Date
    },
    vendorName: {
        type: String,
        trim: true,
        default: ''
    },
    notes: {
        type: String,
        trim: true,
        default: ''
    },
    approvalDetails: {
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        approvedAt: { type: Date },
        approvalNotes: { type: String, trim: true, default: '' },
        approvalRemarks: { type: String, trim: true, default: '' },
        routingDecision: { type: String, enum: ['warehouse', 'direct_to_site'], default: 'warehouse' },
        vendorName: { type: String, trim: true, default: '' },
        expectedDeliveryDate: { type: Date }
    },
    sourcePlatform: {
        type: String,
        enum: ['mobile', 'web'],
        default: 'web'
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
    dispatchId: {
        type: String,
        trim: true,
        default: ''
    },
    dispatchedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    dispatchedByName: {
        type: String,
        trim: true,
        default: ''
    },
    dispatchedAt: {
        type: Date
    },
    dispatchRemarks: {
        type: String,
        trim: true,
        default: ''
    },
    dispatchPhotos: {
        type: [String],
        default: []
    },
    receivedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    receivedByName: {
        type: String,
        trim: true,
        default: ''
    },
    receivedAt: {
        type: Date
    },
    cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    cancelledByName: {
        type: String,
        trim: true,
        default: ''
    },
    cancelledAt: {
        type: Date
    },
    cancellationReason: {
        type: String,
        trim: true,
        default: ''
    },
    timeline: {
        type: [timelineEventSchema],
        default: []
    },
    grnId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GRN'
    },
    grnCode: {
        type: String,
        trim: true,
        default: ''
    },
    sequenceNumber: {
        type: Number
    },
    currentStage: {
        type: String,
        default: 'ORD'
    }
}, { timestamps: true });

orderSchema.index({ companyId: 1, status: 1, createdAt: -1 });
orderSchema.index({ companyId: 1, siteId: 1, createdAt: -1 });
orderSchema.index({ warehouseId: 1, status: 1, createdAt: -1 });
orderSchema.index({ requestedBy: 1, createdAt: -1 });

module.exports = {
    Order: mongoose.model('Order', orderSchema),
    ORDER_STATUSES,
    RECEIVING_FROM
};
