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
      } catch (error) {
        console.error('❌ [REVENUE_SERVICE] Failed to get Firestore:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using RevenueService.');
      }
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
      console.error('Error getting revenue stats:', error);
      return {
        success: false,
        error: 'Failed to get revenue statistics',
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
