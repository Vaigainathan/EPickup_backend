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
   * ✅ CRITICAL FIX: Optimized to avoid redundant DB queries
   * @param {string} driverId - Driver ID
   * @param {boolean} useCache - Whether to use cache (default: true)
   * @returns {Promise<Object>} Result object
   */
  async getPointsBalance(driverId, useCache = true) {
    try {
      // ✅ CRITICAL FIX: Check cache first to reduce DB load
      if (useCache) {
        try {
          const cachingService = require('./cachingService');
          const cacheKey = `wallet:balance:${driverId}`;
          const cached = await cachingService.get(cacheKey, 'memory');
          if (cached) {
            console.log(`✅ [WALLET_SERVICE] Cache hit for wallet balance: ${driverId}`);
            return cached;
          }
        } catch (cacheError) {
          console.warn('⚠️ [WALLET_SERVICE] Cache check failed, proceeding with DB query:', cacheError.message);
        }
      }

      const walletDoc = await this.db.collection('driverPointsWallets').doc(driverId).get();
      
      if (!walletDoc.exists) {
        return {
          success: false,
          error: 'Points wallet not found'
        };
      }

      const walletData = walletDoc.data();
      
      // ✅ CRITICAL FIX: canWork is NOT based on a fixed balance threshold
      // Commission sufficiency is validated per booking acceptance instead
      const canWork = walletData.status !== 'suspended';
      
      const result = {
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

      // ✅ CRITICAL FIX: Cache the result for 30 seconds (short TTL for balance accuracy)
      if (useCache) {
        try {
          const cachingService = require('./cachingService');
          const cacheKey = `wallet:balance:${driverId}`;
          await cachingService.set(cacheKey, result, 30, 'memory'); // 30 second cache
        } catch (cacheError) {
          console.warn('⚠️ [WALLET_SERVICE] Cache set failed:', cacheError.message);
        }
      }

      return result;
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
        phonepeTransactionId: paymentDetails?.transactionId || paymentDetails?.phonepeTransactionId || null,
        transactionId: transactionId, // Link to points transaction
        createdAt: new Date()
      });

      // Commit all operations atomically
      await batch.commit();

      // ✅ CRITICAL FIX: Invalidate wallet balance cache after update
      try {
        const cachingService = require('./cachingService');
        await cachingService.delete(`wallet:balance:${driverId}`, 'memory');
        // Invalidate all wallet:full cache entries for this driver using pattern
        await cachingService.invalidatePattern(`wallet:full:${driverId}:`, 'memory');
        // Also invalidate transaction count cache
        await cachingService.delete(`wallet:transactions:count:${driverId}`, 'memory');
      } catch (cacheError) {
        console.warn('⚠️ [WALLET_SERVICE] Failed to invalidate cache after points add:', cacheError.message);
      }

      console.info(`[WALLET_SERVICE] Points added successfully: ${pointsToAdd} points for ₹${realMoneyAmount}`);

      // Emit real-time wallet update event
      try {
        const socketService = require('./socket');
        const walletData = {
          balance: newPointsBalance,
          transactions: [{
            id: transactionId,
            type: 'credit',
            amount: pointsToAdd,
            previousBalance: currentWallet?.pointsBalance || 0,
            newBalance: newPointsBalance,
            paymentMethod,
            status: 'completed',
            createdAt: new Date().toISOString()
          }]
        };
        socketService.emitWalletUpdate(driverId, walletData);
        socketService.emitTransactionEvent(driverId, walletData.transactions[0]);
        
        // Emit revenue update to admin
        socketService.emitRevenueUpdate({
          totalRevenue: realMoneyAmount,
          driverId,
          source: 'driver_topup'
        });
      } catch (socketError) {
        console.warn('⚠️ [WALLET_SERVICE] Failed to emit wallet update event:', socketError.message);
      }
      
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

      // ✅ CRITICAL FIX: Create commission transaction with proper distance fields
      const transactionId = uuidv4();
      const transactionRef = this.db.collection('pointsTransactions').doc(transactionId);
      
      // ✅ Extract rounded and exact distance from tripDetails if available
      const roundedDistanceKm = tripDetails.distance || tripDetails.roundedDistanceKm || distanceKm;
      const exactDistanceKm = tripDetails.exactDistance || tripDetails.exactDistanceKm;
      
      batch.set(transactionRef, {
        id: transactionId,
        driverId,
        type: 'debit',
        pointsAmount: pointsAmount,
        previousBalance: currentBalance,
        newBalance: newBalance,
        tripId,
        distanceKm: roundedDistanceKm, // ✅ Store rounded distance (primary)
        exactDistanceKm: exactDistanceKm || distanceKm, // ✅ Store exact distance if available
        tripDetails: {
          ...tripDetails,
          distance: roundedDistanceKm, // ✅ Ensure rounded distance in tripDetails
          exactDistance: exactDistanceKm || distanceKm
        },
        status: 'completed',
        createdAt: new Date()
      });

      // Commit all operations atomically
      await batch.commit();

      // ✅ CRITICAL FIX: Invalidate wallet balance cache after deduction
      try {
        const cachingService = require('./cachingService');
        await cachingService.delete(`wallet:balance:${driverId}`, 'memory');
        // Invalidate all wallet:full cache entries for this driver using pattern
        await cachingService.invalidatePattern(`wallet:full:${driverId}:`, 'memory');
        // Also invalidate transaction count cache
        await cachingService.delete(`wallet:transactions:count:${driverId}`, 'memory');
      } catch (cacheError) {
        console.warn('⚠️ [WALLET_SERVICE] Failed to invalidate cache after points deduction:', cacheError.message);
      }

      console.info(`[WALLET_SERVICE] Points deducted successfully: ${pointsAmount} points`);

      // Emit real-time wallet update event
      try {
        const socketService = require('./socket');
        const walletData = {
          balance: newBalance,
          transactions: [{
            id: transactionId,
            type: 'debit',
            amount: -pointsAmount,
            previousBalance: currentBalance,
            newBalance: newBalance,
            status: 'completed',
            tripId,
            distanceKm: roundedDistanceKm,
            createdAt: new Date().toISOString()
          }]
        };
        socketService.emitWalletUpdate(driverId, walletData);
        socketService.emitTransactionEvent(driverId, walletData.transactions[0]);
      } catch (socketError) {
        console.warn('⚠️ [WALLET_SERVICE] Failed to emit wallet update event:', socketError.message);
      }
      
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
   * ✅ CRITICAL FIX: Optimized pagination to reduce DB load
   * @param {string} driverId - Driver ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} Result object
   */
  async getTransactionHistory(driverId, filters = {}) {
    try {
      const limit = Math.min(filters.limit || 20, 100);
      const offset = filters.offset || 0;
      const type = filters.type; // 'credit' or 'debit'
      const startDate = filters.startDate;
      const endDate = filters.endDate;
      const sortBy = filters.sortBy || 'createdAt'; // 'createdAt' or 'amount'
      const sortOrder = filters.sortOrder || 'desc'; // 'asc' or 'desc'

      // ✅ CRITICAL FIX: Use cursor-based pagination for better performance
      // Instead of fetching all transactions and slicing, use startAfter for offset
      let query = this.db.collection('pointsTransactions')
        .where('driverId', '==', driverId);
      
      // Apply type filter if provided
      if (type) {
        query = query.where('type', '==', type);
      }
      
      // Apply date range filters if provided
      if (startDate) {
        const start = startDate instanceof Date ? startDate : new Date(startDate);
        query = query.where('createdAt', '>=', start);
      }
      if (endDate) {
        const end = endDate instanceof Date ? endDate : new Date(endDate);
        query = query.where('createdAt', '<=', end);
      }
      
      // Apply sorting - Firestore requires composite index for multiple where clauses
      // For now, we'll sort by createdAt (most common case)
      // If sorting by amount is needed with filters, a composite index is required
      if (sortBy === 'amount' && !type && !startDate && !endDate) {
        query = query.orderBy('pointsAmount', sortOrder);
      } else {
        query = query.orderBy('createdAt', sortOrder);
      }
      
      query = query.limit(limit);

      // ✅ CRITICAL FIX: For offset > 0, we need to fetch offset documents first to get cursor
      // This is still better than fetching ALL transactions
      if (offset > 0) {
        // Build offset query with same filters
        let offsetQuery = this.db.collection('pointsTransactions')
          .where('driverId', '==', driverId);
        
        if (type) {
          offsetQuery = offsetQuery.where('type', '==', type);
        }
        if (startDate) {
          const start = startDate instanceof Date ? startDate : new Date(startDate);
          offsetQuery = offsetQuery.where('createdAt', '>=', start);
        }
        if (endDate) {
          const end = endDate instanceof Date ? endDate : new Date(endDate);
          offsetQuery = offsetQuery.where('createdAt', '<=', end);
        }
        
        if (sortBy === 'amount' && !type && !startDate && !endDate) {
          offsetQuery = offsetQuery.orderBy('pointsAmount', sortOrder);
        } else {
          offsetQuery = offsetQuery.orderBy('createdAt', sortOrder);
        }
        
        offsetQuery = offsetQuery.limit(offset);
        
        const offsetSnapshot = await offsetQuery.get();
        
        if (offsetSnapshot.empty || offsetSnapshot.docs.length < offset) {
          // Not enough documents for offset, return empty
          return {
            success: true,
            transactions: [],
            total: 0,
            pagination: {
              limit: limit,
              offset: offset,
              total: 0,
              hasMore: false
            }
          };
        }
        
        // Get the last document from offset query as cursor
        const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
        query = query.startAfter(lastDoc);
      }

      // ✅ CRITICAL FIX: Get total count efficiently (only if needed and not cached)
      // For large datasets, consider using a separate counter collection
      let totalCount = 0;
      if (filters.includeTotal !== false) {
        // ✅ OPTIMIZATION: Cache total count for 5 minutes to avoid expensive count queries
        try {
          const cachingService = require('./cachingService');
          const countCacheKey = `wallet:transactions:count:${driverId}`;
          const cachedCount = await cachingService.get(countCacheKey, 'memory');
          
          if (cachedCount !== null) {
            totalCount = cachedCount;
            console.log(`✅ [WALLET_SERVICE] Using cached transaction count: ${totalCount}`);
          } else {
            // Only fetch count if not cached (expensive operation)
      const totalSnapshot = await this.db.collection('pointsTransactions')
        .where('driverId', '==', driverId)
        .get();
            totalCount = totalSnapshot.size;

            // Cache the count for 5 minutes
            await cachingService.set(countCacheKey, totalCount, 300, 'memory');
          }
        } catch (cacheError) {
          // Fallback: fetch count if cache fails
          console.warn('⚠️ [WALLET_SERVICE] Cache check failed, fetching count:', cacheError.message);
          const totalSnapshot = await this.db.collection('pointsTransactions')
            .where('driverId', '==', driverId)
            .get();
          totalCount = totalSnapshot.size;
        }
      }

      // Execute the paginated query
      const snapshot = await query.get();
      const paginatedDocs = snapshot.docs;

      const transactions = paginatedDocs.map(doc => {
        const data = doc.data();
        // ✅ CRITICAL FIX: Map backend transaction format to frontend format
        const tripDetails = data.tripDetails || {};
        const bookingId = data.tripId || tripDetails.bookingId || 'N/A';
        const distance = data.distanceKm || tripDetails.distance || 0;
        
        // Generate description based on transaction type (money format only)
        let description = '';
        const commissionAmount = Math.abs(data.pointsAmount || 0);
        const roundedDistance = Math.ceil(distance);
        
        if (data.type === 'debit') {
          if (tripDetails.bookingId || data.tripId) {
            // Commission deduction with breakdown
            description = `Commission: ₹${commissionAmount} (${roundedDistance}km × ₹2/km)`;
          } else {
            description = `Commission: ₹${commissionAmount}`;
          }
        } else if (data.type === 'credit') {
          // Money added (top-up)
          description = `Money Added: ₹${commissionAmount}`;
        } else {
          description = 'Transaction';
        }
        
        return {
          id: data.id || doc.id,
          driverId: data.driverId,
          type: data.type || (data.pointsAmount > 0 ? 'credit' : 'debit'),
          amount: data.type === 'debit' ? -Math.abs(data.pointsAmount || 0) : Math.abs(data.pointsAmount || 0), // Negative for debit, positive for credit
          previousBalance: data.previousBalance || 0,
          newBalance: data.newBalance || 0,
          paymentMethod: tripDetails.paymentMethod || data.paymentMethod || 'points',
          status: data.status || 'completed',
          metadata: {
            tripId: data.tripId,
            distanceKm: distance,
            bookingId: bookingId,
            ...tripDetails
          },
          createdAt: (() => {
            try {
              if (data.createdAt?.toDate) return data.createdAt.toDate().toISOString();
              if (data.createdAt?.toISOString) return data.createdAt.toISOString();
              if (data.createdAt) return new Date(data.createdAt).toISOString();
              return new Date().toISOString();
            } catch {
              return new Date().toISOString();
            }
          })(),
          description: description
        };
      });

      return {
        success: true,
        transactions,
        total: totalCount,
        pagination: {
          limit: limit,
          offset: offset,
          total: totalCount,
          hasMore: (offset + limit) < totalCount
        }
      };
    } catch (error) {
      console.error('Error getting transaction history:', error);
      return {
        success: false,
        error: 'Failed to get transaction history',
        details: error.message
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
      const canWork = walletData.status !== 'suspended';

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
// Use lazy initialization to avoid Firebase initialization issues
let pointsServiceInstance = null;

function getPointsService() {
  if (!pointsServiceInstance) {
    pointsServiceInstance = new PointsService();
  }
  return pointsServiceInstance;
}

// Export a proxy object that creates the instance only when methods are called
const lazyPointsService = new Proxy({}, {
  get(target, prop) {
    const instance = getPointsService();
    return instance[prop];
  }
});

module.exports = lazyPointsService;
module.exports.PointsService = PointsService;
module.exports.getPointsService = getPointsService;