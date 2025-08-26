const { getFirestore } = require('../services/firebase');

class RechargeTransaction {
  constructor(data = {}) {
    this.driverId = data.driverId || '';
    this.amount = data.amount || 0;
    this.paymentMethod = data.paymentMethod || 'upi';
    this.paymentGateway = data.paymentGateway || 'razorpay';
    this.transactionId = data.transactionId || '';
    this.gatewayTransactionId = data.gatewayTransactionId || null;
    this.status = data.status || 'pending';
    this.walletBalanceBefore = data.walletBalanceBefore || 0;
    this.walletBalanceAfter = data.walletBalanceAfter || 0;
    this.failureReason = data.failureReason || null;
    this.receiptUrl = data.receiptUrl || null;
    this.notes = data.notes || '';
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // Check if transaction is successful
  isSuccessful() {
    return this.status === 'completed';
  }

  // Check if transaction is pending
  isPending() {
    return this.status === 'pending';
  }

  // Convert to plain object
  toObject() {
    return {
      driverId: this.driverId,
      amount: this.amount,
      paymentMethod: this.paymentMethod,
      paymentGateway: this.paymentGateway,
      transactionId: this.transactionId,
      gatewayTransactionId: this.gatewayTransactionId,
      status: this.status,
      walletBalanceBefore: this.walletBalanceBefore,
      walletBalanceAfter: this.walletBalanceAfter,
      failureReason: this.failureReason,
      receiptUrl: this.receiptUrl,
      notes: this.notes,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      isSuccessful: this.isSuccessful(),
      isPending: this.isPending()
    };
  }

  // Static methods for Firestore operations
  static async findOne(query) {
    const db = getFirestore();
    const transactionsRef = db.collection('rechargeTransactions');
    
    let queryRef = transactionsRef;
    
    if (query.driverId) {
      queryRef = queryRef.where('driverId', '==', query.driverId);
    }
    if (query.transactionId) {
      queryRef = queryRef.where('transactionId', '==', query.transactionId);
    }
    if (query.status) {
      queryRef = queryRef.where('status', '==', query.status);
    }
    
    const snapshot = await queryRef.limit(1).get();
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      return new RechargeTransaction({ id: doc.id, ...doc.data() });
    }
    return null;
  }

  static async find(query = {}, sort = {}) {
    const db = getFirestore();
    const transactionsRef = db.collection('rechargeTransactions');
    
    let queryRef = transactionsRef;
    
    if (query.driverId) {
      queryRef = queryRef.where('driverId', '==', query.driverId);
    }
    if (query.status) {
      queryRef = queryRef.where('status', '==', query.status);
    }
    if (query.paymentMethod) {
      queryRef = queryRef.where('paymentMethod', '==', query.paymentMethod);
    }
    
    // Apply sorting
    if (sort.createdAt) {
      queryRef = queryRef.orderBy('createdAt', sort.createdAt === 1 ? 'asc' : 'desc');
    }
    
    const snapshot = await queryRef.get();
    return snapshot.docs.map(doc => new RechargeTransaction({ id: doc.id, ...doc.data() }));
  }

  static async create(data) {
    const db = getFirestore();
    const transactionsRef = db.collection('rechargeTransactions');
    
    const transaction = new RechargeTransaction(data);
    transaction.createdAt = new Date();
    transaction.updatedAt = new Date();
    
    const docRef = await transactionsRef.add(transaction.toObject());
    transaction.id = docRef.id;
    return transaction;
  }

  async save() {
    const db = getFirestore();
    const transactionsRef = db.collection('rechargeTransactions');
    
    this.updatedAt = new Date();
    
    if (this.id) {
      await transactionsRef.doc(this.id).set(this.toObject());
    } else {
      const docRef = await transactionsRef.add(this.toObject());
      this.id = docRef.id;
    }
    return this;
  }

  static async findByIdAndUpdate(id, update, options = {}) {
    const db = getFirestore();
    const transactionsRef = db.collection('rechargeTransactions');
    
    const doc = await transactionsRef.doc(id).get();
    if (!doc.exists) {
      return null;
    }
    
    const transaction = new RechargeTransaction({ id: doc.id, ...doc.data() });
    
    // Apply updates
    Object.assign(transaction, update);
    transaction.updatedAt = new Date();
    
    await transaction.save();
    return transaction;
  }
}

module.exports = RechargeTransaction;
