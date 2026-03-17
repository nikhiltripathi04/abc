const mongoose = require('mongoose');

const SALES_REQUEST_STATUSES = [
    'draft',
    'pending_approval',
    'approved',
    'rejected'
];

const salesItemSchema = new mongoose.Schema({
    inventoryItemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InventoryItem',
        required: true
    },
    itemName: {
        type: String,
        required: true,
        trim: true
    },
    itemUid: {
        type: String,
        trim: true
    },
    hsnCode: {
        type: String,
        trim: true,
        default: ''
    },
    uom: {
        type: String,
        trim: true,
        default: ''
    },
    currency: {
        type: String,
        trim: true,
        default: '₹'
    },
    requestedQty: {
        type: Number,
        default: 0,
        min: 0
    },
    approvedQty: {
        type: Number,
        default: 0,
        min: 0
    },
    approvalDecision: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'partial'],
        default: 'pending'
    },
    availableQtySnapshot: {
        type: Number,
        default: 0,
        min: 0
    },
    price: {
        type: Number,
        default: 0,
        min: 0
    },
    lineTotal: {
        type: Number,
        default: 0,
        min: 0
    },
    notes: {
        type: String,
        trim: true,
        default: ''
    }
}, { _id: true });

const salesRequestSchema = new mongoose.Schema({
    salesRequestId: {
        type: String,
        required: true,
        trim: true,
        index: true,
        unique: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse',
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: SALES_REQUEST_STATUSES,
        default: 'draft',
        index: true
    },
    customer: {
        name: { type: String, trim: true, default: '' },
        number: { type: String, trim: true, default: '' },
        address: { type: String, trim: true, default: '' },
        gst: { type: String, trim: true, default: '' },
        pan: { type: String, trim: true, default: '' }
    },
    items: {
        type: [salesItemSchema],
        default: []
    },
    itemTotal: {
        type: Number,
        default: 0,
        min: 0
    },
    discount: {
        type: Number,
        default: 0,
        min: 0
    },
    freight: {
        type: Number,
        default: 0,
        min: 0
    },
    taxableTotal: {
        type: Number,
        default: 0,
        min: 0
    },
    cgstPercent: {
        type: Number,
        default: 0,
        min: 0
    },
    sgstPercent: {
        type: Number,
        default: 0,
        min: 0
    },
    cgstAmount: {
        type: Number,
        default: 0,
        min: 0
    },
    sgstAmount: {
        type: Number,
        default: 0,
        min: 0
    },
    grandTotal: {
        type: Number,
        default: 0,
        min: 0
    },
    notes: {
        type: String,
        trim: true,
        default: ''
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    createdByName: {
        type: String,
        trim: true,
        required: true
    },
    createdByRole: {
        type: String,
        trim: true,
        default: ''
    },
    submittedAt: {
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
    approvedAt: {
        type: Date
    },
    approvalNotes: {
        type: String,
        trim: true,
        default: ''
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
    invoice: {
        number: { type: String, trim: true, default: '' },
        pdfBase64: { type: String, default: '' },
        fileName: { type: String, trim: true, default: '' },
        generatedAt: { type: Date },
        generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }
}, { timestamps: true });

salesRequestSchema.index({ companyId: 1, warehouseId: 1, status: 1, createdAt: -1 });
salesRequestSchema.index({ createdBy: 1, status: 1, createdAt: -1 });

module.exports = {
    SalesRequest: mongoose.model('SalesRequest', salesRequestSchema),
    SALES_REQUEST_STATUSES
};
