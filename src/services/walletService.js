const DriverWallet = require('../models/DriverWallet');
const CommissionTransaction = require('../models/CommissionTransaction');
const RechargeTransaction = require('../models/RechargeTransaction');
const { v4: uuidv4 } = require('uuid');

class WalletService {
  /**
   * Create or get driver wallet
   * @param {string} driverId - Driver ID
   * @param {number} initialCredit - Initial credit amount (default: 500)
   * @returns {Promise<Object>} Wallet details
   */
  async createOrGetWallet(driverId, initialCredit = 500) {
    try {
      let wallet = await DriverWallet.findOne({ driverId });
      
      if (!wallet) {
        wallet = new DriverWallet({
          driverId,
          initialCredit,
          currentBalance: initialCredit
        });
        await wallet.save();
      }
      
      return {
        success: true,
        wallet: {
          driverId: wallet.driverId,
          initialCredit: wallet.initialCredit,
          commissionUsed: wallet.commissionUsed,
          recharges: wallet.recharges,
          currentBalance: wallet.currentBalance,
          status: wallet.status,
          canWork: wallet.canWork,
          isLowBalance: wallet.isLowBalance,
          remainingTrips: wallet.remainingTrips
        }
      };
    } catch (error) {
      console.error('Error creating/getting wallet:', error);
      return {
        success: false,
        error: 'Failed to create or get wallet'
      };
    }
  }

  /**
   * Get wallet balance and details
   * @param {string} driverId - Driver ID
   * @returns {Promise<Object>} Wallet details
   */
  async getWalletBalance(driverId) {
    try {
      const wallet = await DriverWallet.findOne({ driverId });
      
      if (!wallet) {
        return {
          success: false,
          error: 'Wallet not found'
        };
      }
      
      return {
        success: true,
        wallet: {
          driverId: wallet.driverId,
          initialCredit: wallet.initialCredit,
          commissionUsed: wallet.commissionUsed,
          recharges: wallet.recharges,
          currentBalance: wallet.currentBalance,
          status: wallet.status,
          canWork: wallet.canWork,
          isLowBalance: wallet.isLowBalance,
          remainingTrips: wallet.remainingTrips,
          lastRechargeDate: wallet.lastRechargeDate,
          lastCommissionDeduction: wallet.lastCommissionDeduction
        }
      };
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      return {
        success: false,
        error: 'Failed to get wallet balance'
      };
    }
  }

  /**
   * Deduct commission from wallet
   * @param {string} driverId - Driver ID
   * @param {string} tripId - Trip ID
   * @param {number} distanceKm - Distance in kilometers
   * @param {number} commissionAmount - Commission amount to deduct
   * @param {Object} tripDetails - Trip details for transaction record
   * @returns {Promise<Object>} Deduction result
   */
  async deductCommission(driverId, tripId, distanceKm, commissionAmount, tripDetails = {}) {
    try {
      const wallet = await DriverWallet.findOne({ driverId });
      
      if (!wallet) {
        return {
          success: false,
          error: 'Wallet not found'
        };
      }
      
      if (wallet.status !== 'active') {
        return {
          success: false,
          error: 'Wallet is not active'
        };
      }
      
      if (wallet.currentBalance < commissionAmount) {
        return {
          success: false,
          error: 'Insufficient balance',
          required: commissionAmount,
          available: wallet.currentBalance
        };
      }
      
      const walletBalanceBefore = wallet.currentBalance;
      
      // Update wallet
      wallet.commissionUsed += commissionAmount;
      wallet.lastCommissionDeduction = new Date();
      await wallet.save();
      
      // Create commission transaction record
      const commissionTransaction = new CommissionTransaction({
        driverId,
        tripId,
        distanceKm,
        commissionAmount,
        walletBalanceBefore,
        walletBalanceAfter: wallet.currentBalance,
        pickupLocation: tripDetails.pickupLocation || {},
        dropoffLocation: tripDetails.dropoffLocation || {},
        tripFare: tripDetails.tripFare || 0,
        status: 'completed'
      });
      await commissionTransaction.save();
      
      return {
        success: true,
        commissionDeducted: commissionAmount,
        newBalance: wallet.currentBalance,
        transactionId: commissionTransaction._id,
        canWork: wallet.canWork,
        isLowBalance: wallet.isLowBalance,
        remainingTrips: wallet.remainingTrips
      };
    } catch (error) {
      console.error('Error deducting commission:', error);
      return {
        success: false,
        error: 'Failed to deduct commission'
      };
    }
  }

