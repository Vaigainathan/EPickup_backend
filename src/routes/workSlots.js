const express = require('express');
const { body, validationResult, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const workSlotsService = require('../services/workSlotsService');
const { authMiddleware, requireDriver, requireAdmin } = require('../middleware/auth');

// CRITICAL: Rate limiter for slot generation to prevent infinite loops and server crashes
const slotGenerationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 2, // Max 3 generation requests per minute per driver
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many slot generation requests. Please wait before trying again.',
      details: 'You can only generate slots 3 times per minute'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: (req) => {
    // Rate limit per driver (using their UID)
    return `slot_gen_${req.user?.uid || req.ip}`;
  }
});

// Rate limiter for slot fetching to prevent polling spam
const slotFetchLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 second window  
  max: 10, // Max 20 fetch requests per 10 seconds
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many slot fetch requests',
      details: 'Please reduce polling frequency'
    }
  },
  skipSuccessfulRequests: false,
  keyGenerator: (req) => {
    return `slot_fetch_${req.user?.uid || req.ip}`;
  }
});

/**
 * @route   GET /api/slots
 * @desc    Get available work slots (for customers)
 * @access  Public
 */
router.get('/', [
  query('date').optional().isISO8601().withMessage('Date must be in ISO format'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { date, limit = 50 } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    
    const result = await workSlotsService.getAvailableSlots(targetDate, parseInt(limit));

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error getting available slots:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: 'An unexpected error occurred'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/slots/driver
 * @desc    Get driver's work slots
 * @access  Private (Driver only)
 */
router.get('/driver', [
  slotFetchLimiter, // CRITICAL: Rate limit to prevent polling spam
  authMiddleware,
  requireDriver,
  query('date').optional().isISO8601().withMessage('Date must be in ISO format')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { uid } = req.user;
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    
    const result = await workSlotsService.getDriverSlots(uid, targetDate);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error getting driver slots:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: 'An unexpected error occurred'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/slots/generate
 * @desc    Generate daily work slots for driver
 * @access  Private (Driver only)
 */
router.post('/generate', [
  slotGenerationLimiter, // CRITICAL: Rate limit to prevent infinite generation loops
  authMiddleware,
  requireDriver,
  body('date').optional().isISO8601().withMessage('Date must be in ISO format')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { uid } = req.user;
    const { date } = req.body;
    const targetDate = date ? new Date(date) : new Date();
    
    const result = await workSlotsService.generateDailySlots(uid, targetDate);

    if (result.success) {
      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error generating slots:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: 'An unexpected error occurred'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/slots/:slotId/status
 * @desc    Update slot status
 * @access  Private (Driver only)
 */
router.put('/:slotId/status', [
  authMiddleware,
  requireDriver,
  body('status')
    .isIn(['available', 'booked', 'completed'])
    .withMessage('Status must be available, booked, or completed')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { slotId } = req.params;
    const { status } = req.body;
    const { uid } = req.user;
    
    const result = await workSlotsService.updateSlotStatus(slotId, status, uid);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error updating slot status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: 'An unexpected error occurred'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/slots/:slotId/book
 * @desc    Book a slot
 * @access  Private (Customer only)
 */
router.post('/:slotId/book', [
  authMiddleware,
  body('customerId').isString().withMessage('Customer ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { slotId } = req.params;
    const { customerId } = req.body;
    
    const result = await workSlotsService.bookSlot(slotId, customerId);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error booking slot:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: 'An unexpected error occurred'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/slots/admin/generate-all
 * @desc    Generate slots for all active drivers
 * @access  Private (Admin only)
 */
router.post('/admin/generate-all', [
  authMiddleware,
  requireAdmin,
  body('date').optional().isISO8601().withMessage('Date must be in ISO format')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { date } = req.body;
    const targetDate = date ? new Date(date) : new Date();
    
    const result = await workSlotsService.generateSlotsForAllDrivers(targetDate);

    if (result.success) {
      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error generating slots for all drivers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: 'An unexpected error occurred'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/slots/admin/cleanup
 * @desc    Delete old slots (cleanup)
 * @access  Private (Admin only)
 */
router.delete('/admin/cleanup', [
  authMiddleware,
  requireAdmin,
  query('daysOld').optional().isInt({ min: 1, max: 30 }).withMessage('Days old must be between 1 and 30')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { daysOld = 7 } = req.query;
    
    const result = await workSlotsService.deleteOldSlots(parseInt(daysOld));

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        deletedCount: result.deletedCount,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error cleaning up old slots:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: 'An unexpected error occurred'
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
