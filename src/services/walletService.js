const { getFirestore } = require('firebase-admin/firestore');
const { v4: uuidv4 } = require('uuid');

class PointsService {
  constructor() {
    this.db = getFirestore();
  }

  /**
   * Create or get driver points wallet
   * @param {string} driverId - Driver ID
   * @param {number} initialPoints - Initial points (default: 0 - no welcome bonus)
   * @returns {Promise<Object>} Result object
   */
  async createOrGetPointsWallet(driverId, initialPoints = 0) {
    try {
      console.info(`[WALLET_SERVICE] Creating or getting points wallet for driver: ${driverId}`);
      
      // Check if points wallet already exists
      const walletDoc = await this.db.collection('driverPointsWallets').doc(driverId).get();
      
      if (walletDoc.exists) {
        console.info(`[WALLET_SERVICE] Points wallet already exists for driver: ${driverId}`);
        return {
          success: true,
          message: 'Points wallet already exists',
          wallet: walletDoc.data()
        };
      }

      // Create new points wallet
      const walletData = {
        driverId,
        pointsBalance: initialPoints,
        totalPointsEarned: initialPoints,
        totalPointsSpent: 0,
        status: 'active',
        requiresTopUp: initialPoints === 0, // Requires top-up if no initial points
        createdAt: new Date(),
        lastUpdated: new Date(),
        transactions: []
      };

      await this.db.collection('driverPointsWallets').doc(driverId).set(walletData);

      console.info(`[WALLET_SERVICE] Points wallet created successfully for driver: ${driverId}`);
      return {
        success: true,
        message: 'Points wallet created successfully',
        wallet: walletData
      };

    } catch (error) {
      console.error('Error creating points wallet:', error);
      return {
        success: false,
        error: 'Failed to create points wallet'
      };
    }
  }

  /**
   * Get points wallet balance and details
   * @param {string} driverId - Driver ID
   * @returns {Promise<Object>} Result object
   */
  async getPointsBalance(driverId) {
    try {
      const walletDoc = await this.db.collection('driverPointsWallets').doc(driverId).get();
      
      if (!walletDoc.exists) {
        return {
          success: false,
          error: 'Points wallet not found'
        };
      }

      const walletData = walletDoc.data();
      
      // Get work eligibility status
      const canWorkResult = await this.canDriverWork(driverId);
      const canWork = canWorkResult.success ? canWorkResult.canWork : false;
      
      return {
        success: true,
        wallet: {
          driverId: walletData.driverId,
          pointsBalance: walletData.pointsBalance,
          totalPointsEarned: walletData.totalPointsEarned,
          totalPointsSpent: walletData.totalPointsSpent,
          status: walletData.status,
          requiresTopUp: walletData.requiresTopUp,
          canWork: canWork,
          isLowBalance: this.isLowBalance(walletData.pointsBalance),
          remainingTrips: this.getRemainingTrips(walletData.pointsBalance),
          lastUpdated: walletData.lastUpdated
        }
      };
    } catch (error) {
      console.error('Error getting points balance:', error);
      return {
        success: false,
        error: 'Failed to get points balance'
      };
    }
  }

