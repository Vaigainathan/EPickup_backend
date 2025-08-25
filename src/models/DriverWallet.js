const mongoose = require('mongoose');

const driverWalletSchema = new mongoose.Schema({
  driverId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  initialCredit: {
    type: Number,
    default: 0,
    min: 0
  },
  commissionUsed: {
    type: Number,
    default: 0,
    min: 0
  },
  recharges: {
    type: Number,
    default: 0,
    min: 0
  },
  currentBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  lastRechargeDate: {
    type: Date,
    default: null
  },
  lastCommissionDeduction: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Calculate current balance before saving
driverWalletSchema.pre('save', function(next) {
  this.currentBalance = this.initialCredit + this.recharges - this.commissionUsed;
  next();
});

// Virtual for remaining trips based on current balance
driverWalletSchema.virtual('remainingTrips').get(function() {
  const commissionPerTrip = 1; // ₹1 per km, assuming average 1km per trip
  return Math.floor(this.currentBalance / commissionPerTrip);
});

// Virtual for low balance warning
driverWalletSchema.virtual('isLowBalance').get(function() {
  return this.currentBalance < 100;
});

// Virtual for can work status
driverWalletSchema.virtual('canWork').get(function() {
  return this.status === 'active' && this.currentBalance > 0;
});

module.exports = mongoose.model('DriverWallet', driverWalletSchema);
