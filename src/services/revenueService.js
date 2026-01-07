const { getFirestore } = require('./firebase');

/**
 * Revenue Service
 * Handles company revenue tracking and analytics
 */
class RevenueService {
  constructor() {
    this.db = null; // Initialize lazily
  }

  /**
   * Get Firestore instance (lazy initialization)
   */
  getDb() {
    if (!this.db) {
      try {
        this.db = getFirestore();
        // Double-check that db is not null
        if (!this.db) {
          throw new Error('Firestore instance is null. Firebase may not be properly initialized.');
        }
      } catch (error) {
        console.error('❌ [REVENUE_SERVICE] Failed to get Firestore:', error);
        this.db = null; // Ensure db is set to null on error
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using RevenueService.');
      }
    }
    // Additional safety check before returning
    if (!this.db) {
      throw new Error('Firestore instance is null. Firebase may not be properly initialized.');
    }
    return this.db;
  }

  /**
   * Get total revenue with optional filters
   * @param {Object} filters - Filter options (startDate, endDate, driverId, paymentMethod)
   * @returns {Promise<Object>} Total revenue result
   */
  async getTotalRevenue(filters = {}) {
    try {
      const db = this.getDb();
      
      // Validate db is not null before using it
      if (!db) {
        console.error('❌ [REVENUE_SERVICE] Firestore instance is null');
        return {
          success: false,
          error: 'Failed to get total revenue',
          details: 'Firebase is not initialized. Please ensure Firebase is properly configured.'
        };
      }
      
      let query = db.collection('companyRevenue');

      // Apply filters
      if (filters.startDate) {
        query = query.where('createdAt', '>=', filters.startDate);
      }
      if (filters.endDate) {
        query = query.where('createdAt', '<=', filters.endDate);
      }
      if (filters.driverId) {
        query = query.where('driverId', '==', filters.driverId);
      }
      if (filters.paymentMethod) {
        query = query.where('paymentMethod', '==', filters.paymentMethod);
      }

      const snapshot = await query.get();
      
      let totalRevenue = 0;
      let transactionCount = 0;
      
      snapshot.forEach(doc => {
        const data = doc.data();
        totalRevenue += data.amount || 0;
        transactionCount++;
      });

      return {
        success: true,
        totalRevenue,
        transactionCount,
        currency: 'INR'
      };
    } catch (error) {
      console.error('Error getting total revenue:', error);
      return {
        success: false,
        error: 'Failed to get total revenue',
        details: error.message
      };
    }
  }