  /**
   * Process wallet recharge
   * @param {string} driverId - Driver ID
   * @param {number} amount - Recharge amount
   * @param {string} paymentMethod - Payment method
   * @param {Object} paymentDetails - Payment gateway details
   * @returns {Promise<Object>} Recharge result
   */
  async processRecharge(driverId, amount, paymentMethod, paymentDetails = {}) {
    try {
      const wallet = await DriverWallet.findOne({ driverId });
      
      if (!wallet) {
        return {
          success: false,
          error: 'Wallet not found'
        };
      }
      
      if (wallet.status !== 'active') {
        return {
          success: false,
          error: 'Wallet is not active'
        };
      }
      
      const walletBalanceBefore = wallet.currentBalance;
      const transactionId = uuidv4();
      
      // Create recharge transaction
      const rechargeTransaction = new RechargeTransaction({
        driverId,
        amount,
        paymentMethod,
        paymentGateway: paymentDetails.gateway || 'razorpay',
        transactionId,
        gatewayTransactionId: paymentDetails.gatewayTransactionId,
        status: 'pending',
        walletBalanceBefore,
        walletBalanceAfter: walletBalanceBefore + amount
      });
      await rechargeTransaction.save();
      
      // Update wallet
      wallet.recharges += amount;
      wallet.lastRechargeDate = new Date();
      await wallet.save();
      
      return {
        success: true,
        transactionId,
        amount,
        newBalance: wallet.currentBalance,
        canWork: wallet.canWork,
        isLowBalance: wallet.isLowBalance,
        remainingTrips: wallet.remainingTrips
      };
    } catch (error) {
      console.error('Error processing recharge:', error);
      return {
        success: false,
        error: 'Failed to process recharge'
      };
    }
  }

  /**
   * Get transaction history
   * @param {string} driverId - Driver ID
   * @param {number} limit - Number of transactions to return
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Object>} Transaction history
   */
  async getTransactionHistory(driverId, limit = 20, offset = 0) {
    try {
      const [commissionTransactions, rechargeTransactions] = await Promise.all([
        CommissionTransaction.find({ driverId })
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset),
        RechargeTransaction.find({ driverId })
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
      ]);
      
      // Combine and sort transactions
      const allTransactions = [
        ...commissionTransactions.map(t => ({
          ...t.toObject(),
          type: 'commission',
          description: `Commission for trip ${t.tripId}`,
          amount: -t.commissionAmount // Negative for deductions
        })),
        ...rechargeTransactions.map(t => ({
          ...t.toObject(),
          type: 'recharge',
          description: `Wallet recharge via ${t.paymentMethod}`,
          amount: t.amount // Positive for recharges
        }))
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      return {
        success: true,
        transactions: allTransactions.slice(0, limit),
        total: allTransactions.length
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
   * Get wallet statistics
   * @param {string} driverId - Driver ID
   * @returns {Promise<Object>} Wallet statistics
   */
  async getWalletStats(driverId) {
    try {
      const [wallet, commissionStats, rechargeStats] = await Promise.all([
        DriverWallet.findOne({ driverId }),
        CommissionTransaction.aggregate([
          { $match: { driverId } },
          {
            $group: {
              _id: null,
              totalCommission: { $sum: '$commissionAmount' },
              totalTrips: { $sum: 1 },
              totalDistance: { $sum: '$distanceKm' }
            }
          }
        ]),
        RechargeTransaction.aggregate([
          { $match: { driverId, status: 'completed' } },
          {
            $group: {
              _id: null,
              totalRecharged: { $sum: '$amount' },
              totalRecharges: { $sum: 1 }
            }
          }
        ])
      ]);
      
      if (!wallet) {
        return {
          success: false,
          error: 'Wallet not found'
        };
      }
      
      const commissionData = commissionStats[0] || { totalCommission: 0, totalTrips: 0, totalDistance: 0 };
      const rechargeData = rechargeStats[0] || { totalRecharged: 0, totalRecharges: 0 };
      
      return {
        success: true,
        stats: {
          currentBalance: wallet.currentBalance,
          initialCredit: wallet.initialCredit,
          totalCommissionUsed: commissionData.totalCommission,
          totalRecharges: rechargeData.totalRecharged,
          totalTrips: commissionData.totalTrips,
          totalDistance: commissionData.totalDistance,
          averageCommissionPerTrip: commissionData.totalTrips > 0 ? commissionData.totalCommission / commissionData.totalTrips : 0,
          canWork: wallet.canWork,
          isLowBalance: wallet.isLowBalance,
          remainingTrips: wallet.remainingTrips
        }
      };
    } catch (error) {
      console.error('Error getting wallet stats:', error);
      return {
        success: false,
        error: 'Failed to get wallet statistics'
      };
    }
  }

  /**
   * Update wallet status
   * @param {string} driverId - Driver ID
   * @param {string} status - New status
   * @returns {Promise<Object>} Update result
   */
  async updateWalletStatus(driverId, status) {
    try {
      const wallet = await DriverWallet.findOne({ driverId });
      
      if (!wallet) {
        return {
          success: false,
          error: 'Wallet not found'
        };
      }
      
      wallet.status = status;
      await wallet.save();
      
      return {
        success: true,
        status: wallet.status,
        canWork: wallet.canWork
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
   * Check if driver can work
   * @param {string} driverId - Driver ID
   * @returns {Promise<Object>} Work status
   */
  async canDriverWork(driverId) {
    try {
      const wallet = await DriverWallet.findOne({ driverId });
      
      if (!wallet) {
        return {
          success: false,
          canWork: false,
          error: 'Wallet not found'
        };
      }
      
      return {
        success: true,
        canWork: wallet.canWork,
        currentBalance: wallet.currentBalance,
        isLowBalance: wallet.isLowBalance,
        remainingTrips: wallet.remainingTrips,
        status: wallet.status
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
}

module.exports = new WalletService();
