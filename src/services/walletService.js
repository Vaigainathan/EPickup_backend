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
        wallet = await DriverWallet.create({
          
          driverId,
          initialCredit,
          currentBalance: initialCredit
        });
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
          canWork: wallet.canWork(),
          isLowBalance: wallet.isLowBalance(),
          remainingTrips: wallet.getRemainingTrips()
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
          canWork: wallet.canWork(),
          isLowBalance: wallet.isLowBalance(),
          remainingTrips: wallet.getRemainingTrips(),
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
      const commissionTransaction = await CommissionTransaction.create({
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
      
      return {
        success: true,
        commissionDeducted: commissionAmount,
        newBalance: wallet.currentBalance,
        transactionId: commissionTransaction.id,
        canWork: wallet.canWork(),
        isLowBalance: wallet.isLowBalance(),
        remainingTrips: wallet.getRemainingTrips()
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
      const rechargeTransaction = await RechargeTransaction.create({
        driverId,
        amount,
        paymentMethod,
        paymentGateway: paymentDetails.gateway || 'phonepe',
        transactionId,
        gatewayTransactionId: paymentDetails.gatewayTransactionId || null,
        status: 'pending',
        walletBalanceBefore,
        walletBalanceAfter: walletBalanceBefore,
        receiptUrl: paymentDetails.receiptUrl || null,
        notes: paymentDetails.notes || ''
      });
      
      return {
        success: true,
        transactionId: rechargeTransaction.id,
        rechargeTransaction: rechargeTransaction.toObject()
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
   * Complete recharge transaction
   * @param {string} transactionId - Transaction ID
   * @param {string} status - Transaction status
   * @param {Object} paymentDetails - Updated payment details
   * @returns {Promise<Object>} Completion result
   */
  async completeRecharge(transactionId, status, paymentDetails = {}) {
    try {
      const rechargeTransaction = await RechargeTransaction.findOne({ transactionId });
      
      if (!rechargeTransaction) {
        return {
          success: false,
          error: 'Recharge transaction not found'
        };
      }
      
      const wallet = await DriverWallet.findOne({ driverId: rechargeTransaction.driverId });
      
      if (!wallet) {
        return {
          success: false,
          error: 'Wallet not found'
        };
      }
      
      // Update transaction
      rechargeTransaction.status = status;
      rechargeTransaction.gatewayTransactionId = paymentDetails.gatewayTransactionId || rechargeTransaction.gatewayTransactionId;
      rechargeTransaction.failureReason = paymentDetails.failureReason || null;
      rechargeTransaction.receiptUrl = paymentDetails.receiptUrl || rechargeTransaction.receiptUrl;
      
      if (status === 'completed') {
        // Update wallet
        wallet.recharges += rechargeTransaction.amount;
        wallet.lastRechargeDate = new Date();
        rechargeTransaction.walletBalanceAfter = wallet.currentBalance;
        await wallet.save();
      }
      
      await rechargeTransaction.save();
      
      return {
        success: true,
        transaction: rechargeTransaction.toObject(),
        wallet: wallet.toObject()
      };
    } catch (error) {
      console.error('Error completing recharge:', error);
      return {
        success: false,
        error: 'Failed to complete recharge'
      };
    }
  }

  /**
   * Get transaction history
   * @param {string} driverId - Driver ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} Transaction history
   */
  async getTransactionHistory(driverId, filters = {}) {
    try {
      const { type = 'all', limit = 50, offset = 0 } = filters;
      
      let commissionTransactions = [];
      let rechargeTransactions = [];
      
      if (type === 'all' || type === 'commission') {
        commissionTransactions = await CommissionTransaction.find(
          { driverId },
          { createdAt: -1 }
        );
      }
      
      if (type === 'all' || type === 'recharge') {
        rechargeTransactions = await RechargeTransaction.find(
          { driverId },
          { createdAt: -1 }
        );
      }
      
      // Combine and sort transactions
      const allTransactions = [
        ...commissionTransactions.map(t => ({ ...t.toObject(), type: 'commission' })),
        ...rechargeTransactions.map(t => ({ ...t.toObject(), type: 'recharge' }))
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      // Apply pagination
      const paginatedTransactions = allTransactions.slice(offset, offset + limit);
      
      return {
        success: true,
        transactions: paginatedTransactions,
        total: allTransactions.length,
        hasMore: offset + limit < allTransactions.length
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
        wallet: wallet.toObject()
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
   * @returns {Promise<Object>} Wallet statistics
   */
  async getWalletStatistics(driverId) {
    try {
      const wallet = await DriverWallet.findOne({ driverId });
      
      if (!wallet) {
        return {
          success: false,
          error: 'Wallet not found'
        };
      }
      
      // Get transaction counts
      const commissionTransactions = await CommissionTransaction.find({ driverId });
      const rechargeTransactions = await RechargeTransaction.find({ driverId });
      
      const totalCommissionDeducted = commissionTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);
      const totalRecharged = rechargeTransactions
        .filter(t => t.status === 'completed')
        .reduce((sum, t) => sum + t.amount, 0);
      
      return {
        success: true,
        statistics: {
          totalTrips: commissionTransactions.length,
          totalCommissionDeducted,
          totalRecharged,
          averageCommissionPerTrip: commissionTransactions.length > 0 ? totalCommissionDeducted / commissionTransactions.length : 0,
          successfulRecharges: rechargeTransactions.filter(t => t.status === 'completed').length,
          failedRecharges: rechargeTransactions.filter(t => t.status === 'failed').length,
          wallet: wallet.toObject()
        }
      };
    } catch (error) {
      console.error('Error getting wallet statistics:', error);
      return {
        success: false,
        error: 'Failed to get wallet statistics'
      };
    }
  }

  /**
   * Get wallet stats (alias for getWalletStatistics)
   * @param {string} driverId - Driver ID
   * @returns {Promise<Object>} Wallet statistics
   */
  async getWalletStats(driverId) {
    return this.getWalletStatistics(driverId);
  }

  /**
   * Check if driver can work based on wallet balance
   * @param {string} driverId - Driver ID
   * @returns {Promise<Object>} Work status
   */
  async canDriverWork(driverId) {
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
        canWork: wallet.canWork(),
        currentBalance: wallet.currentBalance,
        isLowBalance: wallet.isLowBalance(),
        remainingTrips: wallet.getRemainingTrips()
      };
    } catch (error) {
      console.error('Error checking driver work status:', error);
      return {
        success: false,
        error: 'Failed to check driver work status'
      };
    }
  }
}

module.exports = new WalletService();