  /**
   * Get revenue by period (daily, weekly, monthly)
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {string} period - Period type ('daily', 'weekly', 'monthly')
   * @returns {Promise<Object>} Revenue by period result
   */
  async getRevenueByPeriod(startDate, endDate, period = 'daily') {
    try {
      const db = this.getDb();
      
      // Validate db is not null before using it
      if (!db) {
        console.error('❌ [REVENUE_SERVICE] Firestore instance is null');
        return {
          success: false,
          error: 'Failed to get revenue by period',
          details: 'Firebase is not initialized. Please ensure Firebase is properly configured.'
        };
      }
      
      const snapshot = await db.collection('companyRevenue')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .orderBy('createdAt', 'asc')
        .get();

      const revenueByPeriod = {};
      
      snapshot.forEach(doc => {
        const data = doc.data();
        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
        let periodKey;

        if (period === 'daily') {
          periodKey = createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
        } else if (period === 'weekly') {
          const weekStart = new Date(createdAt);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)
          periodKey = weekStart.toISOString().split('T')[0];
        } else if (period === 'monthly') {
          periodKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
        }

        if (!revenueByPeriod[periodKey]) {
          revenueByPeriod[periodKey] = {
            period: periodKey,
            revenue: 0,
            transactionCount: 0
          };
        }

        revenueByPeriod[periodKey].revenue += data.amount || 0;
        revenueByPeriod[periodKey].transactionCount++;
      });

      const periods = Object.values(revenueByPeriod).sort((a, b) => a.period.localeCompare(b.period));

      return {
        success: true,
        periods,
        totalRevenue: periods.reduce((sum, p) => sum + p.revenue, 0),
        totalTransactions: periods.reduce((sum, p) => sum + p.transactionCount, 0)
      };
    } catch (error) {
      console.error('Error getting revenue by period:', error);
      return {
        success: false,
        error: 'Failed to get revenue by period',
        details: error.message
      };
    }
  }

  /**
   * Get revenue by driver
   * @param {string} driverId - Driver ID (optional, if not provided returns all drivers)
   * @returns {Promise<Object>} Revenue by driver result
   */
  async getRevenueByDriver(driverId = null) {
    try {
      const db = this.getDb();
      
      // Validate db is not null before using it
      if (!db) {
        console.error('❌ [REVENUE_SERVICE] Firestore instance is null');
        return {
          success: false,
          error: 'Failed to get revenue by driver',
          details: 'Firebase is not initialized. Please ensure Firebase is properly configured.'
        };
      }
      
      let query = db.collection('companyRevenue');

      if (driverId) {
        query = query.where('driverId', '==', driverId);
      }

      const snapshot = await query.get();

      const revenueByDriver = {};
      
      snapshot.forEach(doc => {
        const data = doc.data();
        const driverIdKey = data.driverId || 'unknown';

        if (!revenueByDriver[driverIdKey]) {
          revenueByDriver[driverIdKey] = {
            driverId: driverIdKey,
            revenue: 0,
            transactionCount: 0
          };
        }

        revenueByDriver[driverIdKey].revenue += data.amount || 0;
        revenueByDriver[driverIdKey].transactionCount++;
      });

      const drivers = Object.values(revenueByDriver).sort((a, b) => b.revenue - a.revenue);

      return {
        success: true,
        drivers,
        totalRevenue: drivers.reduce((sum, d) => sum + d.revenue, 0),
        totalTransactions: drivers.reduce((sum, d) => sum + d.transactionCount, 0)
      };
    } catch (error) {
      console.error('Error getting revenue by driver:', error);
      return {
        success: false,
        error: 'Failed to get revenue by driver',
        details: error.message
      };
    }
  }

  /**
   * Get revenue statistics
   * @returns {Promise<Object>} Revenue statistics
   */
  async getRevenueStats() {
    try {
      const db = this.getDb();
      
      // Validate db is not null before using it
      if (!db) {
        console.error('❌ [REVENUE_SERVICE] Firestore instance is null');
        return {
          success: false,
          error: 'Failed to get revenue statistics',
          details: 'Firebase is not initialized. Please ensure Firebase is properly configured.'
        };
      }
      
      const snapshot = await db.collection('companyRevenue').get();

      let totalRevenue = 0;
      let transactionCount = 0;
      const revenueByPaymentMethod = {};
      const revenueByMonth = {};
      const today = new Date();
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      let thisMonthRevenue = 0;
      let lastMonthRevenue = 0;

      snapshot.forEach(doc => {
        const data = doc.data();
        const amount = data.amount || 0;
        totalRevenue += amount;
        transactionCount++;

        // Revenue by payment method
        const paymentMethod = data.paymentMethod || 'unknown';
        if (!revenueByPaymentMethod[paymentMethod]) {
          revenueByPaymentMethod[paymentMethod] = 0;
        }
        revenueByPaymentMethod[paymentMethod] += amount;

        // Revenue by month
        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
        const monthKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
        if (!revenueByMonth[monthKey]) {
          revenueByMonth[monthKey] = 0;
        }
        revenueByMonth[monthKey] += amount;

        // This month vs last month
        if (createdAt >= thisMonth) {
          thisMonthRevenue += amount;
        }
        if (createdAt >= lastMonth && createdAt < thisMonth) {
          lastMonthRevenue += amount;
        }
      });

      const monthOverMonthGrowth = lastMonthRevenue > 0 
        ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 
        : 0;

      return {
        success: true,
        stats: {
          totalRevenue,
          transactionCount,
          averageTransactionValue: transactionCount > 0 ? totalRevenue / transactionCount : 0,
          revenueByPaymentMethod: Object.entries(revenueByPaymentMethod).map(([method, revenue]) => ({
            paymentMethod: method,
            revenue,
            percentage: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0
          })),
          revenueByMonth: Object.entries(revenueByMonth)
            .map(([month, revenue]) => ({ month, revenue }))
            .sort((a, b) => a.month.localeCompare(b.month)),
          thisMonthRevenue,
          lastMonthRevenue,
          monthOverMonthGrowth
        }
      };
    } catch (error) {
      console.error('❌ [REVENUE_SERVICE] Error getting revenue stats:', error);
      console.error('❌ [REVENUE_SERVICE] Error stack:', error.stack);
      
      // Check if it's a Firebase initialization error
      if (error.message && error.message.includes('Firebase') || error.message.includes('Firestore')) {
        return {
          success: false,
          error: 'Failed to get revenue statistics',
          details: 'Firebase is not initialized. Please ensure Firebase is properly configured.',
          firebaseError: true
        };
      }
      
      return {
        success: false,
        error: 'Failed to get revenue statistics',
        details: error.message || 'Unknown error occurred'
      };
    }
  }

  /**
   * Get revenue summary (general overview)
   * @returns {Promise<Object>} Revenue summary
   */
  async getRevenueSummary() {
    try {
      const stats = await this.getRevenueStats();
      if (!stats.success) {
        return stats;
      }

      return {
        success: true,
        ...stats.stats
      };
    } catch (error) {
      console.error('Error getting revenue summary:', error);
      return {
        success: false,
        error: 'Failed to get revenue summary',
        details: error.message
      };
    }
  }

  /**
   * Calculate revenue for a date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Revenue calculation result
   */
  async calculateRevenue(startDate, endDate) {
    try {
      const result = await this.getTotalRevenue({
        startDate,
        endDate
      });
      return result;
    } catch (error) {
      console.error('Error calculating revenue:', error);
      return {
        success: false,
        error: 'Failed to calculate revenue',
        details: error.message
      };
    }
  }

  /**
   * Get real money revenue summary (from wallet top-ups)
   * @returns {Promise<Object>} Real money revenue summary
   */
  async getRealMoneyRevenueSummary() {
    try {
      const db = this.getDb();
      
      // Validate db is not null before using it
      if (!db) {
        console.error('❌ [REVENUE_SERVICE] Firestore instance is null');
        return {
          success: false,
          totalRealMoney: 0,
          totalTopUps: 0,
          totalDriverEarnings: 0,
          error: 'Failed to get real money revenue summary',
          details: 'Firebase is not initialized. Please ensure Firebase is properly configured.'
        };
      }
      
      // Get wallet top-ups (driverTopUps collection)
      const topUpsSnapshot = await db.collection('driverTopUps')
        .where('status', '==', 'completed')
        .get();

      let totalRealMoney = 0;
      let totalTopUps = 0;

      topUpsSnapshot.forEach(doc => {
        const data = doc.data();
        const amount = data.realMoneyAmount || data.amount || 0;
        totalRealMoney += amount;
        totalTopUps++;
      });

      // Get driver earnings (from bookings)
      const bookingsSnapshot = await db.collection('bookings')
        .where('status', '==', 'completed')
        .where('paymentStatus', '==', 'PAID')
        .get();

      let totalDriverEarnings = 0;
      bookingsSnapshot.forEach(doc => {
        const data = doc.data();
        const earnings = data.driverEarnings || data.fare?.driverEarnings || 0;
        totalDriverEarnings += earnings;
      });

      return {
        success: true,
        totalRealMoney,
        totalTopUps,
        totalDriverEarnings,
        currency: 'INR'
      };
    } catch (error) {
      console.error('Error getting real money revenue summary:', error);
      return {
        success: false,
        totalRealMoney: 0,
        totalTopUps: 0,
        totalDriverEarnings: 0,
        error: 'Failed to get real money revenue summary',
        details: error.message
      };
    }
  }
}

// Export singleton instance
let revenueServiceInstance = null;

function getRevenueService() {
  if (!revenueServiceInstance) {
    revenueServiceInstance = new RevenueService();
  }
  return revenueServiceInstance;
}

// Export a proxy object that creates the instance only when methods are called
const lazyRevenueService = new Proxy({}, {
  get(target, prop) {
    const instance = getRevenueService();
    return instance[prop];
  }
});

module.exports = lazyRevenueService;
module.exports.RevenueService = RevenueService;
module.exports.getRevenueService = getRevenueService;
