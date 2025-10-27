const { getFirestore } = require('./firebase');

/**
 * Revenue Service for EPickup Platform
 * Calculates platform revenue based on prepaid points system
 * Real money from top-ups + Commission from points (₹2 per km)
 */
class RevenueService {
  constructor() {
    this.COMMISSION_PER_KM = 2; // ₹2 per km commission (in points)
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
        console.error('❌ [RevenueService] Failed to get Firestore:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using RevenueService.');
      }
    }
    return this.db;
  }

  /**
   * Calculate total platform revenue from real money top-ups and points commission
   * @param {Date} startDate - Start date for calculation
   * @param {Date} endDate - End date for calculation
   * @returns {Promise<Object>} Revenue breakdown
   */
  async calculateRevenue(startDate, endDate) {
    try {
      console.log(`💰 Calculating revenue from ${startDate.toISOString()} to ${endDate.toISOString()}`);

      // Get database instance
      const db = this.getDb();

      // Get real money from top-ups (primary revenue source)
      const topUpsSnapshot = await db
        .collection('driverTopUps')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .where('status', '==', 'completed')
        .get();

      let totalRealMoney = 0;
      let totalTopUps = 0;
      const topUpsBreakdown = [];

      topUpsSnapshot.forEach(doc => {
        const data = doc.data();
        totalRealMoney += data.realMoneyAmount || 0;
        totalTopUps += 1;
        
        topUpsBreakdown.push({
          id: doc.id,
          driverId: data.driverId,
          realMoneyAmount: data.realMoneyAmount,
          pointsAwarded: data.pointsAwarded,
          paymentMethod: data.paymentMethod,
          createdAt: data.createdAt?.toDate?.() || data.createdAt
        });
      });

      // ✅ CORE FIX: Get actual payments from payments collection
      // Simplified query to avoid requiring composite index:
      // 1. Query by confirmedAt range (only one field range query)
      // 2. Filter by status in memory
      let totalPayments = 0;
      let totalPaymentAmount = 0;
      const paymentsBreakdown = [];

      try {
        // Query by date range only (no composite index needed)
        const paymentsSnapshot = await db
          .collection('payments')
          .where('confirmedAt', '>=', startDate)
          .where('confirmedAt', '<=', endDate)
          .get();

        // Filter by status in memory
        paymentsSnapshot.forEach(doc => {
          const data = doc.data();
          
          // Only include confirmed payments
          if (data.status === 'confirmed') {
            totalPaymentAmount += data.amount || 0;
            totalPayments += 1;
            
            paymentsBreakdown.push({
              id: doc.id,
              transactionId: data.transactionId,
              bookingId: data.bookingId,
              driverId: data.driverId,
              customerId: data.customerId,
              amount: data.amount,
              paymentMethod: data.paymentMethod,
              confirmedAt: data.confirmedAt?.toDate?.() || data.confirmedAt
            });
          }
        });

        console.log(`💰 [REVENUE] Found ${totalPayments} confirmed payments totaling ₹${totalPaymentAmount}`);
      } catch (error) {
        console.error('❌ [REVENUE] Error fetching payments:', error.message);
        // Continue with empty payment data (revenue will still work)
      }

      // Get points commission transactions (secondary revenue tracking)
      const pointsCommissionSnapshot = await db
        .collection('pointsTransactions')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .where('type', '==', 'debit')
        .get();

      let totalPointsCommission = 0;
      let totalDistance = 0;
      let totalTrips = 0;
      const commissionBreakdown = [];

      pointsCommissionSnapshot.forEach(doc => {
        const data = doc.data();
        
        // Filter for commission transactions in memory (since Firestore doesn't support 'like' operator)
        if (data.description && data.description.toLowerCase().includes('commission')) {
          totalPointsCommission += data.amount || 0;
          totalDistance += data.distanceKm || 0;
          totalTrips += 1;
          
          commissionBreakdown.push({
            id: doc.id,
            driverId: data.driverId,
            tripId: data.tripId,
            distanceKm: data.distanceKm,
            pointsDeducted: data.amount,
            createdAt: data.createdAt?.toDate?.() || data.createdAt
          });
        }
      });

      // Calculate daily revenue breakdown
      const dailyRevenue = this.calculateDailyRevenue(topUpsBreakdown, startDate, endDate);

      // Calculate monthly revenue (if period spans multiple months)
      const monthlyRevenue = this.calculateMonthlyRevenue(topUpsBreakdown, startDate, endDate);

      const revenue = {
        // Real money revenue (primary)
        totalRealMoney: totalRealMoney + totalPaymentAmount, // ✅ CRITICAL FIX: Include payments in total
        totalTopUps: totalTopUps,
        averageTopUpAmount: totalTopUps > 0 ? (totalRealMoney / totalTopUps).toFixed(2) : 0,
        
        // ✅ CRITICAL FIX: Add payments data
        totalPayments: totalPayments,
        totalPaymentAmount: totalPaymentAmount,
        averagePaymentAmount: totalPayments > 0 ? (totalPaymentAmount / totalPayments).toFixed(2) : 0,
        
        // Points commission tracking (secondary)
        totalPointsCommission: totalPointsCommission,
        totalDistance: totalDistance,
        totalTrips: totalTrips,
        averageCommissionPerTrip: totalTrips > 0 ? (totalPointsCommission / totalTrips).toFixed(2) : 0,
        averageCommissionPerKm: totalDistance > 0 ? (totalPointsCommission / totalDistance).toFixed(2) : 0,
        
        // Breakdown data
        topUpsBreakdown: topUpsBreakdown,
        paymentsBreakdown: paymentsBreakdown, // ✅ CRITICAL FIX: Include payments breakdown
        commissionBreakdown: commissionBreakdown,
        dailyRevenue: dailyRevenue,
        monthlyRevenue: monthlyRevenue,
        
        // Period info
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          days: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
        },
        calculatedAt: new Date().toISOString()
      };

      console.log(`✅ Revenue calculated: ₹${totalRealMoney + totalPaymentAmount} total (₹${totalRealMoney} top-ups + ₹${totalPaymentAmount} payments), ${totalPointsCommission} points commission from ${totalTrips} trips`);
      return revenue;

    } catch (error) {
      console.error('❌ Error calculating revenue:', error);
      throw new Error('Failed to calculate revenue');
    }
  }

  /**
   * Calculate daily revenue breakdown
   * @param {Array} commissionBreakdown - Commission transactions
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Array} Daily revenue data
   */
  calculateDailyRevenue(topUpsBreakdown, startDate, endDate) {
    const dailyRevenue = {};
    
    topUpsBreakdown.forEach(transaction => {
      const date = transaction.createdAt.toISOString().split('T')[0];
      if (!dailyRevenue[date]) {
        dailyRevenue[date] = {
          date: date,
          realMoney: 0,
          topUps: 0,
          pointsAwarded: 0
        };
      }
      dailyRevenue[date].realMoney += transaction.realMoneyAmount || 0;
      dailyRevenue[date].topUps += 1;
      dailyRevenue[date].pointsAwarded += transaction.pointsAwarded || 0;
    });

    // Fill in missing days with zero revenue
    const result = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      result.push(dailyRevenue[dateStr] || {
        date: dateStr,
        commission: 0,
        trips: 0,
        distance: 0
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  }

  /**
   * Calculate monthly revenue breakdown
   * @param {Array} topUpsBreakdown - Top-up transactions
   * @param {Date} startDate - Start date (reserved for future filtering)
   * @param {Date} endDate - End date (reserved for future filtering)
   * @returns {Array} Monthly revenue data
   */
  // eslint-disable-next-line no-unused-vars
  calculateMonthlyRevenue(topUpsBreakdown, startDate, endDate) {
    // Note: startDate and endDate parameters reserved for future date filtering logic
    const monthlyRevenue = {};
    
    topUpsBreakdown.forEach(transaction => {
      const month = transaction.createdAt.toISOString().substring(0, 7); // YYYY-MM
      if (!monthlyRevenue[month]) {
        monthlyRevenue[month] = {
          month: month,
          realMoney: 0,
          topUps: 0,
          pointsAwarded: 0
        };
      }
      monthlyRevenue[month].realMoney += transaction.realMoneyAmount || 0;
      monthlyRevenue[month].topUps += 1;
      monthlyRevenue[month].pointsAwarded += transaction.pointsAwarded || 0;
    });

    return Object.values(monthlyRevenue);
  }

  /**
   * Get current month revenue
   * @returns {Promise<Object>} Current month revenue
   */
  async getCurrentMonthRevenue() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    
    return await this.calculateRevenue(startOfMonth, endOfMonth);
  }

  /**
   * Get today's revenue
   * @returns {Promise<Object>} Today's revenue
   */
  async getTodayRevenue() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    
    return await this.calculateRevenue(startOfDay, endOfDay);
  }

  /**
   * Get revenue summary for dashboard
   * @returns {Promise<Object>} Revenue summary
   */
  async getRevenueSummary() {
    try {
      const [todayRevenue, currentMonthRevenue] = await Promise.all([
        this.getTodayRevenue(),
        this.getCurrentMonthRevenue()
      ]);

      return {
        today: {
          // 🔥 FIX: Use totalRealMoney instead of non-existent totalCommission
          total: todayRevenue.totalRealMoney || 0,
          realMoney: todayRevenue.totalRealMoney || 0,
          topUps: todayRevenue.totalTopUps || 0,
          commission: todayRevenue.totalPointsCommission || 0, // Virtual commission tracking
          trips: todayRevenue.totalTrips || 0,
          distance: todayRevenue.totalDistance || 0
        },
        thisMonth: {
          // 🔥 FIX: Use totalRealMoney instead of non-existent totalCommission
          total: currentMonthRevenue.totalRealMoney || 0,
          realMoney: currentMonthRevenue.totalRealMoney || 0,
          topUps: currentMonthRevenue.totalTopUps || 0,
          commission: currentMonthRevenue.totalPointsCommission || 0, // Virtual commission tracking
          trips: currentMonthRevenue.totalTrips || 0,
          distance: currentMonthRevenue.totalDistance || 0
        },
        summary: {
          // 🔥 FIX: Use totalRealMoney for calculations
          averageDailyRevenue: currentMonthRevenue.dailyRevenue.length > 0 
            ? (currentMonthRevenue.totalRealMoney / currentMonthRevenue.dailyRevenue.length).toFixed(2)
            : 0,
          averageTopUpAmount: currentMonthRevenue.averageTopUpAmount || 0,
          averageCommissionPerTrip: currentMonthRevenue.averageCommissionPerTrip || 0,
          averageCommissionPerKm: currentMonthRevenue.averageCommissionPerKm || 0
        },
        calculatedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Error getting revenue summary:', error);
      throw new Error('Failed to get revenue summary');
    }
  }

  /**
   * Get real money revenue summary (from top-ups)
   * @returns {Promise<Object>} Real money revenue summary
   */
  async getRealMoneyRevenueSummary() {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      
      // Get database instance
      const db = this.getDb();
      
      // Get all top-ups for current month
      const topUpsSnapshot = await db
        .collection('companyRevenue')
        .where('createdAt', '>=', startOfMonth)
        .where('createdAt', '<=', endOfMonth)
        .where('source', '==', 'driver_topup')
        .get();

      let totalRealMoney = 0;
      let totalTopUps = 0;
      const topUpsByDriver = {};
      const topUpsByPaymentMethod = {};

      topUpsSnapshot.forEach(doc => {
        const data = doc.data();
        totalRealMoney += data.amount || 0;
        totalTopUps += 1;
        
        // Group by driver
        const driverId = data.driverId;
        if (!topUpsByDriver[driverId]) {
          topUpsByDriver[driverId] = {
            driverId: driverId,
            totalAmount: 0,
            topUpCount: 0
          };
        }
        topUpsByDriver[driverId].totalAmount += data.amount || 0;
        topUpsByDriver[driverId].topUpCount += 1;
        
        // Group by payment method
        const paymentMethod = data.paymentMethod || 'unknown';
        if (!topUpsByPaymentMethod[paymentMethod]) {
          topUpsByPaymentMethod[paymentMethod] = {
            method: paymentMethod,
            totalAmount: 0,
            topUpCount: 0
          };
        }
        topUpsByPaymentMethod[paymentMethod].totalAmount += data.amount || 0;
        topUpsByPaymentMethod[paymentMethod].topUpCount += 1;
      });

      return {
        totalRealMoney: totalRealMoney,
        totalTopUps: totalTopUps,
        averageTopUpAmount: totalTopUps > 0 ? (totalRealMoney / totalTopUps).toFixed(2) : 0,
        topUpsByDriver: Object.values(topUpsByDriver),
        topUpsByPaymentMethod: Object.values(topUpsByPaymentMethod),
        period: {
          start: startOfMonth.toISOString(),
          end: endOfMonth.toISOString(),
          month: now.getMonth() + 1,
          year: now.getFullYear()
        },
        calculatedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Error getting real money revenue summary:', error);
      throw new Error('Failed to get real money revenue summary');
    }
  }

  /**
   * Get revenue trends (last 30 days)
   * @returns {Promise<Object>} Revenue trends
   */
  async getRevenueTrends() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 30);

    return await this.calculateRevenue(startDate, endDate);
  }
}

module.exports = new RevenueService();
