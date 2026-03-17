const mongoose = require('mongoose');

const suppliesSchema = new mongoose.Schema({
  itemName: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 0
  },
  cost: {
    type: Number,
    required: false,
    min: 0
  },
  // Running total cost (sum of receivedQty * unitPrice across all priced GRNs)
  totalCost: {
    type: Number,
    required: false,
    default: 0,
    min: 0
  },
  // Weighted average cost = totalCost / quantity (recomputed on each priced GRN)
  avgCost: {
    type: Number,
    required: false,
    default: 0,
    min: 0
  },
  unit: {
    type: String,
    default: 'pcs'
  },
  status: {
    type: String,
    enum: ['pending_pricing', 'priced'],
    default: 'pending_pricing'
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  addedByName: {
    type: String,
    required: false, // Changed from true to false
    default: 'Unknown'
  },
  pricedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  pricedByName: {
    type: String
  },
  pricedAt: {
    type: Date
  }
}, { timestamps: true });

const workerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  role: {
    type: String,
    required: true
  },
  phoneNumber: String,
  attendance: [{
    date: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['present', 'absent'],
      default: 'present'
    }
  }]
}, { timestamps: true });

// Activity Log Schema
const activityLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'supply_added',
      'supply_updated',
      'supply_deleted',
      'supply_quantity_updated',    // Add this
      'supplies_bulk_imported',     // Add this
      'worker_added',
      'worker_updated',
      'worker_deleted',
      'attendance_marked',
      'attendance_updated',
      'site_created',
      'site_updated',
      'supervisor_added',
      'supervisor_removed',
      'announcement_created',
      'announcement_updated',
      'announcement_deleted',
      'supervisor_password_reset',
      'supply_received',
      'supply_used',
      'supply_requested',
      'supply_request_approved',
      'supply_request_rejected',
      'item_return_requested',
      'item_return_approved',
      'item_return_rejected',
      'item_return_received',
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
    enum: ['admin', 'supervisor', 'warehouse_manager']
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

const announcementSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdByName: {
    type: String,
    required: true
  },
  media: {
    type: String, // URL to the uploaded media file
    default: null
  },
  mediaType: {
    type: String,
    enum: ['image', 'video', null],
    default: null
  },
  isUrgent: {
    type: Boolean,
    default: false
  },
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }]
}, { timestamps: true });

const siteSchema = new mongoose.Schema({
  siteName: {
    type: String,
    required: true
  },
  location: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  announcements: [announcementSchema],
  supplies: [suppliesSchema],
  workers: [workerSchema],
  supervisors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  activityLogs: [activityLogSchema]
}, { timestamps: true });

module.exports = mongoose.model('Site', siteSchema);
