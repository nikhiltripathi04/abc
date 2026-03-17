const mongoose = require('mongoose');

const softDeletePlugin = (schema) => {
  schema.add({
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  });

  const excludeDeleted = function(next) {
    if (!Object.prototype.hasOwnProperty.call(this.getQuery(), 'deletedAt')) {
      this.where({ deletedAt: null });
    }
    next();
  };

  schema.pre('find', excludeDeleted);
  schema.pre('findOne', excludeDeleted);
  schema.pre('findOneAndUpdate', excludeDeleted);
  schema.pre('countDocuments', excludeDeleted);

  schema.methods.softDelete = async function(deletedBy = null) {
    this.deletedAt = new Date();
    this.deletedBy = deletedBy;
    return this.save();
  };

  schema.methods.restore = async function() {
    this.deletedAt = null;
    this.deletedBy = null;
    return this.save();
  };

  schema.statics.findDeleted = function(filter = {}) {
    return this.find({ ...filter, deletedAt: { $ne: null } });
  };

  schema.statics.findWithDeleted = function(filter = {}) {
    return this.find(filter);
  };
};

module.exports = softDeletePlugin;
