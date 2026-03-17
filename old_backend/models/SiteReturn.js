const mongoose = require('mongoose');

const RETURN_STATUSES = [
    'pending',
    'approved',
    'rejected',
    'receiving_logged',
    'completed'
];

const RETURN_REASONS = [
    'damaged',
    'excess',
    'not_needed',
    'wrong_item',
    'quality_issue',
    'other'
];

const SOURCE_TYPES = ['site_supply', 'authenticated_order'];

const returnItemSchema = new mongoose.Schema({
    itemName: {
        type: String,
        required: true,
        trim: true
    },
    inventoryItemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InventoryItem',
        default: null
    },
    requestedReturnQty: {
        type: Number,
        required: true,
        min: 0
    },
    approvedReturnQty: {
        type: Number,
        default: 0,
        min: 0
    },
    receivedQty: {
        type: Number,
        default: 0,
        min: 0
    },
    uom: {
        type: String,
        trim: true,
        default: 'pcs'
    },
    currentSiteQty: {
        type: Number,
        default: 0,
        min: 0
    },
    reasonForReturn: {
        type: String,
        enum: RETURN_REASONS,
        default: 'other'
    },
    itemRemarks: {
        type: String,
        trim: true,
        default: ''
    }
}, { _id: true, timestamps: false });

const timelineEventSchema = new mongoose.Schema({
    eventType: {
        type: String,
        required: true,
        trim: true
    },
    actorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    actorName: {
        type: String,
        default: ''
    },
    actorRole: {
        type: String,
        default: ''
    },
    note: {
        type: String,
        default: ''
    },
    meta: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false, timestamps: false });

const siteReturnSchema = new mongoose.Schema({
    returnId: {
        type: String,
        required: true,
        unique: true,
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
        required: true,
        index: true
    },
    siteName: {
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
    warehouseName: {
        type: String,
        required: true,
        trim: true
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
        enum: ['admin', 'supervisor', 'warehouse_manager'],
        default: 'supervisor'
    },
    status: {
        type: String,
        enum: RETURN_STATUSES,
        default: 'pending',
        index: true
    },
    items: {
        type: [returnItemSchema],
        default: []
    },
    sourceType: {
        type: String,
        enum: SOURCE_TYPES,
        required: true
    },
    sourceOrderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        default: null
    },
    sourceOrderCode: {
        type: String,
        trim: true,
        default: ''
    },
    returnReason: {
        type: String,
        trim: true,
        default: ''
    },
    returnNotes: {
        type: String,
        trim: true,
        default: ''
    },
    approvalDetails: {
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
        }
    },
    receivingDetails: {
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
        grnId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'GRN'
        },
        grnCode: {
            type: String,
            trim: true,
            default: ''
        },
        receivingNotes: {
            type: String,
            trim: true,
            default: ''
        },
        receivingPhotos: {
            type: [String],
            default: []
        }
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
    }
}, { timestamps: true });

// Indexes for efficient queries
siteReturnSchema.index({ companyId: 1, status: 1, createdAt: -1 });
siteReturnSchema.index({ companyId: 1, siteId: 1, createdAt: -1 });
siteReturnSchema.index({ warehouseId: 1, status: 1, createdAt: -1 });
siteReturnSchema.index({ requestedBy: 1, createdAt: -1 });

module.exports = {
    SiteReturn: mongoose.model('SiteReturn', siteReturnSchema),
    RETURN_STATUSES,
    RETURN_REASONS,
    SOURCE_TYPES
};
