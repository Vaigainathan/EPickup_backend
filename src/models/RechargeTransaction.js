const mongoose = require('mongoose');

const rechargeTransactionSchema = new mongoose.Schema({
  driverId: {
    type: String,
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 1
  },
  paymentMethod: {
    type: String,
    enum: ['upi', 'card', 'netbanking', 'cash'],
    required: true
  },
  paymentGateway: {
    type: String,
    enum: ['razorpay', 'paytm', 'phonepe', 'cash'],
    default: 'razorpay'
  },
  transactionId: {
    type: String,
    unique: true,
    sparse: true
  },
  gatewayTransactionId: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  walletBalanceBefore: {
    type: Number,
    required: true,
    min: 0
  },
  walletBalanceAfter: {
    type: Number,
    required: true,
    min: 0
  },
  failureReason: {
    type: String,
    default: null
  },
  receiptUrl: {
    type: String,
    default: null
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for efficient queries
rechargeTransactionSchema.index({ driverId: 1, createdAt: -1 });
rechargeTransactionSchema.index({ status: 1, createdAt: -1 });
rechargeTransactionSchema.index({ transactionId: 1 });

// Virtual for success status
rechargeTransactionSchema.virtual('isSuccessful').get(function() {
  return this.status === 'completed';
});

// Virtual for pending status
rechargeTransactionSchema.virtual('isPending').get(function() {
  return this.status === 'pending';
});

module.exports = mongoose.model('RechargeTransaction', rechargeTransactionSchema);
