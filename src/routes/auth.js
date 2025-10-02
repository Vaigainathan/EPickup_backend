const express = require('express');
const router = express.Router();

/**
 * @route POST /api/auth/prepare-storage-token
 * @desc Prepare Firebase Storage token with custom claims
 * @access Private
 */
router.post('/prepare-storage-token', async (req, res) => {
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    const firebaseAuthService = require('../services/firebaseAuthService');
    const db = getFirestore();
    
    const { userId, userType } = req.body;
      
    if (!userId || !userType) {
      return res.status(400).json({
          success: false,
        error: 'User ID and user type are required'
      });
    }

    // Get user from Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({
          success: false,
        error: 'User not found'
      });
    }

    const userData = userDoc.data();
    const firebaseUID = userData.originalFirebaseUID;

    // Ensure custom claims are set
        const customClaims = {
          role: userType,
      roleBasedUID: userId,
      phone: userData.phone,
          appType: userType,
          verified: true
        };

    // Set custom claims
    await firebaseAuthService.setCustomClaims(firebaseUID, customClaims);

    // Wait for claims to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Generate a fresh custom token
    const customToken = await firebaseAuthService.createCustomToken(firebaseUID, customClaims);

      res.json({
        success: true,
        data: {
        customToken: customToken,
        customClaims: customClaims,
        message: 'Storage token prepared successfully'
      }
      });

    } catch (error) {
    console.error('❌ Error preparing storage token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to prepare storage token',
      details: error.message
    });
  }
});

module.exports = router;