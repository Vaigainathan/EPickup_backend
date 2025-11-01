/**
 * ⚠️ IMPORTANT: Keep in sync with fare calculation rates
 * 
 * AUTHORITATIVE SOURCE: backend/src/services/fareCalculationService.js
 * 
 * CURRENT RATES:
 * - Commission: ₹2/km (deducted from driver points wallet)
 * 
 * This model is LEGACY - use PointsService instead.
 * Kept for backward compatibility with old driverWallets collection.
 */

const { getFirestore } = require('../services/firebase');

class DriverWallet {
  constructor(data = {}) {
    this.driverId = data.driverId || '';
    this.initialCredit = data.initialCredit || 0;
    this.commissionUsed = data.commissionUsed || 0;
    this.recharges = data.recharges || 0;
    this.currentBalance = data.currentBalance || 0;
    this.status = data.status || 'active';
    this.lastRechargeDate = data.lastRechargeDate || null;
    this.lastCommissionDeduction = data.lastCommissionDeduction || null;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // Calculate current balance
  calculateBalance() {
    this.currentBalance = this.initialCredit + this.recharges - this.commissionUsed;
    return this.currentBalance;
  }

  // Get remaining trips based on current balance
  // UPDATED: Commission is now ₹2/km (was ₹1/km)
  getRemainingTrips() {
    const commissionPerKm = 2; // ₹2 per km (UPDATED from 1)
    return Math.floor(this.currentBalance / commissionPerKm);
  }

  // Check if balance is low
  isLowBalance() {
    return this.currentBalance < 100;
  }

  // Check if driver can work
  canWork() {
    return this.status === 'active' && this.currentBalance > 0;
  }

  // Convert to plain object
  toObject() {
    return {
      driverId: this.driverId,
      initialCredit: this.initialCredit,
      commissionUsed: this.commissionUsed,
      recharges: this.recharges,
      currentBalance: this.currentBalance,
      status: this.status,
      lastRechargeDate: this.lastRechargeDate,
      lastCommissionDeduction: this.lastCommissionDeduction,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      remainingTrips: this.getRemainingTrips(),
      isLowBalance: this.isLowBalance(),
      canWork: this.canWork()
    };
  }

  // Static methods for Firestore operations
  static async findOne(query) {
    const db = getFirestore();
    const walletsRef = db.collection('driverWallets');
    
    // Handle both object and direct driverId
    const driverId = query.driverId || query;
    
    if (driverId) {
      const doc = await walletsRef.doc(driverId).get();
      if (doc.exists) {
        return new DriverWallet({ id: doc.id, ...doc.data() });
      }
    }
    return null;
  }

  static async create(data) {
    const db = getFirestore();
    const walletsRef = db.collection('driverWallets');
    
    const wallet = new DriverWallet(data);
    wallet.calculateBalance();
    wallet.createdAt = new Date();
    wallet.updatedAt = new Date();
    
    await walletsRef.doc(wallet.driverId).set(wallet.toObject());
    return wallet;
  }

  async save() {
    const db = getFirestore();
    const walletsRef = db.collection('driverWallets');
    
    this.calculateBalance();
    this.updatedAt = new Date();
    
    await walletsRef.doc(this.driverId).set(this.toObject());
    return this;
  }

  static async findByIdAndUpdate(id, update) {
    const db = getFirestore();
    const walletsRef = db.collection('driverWallets');
    
    const doc = await walletsRef.doc(id).get();
    if (!doc.exists) {
      return null;
    }
    
    const wallet = new DriverWallet({ id: doc.id, ...doc.data() });
    
    // Apply updates
    Object.assign(wallet, update);
    wallet.updatedAt = new Date();
    
    await wallet.save();
    return wallet;
  }
}

module.exports = DriverWallet;
