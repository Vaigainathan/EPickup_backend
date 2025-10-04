const express = require('express');
const router = express.Router();
const jwtService = require('../services/jwtService');

/**
 * Refresh access token using refresh token
 * POST /api/auth/refresh
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token is required'
      });
    }

    console.log('🔄 [REFRESH] Attempting to refresh access token...');

    // Use JWT service to refresh the token
    const newTokenPair = jwtService.refreshAccessToken(refreshToken);

    console.log('✅ [REFRESH] Access token refreshed successfully');

    res.json({
      success: true,
      data: {
        token: newTokenPair.accessToken,
        refreshToken: newTokenPair.refreshToken,
        expiresIn: newTokenPair.expiresIn,
        refreshExpiresIn: newTokenPair.refreshExpiresIn
      }
    });

  } catch (error) {
    console.error('❌ [REFRESH] Token refresh error:', error);
    
    res.status(401).json({
      success: false,
      error: 'Invalid or expired refresh token',
      details: error.message
    });
  }
});

module.exports = router;
