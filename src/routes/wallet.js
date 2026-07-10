const express = require('express');
const router = express.Router();
const pointsService = require('../services/walletService');
const { authenticateToken } = require('../middleware/auth');
const { getFirestore } = require('../services/firebase');

/**
 * @route   POST /api/wallet/create
 * @desc    Create or get driver points wallet
 * @access  Private
 */
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { driverId, initialPoints = 0 } = req.body;
    
    if (!driverId) {
      return res.status(400).json({
        success: false,
        error: 'Driver ID is required'
      });
    }
    
    const result = await pointsService.createOrGetPointsWallet(driverId, initialPoints);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error creating points wallet:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @route   GET /api/wallet/balance/:driverId
 * @desc    Get points wallet balance and details
 * @access  Private
 */
router.get('/balance/:driverId', authenticateToken, async (req, res) => {
  try {
    const { driverId } = req.params;
    
    const result = await pointsService.getPointsBalance(driverId);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error getting points balance:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @route   POST /api/wallet/deduct-commission
 * @desc    Deduct commission from points wallet
 * @access  Private
 */
router.post('/deduct-commission', authenticateToken, async (req, res) => {
  try {
    const { 
      driverId, 
      tripId, 
      distanceKm, 
      commissionAmount, 
      tripDetails 
    } = req.body;
    
    if (!driverId || !tripId || !distanceKm || !commissionAmount) {
      return res.status(400).json({
        success: false,
        error: 'Driver ID, Trip ID, distance, and commission amount are required'
      });
    }
    
    const result = await pointsService.deductPoints(
      driverId, 
      tripId, 
      distanceKm, 
      commissionAmount, 
      tripDetails
    );
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error deducting commission from points:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @route   POST /api/wallet/top-up
 * @desc    Convert real money to points
 * @access  Private
 */
router.post('/top-up', authenticateToken, async (req, res) => {
  try {
    const { 
      driverId, 
      amount, 
      paymentMethod, 
      paymentDetails 
    } = req.body;
    
    if (!driverId || !amount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        error: 'Driver ID, amount, and payment method are required'
      });
    }
    
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be greater than 0'
      });
    }

    // ✅ CRITICAL FIX: Check driver verification status before allowing top-up
    const db = getFirestore();
    const driverDoc = await db.collection('users').doc(driverId).get();
    
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found',
          details: 'The driver account does not exist'
        }
      });
    }

    const driverData = driverDoc.data();
    const verificationStatus = driverData.driver?.verificationStatus || driverData.verificationStatus || 'pending';
    const isVerified = verificationStatus === 'verified' || verificationStatus === 'approved';

    if (!isVerified) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_VERIFIED_FOR_TOPUP',
          message: 'Verification required',
          details: 'You must complete document verification before topping up your wallet',
          verificationStatus: verificationStatus
        }
      });
    }
    
    const result = await pointsService.addPoints(
      driverId, 
      amount, 
      paymentMethod, 
      paymentDetails
    );
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error processing points top-up:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @route   GET /api/wallet/transactions/:driverId
 * @desc    Get points transaction history
 * @access  Private
 */
router.get('/transactions/:driverId', authenticateToken, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    
    const result = await pointsService.getTransactionHistory(
      driverId, 
      { limit: parseInt(limit), offset: parseInt(offset) }
    );
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error getting points transaction history:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @route   GET /api/wallet/stats/:driverId
 * @desc    Get points wallet statistics
 * @access  Private
 */
router.get('/stats/:driverId', authenticateToken, async (req, res) => {
  try {
    const { driverId } = req.params;
    
    const result = await pointsService.getWalletStats(driverId);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error getting points wallet stats:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @route   PUT /api/wallet/status/:driverId
 * @desc    Update points wallet status
 * @access  Private
 */
router.put('/status/:driverId', authenticateToken, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { status } = req.body;
    
    if (!status || !['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Valid status is required (active, inactive, suspended)'
      });
    }
    
    const result = await pointsService.updateWalletStatus(driverId, status);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error updating points wallet status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @route   GET /api/wallet/can-work/:driverId
 * @desc    Check if driver can work (has sufficient points)
 * @access  Private
 */
router.get('/can-work/:driverId', authenticateToken, async (req, res) => {
  try {
    const { driverId } = req.params;
    
    const result = await pointsService.canDriverWork(driverId);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error checking work status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @route   GET /api/wallet/remaining-trips/:driverId
 * @desc    Get remaining trips based on points balance
 * @access  Private
 */
router.get('/remaining-trips/:driverId', authenticateToken, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { commissionPerTrip = 2 } = req.query; // Default 2 points per km
    
    const result = await pointsService.getPointsBalance(driverId);
    
    if (result.success) {
      const remainingTrips = Math.floor(result.wallet.pointsBalance / commissionPerTrip);
      
      res.status(200).json({
        success: true,
        remainingTrips,
        currentBalance: result.wallet.pointsBalance,
        commissionPerTrip: parseFloat(commissionPerTrip)
      });
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error getting remaining trips:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;
