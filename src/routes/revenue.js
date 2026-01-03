const express = require('express');
const router = express.Router();
const revenueService = require('../services/revenueService');
const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/auth');

/**
 * @route   GET /api/admin/revenue/total
 * @desc    Get total revenue with optional filters
 * @access  Private (Admin only)
 */
router.get('/total', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate, driverId, paymentMethod } = req.query;
    
    const filters = {};
    if (startDate) {
      filters.startDate = new Date(startDate);
    }
    if (endDate) {
      filters.endDate = new Date(endDate);
    }
    if (driverId) {
      filters.driverId = driverId;
    }
    if (paymentMethod) {
      filters.paymentMethod = paymentMethod;
    }
    
    const result = await revenueService.getTotalRevenue(filters);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error getting total revenue:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   GET /api/admin/revenue/period
 * @desc    Get revenue by period (daily, weekly, monthly)
 * @access  Private (Admin only)
 */
router.get('/period', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate, period = 'daily' } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Start date and end date are required'
      });
    }
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format'
      });
    }
    
    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({
        success: false,
        error: 'Period must be daily, weekly, or monthly'
      });
    }
    
    const result = await revenueService.getRevenueByPeriod(start, end, period);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error getting revenue by period:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   GET /api/admin/revenue/driver/:driverId
 * @desc    Get revenue by specific driver
 * @access  Private (Admin only)
 */
router.get('/driver/:driverId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { driverId } = req.params;
    
    const result = await revenueService.getRevenueByDriver(driverId);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error getting revenue by driver:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   GET /api/admin/revenue/driver
 * @desc    Get revenue by all drivers
 * @access  Private (Admin only)
 */
router.get('/driver', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await revenueService.getRevenueByDriver();
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error getting revenue by all drivers:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   GET /api/admin/revenue/stats
 * @desc    Get revenue statistics
 * @access  Private (Admin only)
 */
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await revenueService.getRevenueStats();
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error getting revenue stats:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

module.exports = router;

