const mongoose = require('mongoose');

const commissionTransactionSchema = new mongoose.Schema({
  driverId: {
    type: String,
    required: true,
    index: true
  },
  tripId: {
    type: String,
    required: true,
    unique: true
  },
  distanceKm: {
    type: Number,
    required: true,
    min: 0
  },
  commissionAmount: {
    type: Number,
    required: true,
    min: 0
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
  pickupLocation: {
    address: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  dropoffLocation: {
    address: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  tripFare: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'completed'
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for efficient queries
commissionTransactionSchema.index({ driverId: 1, createdAt: -1 });
commissionTransactionSchema.index({ tripId: 1 });

module.exports = mongoose.model('CommissionTransaction', commissionTransactionSchema);