  /**
   * Add points to driver wallet (from real money top-up)
   * @param {string} driverId - Driver ID
   * @param {number} realMoneyAmount - Real money amount paid
   * @param {string} paymentMethod - Payment method used
   * @param {Object} paymentDetails - Payment details
   * @returns {Promise<Object>} Result object
   */
  async addPoints(driverId, realMoneyAmount, paymentMethod, paymentDetails = {}) {
    const batch = this.db.batch();
    
    try {
      console.info(`[WALLET_SERVICE] Adding points for driver: ${driverId}, amount: ₹${realMoneyAmount}`);
      
      // 1:1 conversion rate (1 rupee = 1 point)
      const pointsToAdd = realMoneyAmount;
      
      // Get current wallet
      const walletDoc = await this.db.collection('driverPointsWallets').doc(driverId).get();
      
      let currentWallet;
      if (!walletDoc.exists) {
        // Create wallet if it doesn't exist
        await this.createOrGetPointsWallet(driverId, 0);
        // Fetch the newly created wallet data
        const newWalletDoc = await this.db.collection('driverPointsWallets').doc(driverId).get();
        currentWallet = newWalletDoc.data();
      } else {
        currentWallet = walletDoc.data();
      }
      
      const newPointsBalance = (currentWallet?.pointsBalance || 0) + pointsToAdd;
      const newTotalEarned = (currentWallet?.totalPointsEarned || 0) + pointsToAdd;

      // Update points wallet
      const walletRef = this.db.collection('driverPointsWallets').doc(driverId);
      batch.update(walletRef, {
        pointsBalance: newPointsBalance,
        totalPointsEarned: newTotalEarned,
        requiresTopUp: false,
        lastUpdated: new Date()
      });

      // Create points transaction
      const transactionId = uuidv4();
      const transactionRef = this.db.collection('pointsTransactions').doc(transactionId);
      batch.set(transactionRef, {
        id: transactionId,
        driverId,
        type: 'credit',
        pointsAmount: pointsToAdd,
        realMoneyAmount: realMoneyAmount,
        previousBalance: currentWallet?.pointsBalance || 0,
        newBalance: newPointsBalance,
        paymentMethod,
        paymentDetails,
        status: 'completed',
        createdAt: new Date()
      });

      // Create real money revenue record for company
      const revenueId = uuidv4();
      const revenueRef = this.db.collection('companyRevenue').doc(revenueId);
      batch.set(revenueRef, {
        id: revenueId,
        source: 'driver_topup',
        amount: realMoneyAmount,
        driverId,
        paymentMethod,
        paymentDetails,
        pointsAwarded: pointsToAdd,
        createdAt: new Date()
      });

      // Commit all operations atomically
      await batch.commit();

      console.info(`[WALLET_SERVICE] Points added successfully: ${pointsToAdd} points for ₹${realMoneyAmount}`);
      
      return {
        success: true,
        message: 'Points added successfully',
        data: {
          pointsAdded: pointsToAdd,
          newBalance: newPointsBalance,
          realMoneyAmount: realMoneyAmount,
          transactionId
        }
      };

    } catch (error) {
      console.error('Error adding points:', error);
      
      // No rollback needed - Firestore batch operations are atomic
      // If batch.commit() fails, no changes are applied
      
      // Return detailed error information
      return {
        success: false,
        error: 'Failed to add points',
        details: error.message,
        code: 'POINTS_ADD_ERROR',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Deduct points for commission
   * @param {string} driverId - Driver ID
   * @param {string} tripId - Trip ID
   * @param {number} distanceKm - Distance in kilometers
   * @param {number} pointsAmount - Points to deduct
   * @param {Object} tripDetails - Trip details
   * @returns {Promise<Object>} Result object
   */
  async deductPoints(driverId, tripId, distanceKm, pointsAmount, tripDetails = {}) {
    const batch = this.db.batch();
    
    try {
      console.info(`[WALLET_SERVICE] Deducting points for driver: ${driverId}, amount: ${pointsAmount} points`);
      
      // Get current wallet
      const walletDoc = await this.db.collection('driverPointsWallets').doc(driverId).get();
      
      if (!walletDoc.exists) {
        return {
          success: false,
          error: 'Points wallet not found'
        };
      }

      const currentWallet = walletDoc.data();
      const currentBalance = currentWallet.pointsBalance;

      // Check if sufficient balance
      if (currentBalance < pointsAmount) {
        return {
          success: false,
          error: 'Insufficient points balance',
          currentBalance,
          requiredAmount: pointsAmount
        };
      }

      const newBalance = currentBalance - pointsAmount;
      const newTotalSpent = (currentWallet.totalPointsSpent || 0) + pointsAmount;

      // Update points wallet
      const walletRef = this.db.collection('driverPointsWallets').doc(driverId);
      batch.update(walletRef, {
        pointsBalance: newBalance,
        totalPointsSpent: newTotalSpent,
        lastUpdated: new Date()
      });

      // Create commission transaction
      const transactionId = uuidv4();
      const transactionRef = this.db.collection('pointsTransactions').doc(transactionId);
      batch.set(transactionRef, {
        id: transactionId,
        driverId,
        type: 'debit',
        pointsAmount: pointsAmount,
        previousBalance: currentBalance,
        newBalance: newBalance,
        tripId,
        distanceKm,
        tripDetails,
        status: 'completed',
        createdAt: new Date()
      });

      // Commit all operations atomically
      await batch.commit();

      console.info(`[WALLET_SERVICE] Points deducted successfully: ${pointsAmount} points`);
      
      return {
        success: true,
        message: 'Points deducted successfully',
        data: {
          pointsDeducted: pointsAmount,
          newBalance: newBalance,
          transactionId
        }
      };

    } catch (error) {
      console.error('Error deducting points:', error);
      
      // No rollback needed - Firestore batch operations are atomic
      // If batch.commit() fails, no changes are applied
      
      // Return detailed error information
      return {
        success: false,
        error: 'Failed to deduct points',
        details: error.message,
        code: 'POINTS_DEDUCT_ERROR',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get transaction history
   * @param {string} driverId - Driver ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} Result object
   */
  async getTransactionHistory(driverId, filters = {}) {
    try {
      let query = this.db.collection('pointsTransactions')
        .where('driverId', '==', driverId)
        .orderBy('createdAt', 'desc');

      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      const snapshot = await query.get();
      const transactions = snapshot.docs.map(doc => doc.data());

      return {
        success: true,
        transactions
      };
    } catch (error) {
      console.error('Error getting transaction history:', error);
      return {
        success: false,
        error: 'Failed to get transaction history'
      };
    }
  }

  /**
   * Check if driver can work
   * @param {string} driverId - Driver ID
   * @returns {Promise<Object>} Result object
   */
  async canDriverWork(driverId) {
    try {
      const walletDoc = await this.db.collection('driverPointsWallets').doc(driverId).get();
      
      if (!walletDoc.exists) {
        return {
          success: false,
          canWork: false,
          reason: 'Points wallet not found'
        };
      }

      const walletData = walletDoc.data();
      const canWork = walletData.pointsBalance >= 250; // Minimum 250 points required (₹250)

      return {
        success: true,
        canWork,
        currentBalance: walletData.pointsBalance,
        requiresTopUp: walletData.requiresTopUp
      };
    } catch (error) {
      console.error('Error checking work status:', error);
      return {
        success: false,
        canWork: false,
        error: 'Failed to check work status'
      };
    }
  }

  /**
   * Check if balance is low
   * @param {number} pointsBalance - Current points balance
   * @returns {boolean} True if low balance
   */
  isLowBalance(pointsBalance) {
    return pointsBalance < 100; // Low balance threshold
  }

  /**
   * Get remaining trips possible
   * @param {number} pointsBalance - Current points balance
   * @param {number} commissionPerKm - Commission per km (default: 2 points)
   * @returns {number} Number of trips possible
   */
  getRemainingTrips(pointsBalance, commissionPerKm = 2) {
    return Math.floor(pointsBalance / commissionPerKm);
  }

  /**
   * Update wallet status
   * @param {string} driverId - Driver ID
   * @param {string} status - New status
   * @returns {Promise<Object>} Result object
   */
  async updateWalletStatus(driverId, status) {
    try {
      await this.db.collection('driverPointsWallets').doc(driverId).update({
        status,
        lastUpdated: new Date()
      });

      return {
        success: true,
        message: 'Wallet status updated successfully'
      };
    } catch (error) {
      console.error('Error updating wallet status:', error);
      return {
        success: false,
        error: 'Failed to update wallet status'
      };
    }
  }

  /**
   * Get wallet statistics
   * @param {string} driverId - Driver ID
   * @returns {Promise<Object>} Result object
   */
  async getWalletStats(driverId) {
    try {
      const walletDoc = await this.db.collection('driverPointsWallets').doc(driverId).get();
      
      if (!walletDoc.exists) {
        return {
          success: false,
          error: 'Points wallet not found'
        };
      }

      const walletData = walletDoc.data();
      
      return {
        success: true,
        stats: {
          currentBalance: walletData.pointsBalance,
          totalEarned: walletData.totalPointsEarned,
          totalSpent: walletData.totalPointsSpent,
          remainingTrips: this.getRemainingTrips(walletData.pointsBalance),
          isLowBalance: this.isLowBalance(walletData.pointsBalance),
          canWork: this.canDriverWork(driverId),
          status: walletData.status
        }
      };
    } catch (error) {
      console.error('Error getting wallet stats:', error);
      return {
        success: false,
        error: 'Failed to get wallet stats'
      };
    }
  }
}

// Export as both WalletService and PointsService for backward compatibility
module.exports = new PointsService();
module.exports.PointsService = PointsService;