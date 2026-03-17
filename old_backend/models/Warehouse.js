// models/Warehouse.js
const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    action: {
        type: String,
        required: true,
        enum: [
            'supply_added',
            'supply_updated',
            'supply_deleted',
            "supply_requested",
            'supply_transferred',
            'supply_request_approved',
            'supply_request_rejected',
            'supply_quantity_updated',
            'order_dispatched',
            'quantity_change_requested',
            'quantity_change_approved',
            'quantity_change_rejected',
            'quantity_updated',
            'item_detail_change_requested',
            'item_details_updated',
            'item_detail_change_rejected',
            'manager_added',
            'manager_password_reset',
            'warehouse_created',
            'warehouse_updated',
            'return_received',
            'return_approved',
            'return_rejected',
            'return_logged'
        ]
    },
    performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false
    },
    performedByName: {
        type: String,
        required: true
    },
    performedByRole: {
        type: String,
        required: true,
        enum: ['admin', 'warehouse_manager', 'company_owner', 'supervisor', 'site_manager']
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    details: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    description: {
        type: String,
        required: true
    }
}, { timestamps: true });


const warehouseSupplySchema = new mongoose.Schema({
    itemName: String,
    quantity: Number,
    unit: String,
    currency: String,
    entryPrice: Number, // Original price when added
    currentPrice: Number, // Current market price (can be updated)
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });


const warehouseSchema = new mongoose.Schema({
    warehouseName: { type: String, required: true },
    location: String,

    // NEW FIELD → identifies warehouse in UID
    warehouseNumber: {
        type: Number,
        required: true,
        unique: true
    },

    // NEW FIELD → incremental counter for item IDs
    itemCounter: {
        type: Number,
        default: 0
    },

    managers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company'
    },
    supplies: [warehouseSupplySchema],
    activityLogs: [activityLogSchema]

}, { timestamps: true });

module.exports = mongoose.model('Warehouse', warehouseSchema);
