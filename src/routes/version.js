/**
 * @file Version Management Routes
 * @description Handles app version checking and updates
 */

const express = require('express');
const { requireRole } = require('../middleware/auth');
const { getDb } = require('../utils/firebaseUtils');
const router = express.Router();

/**
 * @route   GET /api/version
 * @desc    Get current app versions for customers and drivers
 * @access  Public
 * @returns {Object} Version info with update details
 */
router.get('/version', async (req, res) => {
  try {
    const appType = req.query.appType || 'customer'; // 'customer' or 'driver'
    
    if (!['customer', 'driver'].includes(appType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid appType. Use "customer" or "driver"'
      });
    }
    
    // Try to get version info from Firestore
    const versionDoc = await getDb().collection('appSettings')
      .doc('versions').get();
    
    let versionInfo;
    
    if (versionDoc.exists) {
      versionInfo = versionDoc.data();
    } else {
      // Fallback to default versions
      versionInfo = {
        customer: {
          current: '1.8.0',
          minimum: '1.7.0',
          recommended: '1.8.0',
          releaseNotes: 'Bug fixes and performance improvements',
          updateType: 'optional',
          appStoreUrl: 'https://play.google.com/store/apps/details?id=com.customer.epickup',
          iosAppStoreUrl: 'https://apps.apple.com/app/epickup-customer/id123456789'
        },
        driver: {
          current: '2.1.0',
          minimum: '2.0.0',
          recommended: '2.1.0',
          releaseNotes: 'New features and stability improvements',
          updateType: 'optional',
          appStoreUrl: 'https://play.google.com/store/apps/details?id=com.driver.epickup',
          iosAppStoreUrl: 'https://apps.apple.com/app/epickup-driver/id123456790'
        }
      };
    }
    
    const appVersionInfo = versionInfo[appType];
    
    if (!appVersionInfo) {
      return res.status(404).json({
        success: false,
        error: `No version info found for ${appType} app`
      });
    }
    
    res.json({
      success: true,
      data: {
        current: appVersionInfo.current,
        minimum: appVersionInfo.minimum,
        recommended: appVersionInfo.recommended,
        releaseNotes: appVersionInfo.releaseNotes,
        updateType: appVersionInfo.updateType,
        appStoreUrl: appVersionInfo.appStoreUrl,
        iosAppStoreUrl: appVersionInfo.iosAppStoreUrl,
        lastUpdated: versionInfo.lastUpdated || new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Version check error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'VERSION_CHECK_ERROR',
        message: 'Failed to check version',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      }
    });
  }
});

/**
 * @route   PUT /api/version
 * @desc    Update app versions (Admin only)
 * @access  Private (Admin)
 * @body    {String} appType - 'customer' or 'driver'
 * @body    {String} current - Current version
 * @body    {String} minimum - Minimum required version
 * @body    {String} recommended - Recommended version
 * @body    {String} releaseNotes - Release notes
 * @body    {String} updateType - 'optional' or 'mandatory'
 * @returns {Object} Updated version info
 */
router.put('/version', [
  requireRole(['admin'])
], async (req, res) => {
  try {
    const { appType, current, minimum, recommended, releaseNotes, updateType } = req.body;
    
    // Validate required fields
    if (!appType || !current) {
      return res.status(400).json({
        success: false,
        error: 'appType and current version are required'
      });
    }
    
    if (!['customer', 'driver'].includes(appType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid appType. Use "customer" or "driver"'
      });
    }
    
    // Validate version format (semantic versioning)
    const versionRegex = /^\d+\.\d+\.\d+$/;
    if (!versionRegex.test(current) || (minimum && !versionRegex.test(minimum)) || (recommended && !versionRegex.test(recommended))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid version format. Use semantic versioning (e.g., 1.0.0)'
      });
    }
    
    const db = getDb();
    const versionsRef = db.collection('appSettings').doc('versions');
    
    // Update version for specific app type
    await versionsRef.set(
      {
        [appType]: {
          current,
          minimum: minimum || current,
          recommended: recommended || current,
          releaseNotes: releaseNotes || 'Update available',
          updateType: updateType || 'optional',
          appStoreUrl: appType === 'customer' 
            ? 'https://play.google.com/store/apps/details?id=com.customer.epickup'
            : 'https://play.google.com/store/apps/details?id=com.driver.epickup',
          iosAppStoreUrl: appType === 'customer'
            ? 'https://apps.apple.com/app/epickup-customer/id123456789'
            : 'https://apps.apple.com/app/epickup-driver/id123456790',
          updatedAt: new Date().toISOString()
        },
        lastUpdated: new Date().toISOString()
      },
      { merge: true }
    );
    
    res.json({
      success: true,
      message: `Version updated for ${appType} app`,
      data: {
        appType,
        current,
        minimum: minimum || current,
        recommended: recommended || current,
        updateType: updateType || 'optional'
      }
    });
  } catch (error) {
    console.error('Version update error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'VERSION_UPDATE_ERROR',
        message: 'Failed to update version',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      }
    });
  }
});

module.exports = router;
