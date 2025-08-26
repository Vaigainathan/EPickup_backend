const { getFirestore } = require('../services/firebase');

class CommissionTransaction {
  constructor(data = {}) {
    this.driverId = data.driverId || '';
    this.tripId = data.tripId || '';
    this.distanceKm = data.distanceKm || 0;
    this.commissionAmount = data.commissionAmount || 0;
    this.walletBalanceBefore = data.walletBalanceBefore || 0;
    this.walletBalanceAfter = data.walletBalanceAfter || 0;
    this.pickupLocation = data.pickupLocation || {
      address: '',
      coordinates: { lat: 0, lng: 0 }
    };
    this.dropoffLocation = data.dropoffLocation || {
      address: '',
      coordinates: { lat: 0, lng: 0 }
    };
    this.tripFare = data.tripFare || 0;
    this.status = data.status || 'completed';
    this.notes = data.notes || '';
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // Convert to plain object
  toObject() {
    return {
      driverId: this.driverId,
      tripId: this.tripId,
      distanceKm: this.distanceKm,
      commissionAmount: this.commissionAmount,
      walletBalanceBefore: this.walletBalanceBefore,
      walletBalanceAfter: this.walletBalanceAfter,
      pickupLocation: this.pickupLocation,
      dropoffLocation: this.dropoffLocation,
      tripFare: this.tripFare,
      status: this.status,
      notes: this.notes,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // Static methods for Firestore operations
  static async findOne(query) {
    const db = getFirestore();
    const transactionsRef = db.collection('commissionTransactions');
    
    let queryRef = transactionsRef;
    
    if (query.driverId) {
      queryRef = queryRef.where('driverId', '==', query.driverId);
    }
    if (query.tripId) {
      queryRef = queryRef.where('tripId', '==', query.tripId);
    }
    
    const snapshot = await queryRef.limit(1).get();
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      return new CommissionTransaction({ id: doc.id, ...doc.data() });
    }
    return null;
  }

  static async find(query = {}, sort = {}) {
    const db = getFirestore();
    const transactionsRef = db.collection('commissionTransactions');
    
    let queryRef = transactionsRef;
    
    if (query.driverId) {
      queryRef = queryRef.where('driverId', '==', query.driverId);
    }
    if (query.status) {
      queryRef = queryRef.where('status', '==', query.status);
    }
    
    // Apply sorting
    if (sort.createdAt) {
      queryRef = queryRef.orderBy('createdAt', sort.createdAt === 1 ? 'asc' : 'desc');
    }
    
    const snapshot = await queryRef.get();
    return snapshot.docs.map(doc => new CommissionTransaction({ id: doc.id, ...doc.data() }));
  }

  static async create(data) {
    const db = getFirestore();
    const transactionsRef = db.collection('commissionTransactions');
    
    const transaction = new CommissionTransaction(data);
    transaction.createdAt = new Date();
    transaction.updatedAt = new Date();
    
    const docRef = await transactionsRef.add(transaction.toObject());
    transaction.id = docRef.id;
    return transaction;
  }

  async save() {
    const db = getFirestore();
    const transactionsRef = db.collection('commissionTransactions');
    
    this.updatedAt = new Date();
    
    if (this.id) {
      await transactionsRef.doc(this.id).set(this.toObject());
    } else {
      const docRef = await transactionsRef.add(this.toObject());
      this.id = docRef.id;
    }
    return this;
  }

  static async findByIdAndUpdate(id, update) {
    const db = getFirestore();
    const transactionsRef = db.collection('commissionTransactions');
    
    const doc = await transactionsRef.doc(id).get();
    if (!doc.exists) {
      return null;
    }
    
    const transaction = new CommissionTransaction({ id: doc.id, ...doc.data() });
    
    // Apply updates
    Object.assign(transaction, update);
    transaction.updatedAt = new Date();
    
    await transaction.save();
    return transaction;
  }
}

module.exports = CommissionTransaction;
