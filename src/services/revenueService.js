const { getFirestore } = require('./firebase');

/**
 * Revenue Service for EPickup Platform
 * Calculates platform revenue based on commission system
 * Commission: ₹1 per km from driver wallet
 */
class RevenueService {
  constructor() {
    this.COMMISSION_PER_KM = 1; // ₹1 per km commission
    this.db = getFirestore();
  }

  /**
   * Calculate total platform revenue from commission transactions
   * @param {Date} startDate - Start date for calculation
   * @param {Date} endDate - End date for calculation
   * @returns {Promise<Object>} Revenue breakdown
   */
  async calculateRevenue(startDate, endDate) {
    try {
      console.log(`💰 Calculating revenue from ${startDate.toISOString()} to ${endDate.toISOString()}`);

      // Get commission transactions from the period
      const commissionSnapshot = await this.db
        .collection('commissionTransactions')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .where('status', '==', 'completed')
        .get();

      let totalCommission = 0;
      let totalDistance = 0;
      let totalTrips = 0;
      const commissionBreakdown = [];

      commissionSnapshot.forEach(doc => {
        const data = doc.data();
        totalCommission += data.commissionAmount || 0;
        totalDistance += data.distanceKm || 0;
        totalTrips += 1;
        
        commissionBreakdown.push({
          id: doc.id,
          driverId: data.driverId,
          tripId: data.tripId,
          distanceKm: data.distanceKm,
          commissionAmount: data.commissionAmount,
          createdAt: data.createdAt?.toDate?.() || data.createdAt
        });
      });

      // Calculate daily revenue breakdown
      const dailyRevenue = this.calculateDailyRevenue(commissionBreakdown, startDate, endDate);

      // Calculate monthly revenue (if period spans multiple months)
      const monthlyRevenue = this.calculateMonthlyRevenue(commissionBreakdown, startDate, endDate);

      const revenue = {
        totalCommission: totalCommission,
        totalDistance: totalDistance,
        totalTrips: totalTrips,
        averageCommissionPerTrip: totalTrips > 0 ? (totalCommission / totalTrips).toFixed(2) : 0,
        averageCommissionPerKm: totalDistance > 0 ? (totalCommission / totalDistance).toFixed(2) : 0,
        dailyRevenue: dailyRevenue,
        monthlyRevenue: monthlyRevenue,
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          days: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
        },
        calculatedAt: new Date().toISOString()
      };

      console.log(`✅ Revenue calculated: ₹${totalCommission} from ${totalTrips} trips`);
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
  calculateDailyRevenue(commissionBreakdown, startDate, endDate) {
    const dailyRevenue = {};
    
    commissionBreakdown.forEach(transaction => {
      const date = transaction.createdAt.toISOString().split('T')[0];
      if (!dailyRevenue[date]) {
        dailyRevenue[date] = {
          date: date,
          commission: 0,
          trips: 0,
          distance: 0
        };
      }
      dailyRevenue[date].commission += transaction.commissionAmount;
      dailyRevenue[date].trips += 1;
      dailyRevenue[date].distance += transaction.distanceKm;
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
   * @param {Array} commissionBreakdown - Commission transactions
   * @param {Date} startDate - Start date (reserved for future filtering)
   * @param {Date} endDate - End date (reserved for future filtering)
   * @returns {Array} Monthly revenue data
   */
  // eslint-disable-next-line no-unused-vars
  calculateMonthlyRevenue(commissionBreakdown, startDate, endDate) {
    // Note: startDate and endDate parameters reserved for future date filtering logic
    const monthlyRevenue = {};
    
    commissionBreakdown.forEach(transaction => {
      const month = transaction.createdAt.toISOString().substring(0, 7); // YYYY-MM
      if (!monthlyRevenue[month]) {
        monthlyRevenue[month] = {
          month: month,
          commission: 0,
          trips: 0,
          distance: 0
        };
      }
      monthlyRevenue[month].commission += transaction.commissionAmount;
      monthlyRevenue[month].trips += 1;
      monthlyRevenue[month].distance += transaction.distanceKm;
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
          commission: todayRevenue.totalCommission,
          trips: todayRevenue.totalTrips,
          distance: todayRevenue.totalDistance
        },
        thisMonth: {
          commission: currentMonthRevenue.totalCommission,
          trips: currentMonthRevenue.totalTrips,
          distance: currentMonthRevenue.totalDistance
        },
        summary: {
          averageDailyCommission: currentMonthRevenue.dailyRevenue.length > 0 
            ? (currentMonthRevenue.totalCommission / currentMonthRevenue.dailyRevenue.length).toFixed(2)
            : 0,
          averageCommissionPerTrip: currentMonthRevenue.averageCommissionPerTrip,
          averageCommissionPerKm: currentMonthRevenue.averageCommissionPerKm
        },
        calculatedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Error getting revenue summary:', error);
      throw new Error('Failed to get revenue summary');
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
