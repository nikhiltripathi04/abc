const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
    {
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
        uid: {
            type: String,
            required: true,
            trim: true
        },
        itemName: {
            type: String,
            required: true,
            trim: true
        },
        // Normalised (no-space, upper-case) version of itemName — used for O(log n) lookups
        itemNameNormalized: {
            type: String,
            default: '',
            trim: true
        },
        category: {
            type: String,
            default: 'General',
            trim: true
        },
        location: {
            type: String,
            default: '',
            trim: true
        },
        uom: {
            type: String,
            required: true,
            default: 'pcs',
            trim: true
        },
        availableQty: {
            type: Number,
            default: 0,
            min: 0
        },
        minQty: {
            type: Number,
            default: 0,
            min: 0
        },
        maxQty: {
            type: Number,
            default: 0,
            min: 0
        },
        reorderQty: {
            type: Number,
            default: 0,
            min: 0
        },
        entryPrice: {
            type: Number,
            default: 0,
            min: 0
        },
        currentPrice: {
            type: Number,
            default: 0,
            min: 0
        },
        // Running total cost (sum of receivedQty * unitPrice across all priced GRNs)
        totalPrice: {
            type: Number,
            default: 0,
            min: 0
        },
        // Weighted average price = totalPrice / availableQty (recalculated on each priced GRN)
        avgPrice: {
            type: Number,
            default: 0,
            min: 0
        },
        currency: {
            type: String,
            default: '₹',
            trim: true
        },
        tags: {
            type: [String],
            default: []
        },
        isFavorite: {
            type: Boolean,
            default: false
        },
        isActive: {
            type: Boolean,
            default: true
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    { timestamps: true }
);

// Keep itemNameNormalized in sync with itemName automatically
inventoryItemSchema.pre('save', function (next) {
    this.itemNameNormalized = String(this.itemName || '').trim().replace(/\s+/g, '').toUpperCase();
    next();
});

// Compound indexes for common queries
inventoryItemSchema.index({ warehouseId: 1, uid: 1 }, { unique: true });
inventoryItemSchema.index({ warehouseId: 1, itemName: 1 });
inventoryItemSchema.index({ warehouseId: 1, itemNameNormalized: 1 });
inventoryItemSchema.index({ warehouseId: 1, category: 1 });
inventoryItemSchema.index({ warehouseId: 1, tags: 1 });
inventoryItemSchema.index({ warehouseId: 1, availableQty: 1 }); // For status filters
inventoryItemSchema.index({ warehouseId: 1, isFavorite: 1 }); // For favorite sorting

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
