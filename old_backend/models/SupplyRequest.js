// models/SupplyRequest.js
const mongoose = require('mongoose');

const supplyRequestSchema = new mongoose.Schema({
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true
    },
    siteName: {
        type: String,
        required: true
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse',
        required: true
    },
    requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    requestedByName: {
        type: String,
        required: true
    },
    itemName: {
        type: String,
        required: true
    },
    requestedQuantity: {
        type: Number,
        required: true
    },
    unit: {
        type: String,
        required: true
    },
    status: {
        type: String,
        // Added 'in_transit' to the enum
        enum: ['pending', 'approved', 'rejected', 'in_transit'], 
        default: 'pending'
    },
    // Optional: Group ID to identify items requested together in a list
    batchId: {
        type: String, 
        required: false
    },
    transferredQuantity: {
        type: Number,
        default: 0
    },
    handledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    handledByName: String,
    handledAt: Date,
    notes: String,
    reason: String // For rejection reason
}, { timestamps: true });

module.exports = mongoose.model('SupplyRequest', supplyRequestSchema);