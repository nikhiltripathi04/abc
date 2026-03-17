const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    phoneNumber: {
        type: String,
        required: true
    },
    gstin: {
        type: String,
        required: true,
        match: [/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Please fill a valid GSTIN']
    },
    address: {
        type: String,
        required: false
    },
    subscriptionStatus: {
        type: String,
        enum: ['active', 'inactive', 'trial'],
        default: 'trial'
    },
    receiptConfig: {
        companyName: {
            type: String,
            default: ''
        },
        companyAddress: {
            type: String,
            default: ''
        },
        companyMobile: {
            type: String,
            default: ''
        },
        companyCIN: {
            type: String,
            default: ''
        },
        companyEmail: {
            type: String,
            default: ''
        },
        nextVoucherNumber: {
            type: Number,
            default: 1
        }
    },
    salesInvoiceConfig: {
        companyName: { type: String, default: '' },
        companyAddress: { type: String, default: '' },
        companyNumber: { type: String, default: '' },
        companyEmail: { type: String, default: '' },
        msmeField: { type: String, default: '' },
        udyamRegNo: { type: String, default: '' },
        udyamDl: { type: String, default: '' },
        companyType: { type: String, default: '' },
        activities: { type: String, default: '' },
        stateCode: { type: String, default: '' },
        termsAndConditions: { type: String, default: '' },
        gstNo: { type: String, default: '' },
        panNo: { type: String, default: '' },
        authorizedSignatory: { type: String, default: '' },
        bankName: { type: String, default: '' },
        bankIfsc: { type: String, default: '' },
        bankAccount: { type: String, default: '' }
    },
    inventoryFilterConfig: {
        category: {
            enabled: { type: Boolean, default: true }
        },
        qtyRange: {
            enabled: { type: Boolean, default: true }
        },
        tags: {
            enabled: { type: Boolean, default: true }
        },
        statusToggles: {
            enabled: { type: Boolean, default: true },
            options: {
                active: { type: Boolean, default: true },
                below_min: { type: Boolean, default: true },
                out_of_stock: { type: Boolean, default: true }
            }
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Company', companySchema);
