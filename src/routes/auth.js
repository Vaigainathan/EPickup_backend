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

/**
 * @route POST /api/auth/firebase/verify-token
 * @desc Verify Firebase ID token for driver/customer authentication
 * @access Public
 */
router.post('/firebase/verify-token', async (req, res) => {
  try {
    console.log('🔐 Verifying Firebase ID token for driver...');
    
    // Initialize Firebase services inside the route
    const { getFirestore } = require('firebase-admin/firestore');
    const { getAuth } = require('firebase-admin/auth');
    const db = getFirestore();
    const auth = getAuth();
    
    const { idToken, userType } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: 'Firebase ID token is required'
      });
    }

    if (!userType) {
      return res.status(400).json({
        success: false,
        error: 'User type is required (driver/customer)'
      });
    }

    // Verify Firebase ID token
    const decodedToken = await auth.verifyIdToken(idToken);
    console.log('✅ Firebase ID token verified successfully:', {
      uid: decodedToken.uid,
      email: decodedToken.email,
      phone_number: decodedToken.phone_number,
      auth_time: new Date(decodedToken.auth_time * 1000).toISOString()
    });

    // Generate role-specific UID
    const roleBasedUID = generateRoleBasedUID(decodedToken.phone_number, userType);
    console.log(`🔑 Generated role-specific UID for ${userType}:`, roleBasedUID);

    // Check if user exists in Firestore
    const userDoc = await db.collection('users').doc(roleBasedUID).get();
    
    let userData;
    if (!userDoc.exists) {
      console.log(`⚠️ ${userType} user not found in Firestore, creating new user:`, roleBasedUID);
      
      // Create new user document for first-time authentication
      userData = {
        id: roleBasedUID,
        name: '', // Will be filled during onboarding
        phone: decodedToken.phone_number,
        userType: userType,
        originalFirebaseUID: decodedToken.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'pending_verification',
        documents: {}
      };
      
      // Create the user document
      await db.collection('users').doc(roleBasedUID).set(userData);
      console.log(`✅ Created new ${userType} user:`, roleBasedUID);
    } else {
      userData = userDoc.data();
      console.log(`✅ Found existing ${userType} user:`, roleBasedUID);
    }

    // Set dynamic custom claims on Firebase user for customer/driver
    const customClaims = {
      role: userType,
      roleBasedUID: userData.id, // Role-specific UID
      phone: decodedToken.phone_number,
      appType: userType,
      verified: true
    };

    await auth.setCustomUserClaims(decodedToken.uid, customClaims);
    console.log(`✅ Custom claims set for user ${decodedToken.uid}:`, customClaims);
    console.log(`✅ Custom claims set for ${userType}:`, customClaims);

    // Generate JWT token for backend authentication
    const jwt = require('jsonwebtoken');
    const backendToken = jwt.sign(
      {
        userId: userData.id,
        firebaseUID: decodedToken.uid,
        userType: userType,
        phone: decodedToken.phone_number,
        roleBasedUID: userData.id
      },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );

    console.log(`✅ ${userType} authentication successful:`, userData.id);

    res.json({
      success: true,
      data: {
        user: {
          id: userData.id,
          name: userData.name,
          phone: userData.phone,
          userType: userData.userType,
          roleBasedUID: userData.id
        },
        token: backendToken,
        customClaims: customClaims
      }
    });

  } catch (error) {
    console.error('❌ Firebase token verification error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid Firebase token or authentication failed',
      details: error.message
    });
  }
});

/**
 * Generate role-based UID for users
 */
function generateRoleBasedUID(phone, userType) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(`${phone}_${userType}`).digest('hex');
  return `U${hash.substring(0, 24)}`;
}

module.exports = router;