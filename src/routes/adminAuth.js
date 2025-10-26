const express = require('express');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const jwt = require('jsonwebtoken');
const router = express.Router();

/**
 * @route   POST /api/admin/auth/login
 * @desc    Admin login with email and password
 * @access  Public
 */
router.post('/login', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_ID_TOKEN',
          message: 'Firebase ID token is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Verify Firebase ID token
    const auth = getAuth();
    const db = getFirestore();
    
    let decodedToken, userRecord, customClaims, adminUserData;
    
    try {
      // Validate token format before verification
      if (!idToken || typeof idToken !== 'string' || idToken.length < 10) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN_FORMAT',
            message: 'Invalid token format'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Verify the Firebase ID token
      decodedToken = await auth.verifyIdToken(idToken);
      
      // Validate token expiration
      if (decodedToken.exp < Date.now() / 1000) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Token has expired'
          },
          timestamp: new Date().toISOString()
        });
      }
      
      // Check if user has admin custom claims
      customClaims = decodedToken.customClaims || {};
      
      // Comprehensive admin user lookup with multiple fallbacks
      let isAdminUser = false;
      let adminUserData = null;
      let adminSource = '';
      
      // Method 1: Check custom claims
      if (customClaims.userType === 'admin' || customClaims.role === 'super_admin') {
        isAdminUser = true;
        adminSource = 'custom_claims';
        console.log('✅ [ADMIN LOGIN] Admin privileges found via custom claims');
      }
      
      // Method 2: Check adminUsers collection
      if (!isAdminUser) {
        try {
          const adminDoc = await db.collection('adminUsers').doc(decodedToken.uid).get();
          if (adminDoc.exists) {
            adminUserData = adminDoc.data();
            isAdminUser = true;
            adminSource = 'adminUsers_collection';
            console.log('✅ [ADMIN LOGIN] Admin privileges found via adminUsers collection');
          }
        } catch (error) {
          console.error('❌ [ADMIN LOGIN] Error checking adminUsers collection:', error);
        }
      }
      
      // Method 3: Check users collection for admin users
      if (!isAdminUser) {
        try {
          const userDoc = await db.collection('users').doc(decodedToken.uid).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            if (userData.userType === 'admin' || userData.role === 'super_admin') {
              adminUserData = userData;
              isAdminUser = true;
              adminSource = 'users_collection';
              console.log('✅ [ADMIN LOGIN] Admin privileges found via users collection');
            }
          }
        } catch (error) {
          console.error('❌ [ADMIN LOGIN] Error checking users collection:', error);
        }
      }
      
      // Method 4: Check users collection with query (fallback for edge cases)
      if (!isAdminUser) {
        try {
          const adminQuery = await db.collection('users')
            .where('uid', '==', decodedToken.uid)
            .where('userType', '==', 'admin')
            .limit(1)
            .get();
          
          if (!adminQuery.empty) {
            adminUserData = adminQuery.docs[0].data();
            isAdminUser = true;
            adminSource = 'users_query';
            console.log('✅ [ADMIN LOGIN] Admin privileges found via users query');
          }
        } catch (error) {
          console.error('❌ [ADMIN LOGIN] Error checking users query:', error);
        }
      }
      
      // Debug logging
      console.log('🔍 [ADMIN LOGIN] Comprehensive debug info:', {
        uid: decodedToken.uid,
        email: decodedToken.email,
        customClaims: customClaims,
        isAdminUser: isAdminUser,
        adminSource: adminSource,
        adminUserData: adminUserData ? {
          id: adminUserData.id || adminUserData.uid,
          userType: adminUserData.userType,
          role: adminUserData.role,
          email: adminUserData.email
        } : null
      });
      
      if (!isAdminUser) {
        console.log('❌ [ADMIN LOGIN] Access denied - no admin privileges found:', {
          uid: decodedToken.uid,
          email: decodedToken.email,
          customClaims: customClaims,
          checkedSources: ['custom_claims', 'adminUsers_collection', 'users_collection', 'users_query']
        });
        
        return res.status(403).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_PRIVILEGES',
            message: 'This account does not have admin privileges. Please contact support if you believe this is an error.',
            details: {
              uid: decodedToken.uid,
              email: decodedToken.email,
              checkedSources: ['custom_claims', 'adminUsers_collection', 'users_collection', 'users_query']
            }
          },
          timestamp: new Date().toISOString()
        });
      }
      
      console.log(`✅ [ADMIN LOGIN] Admin privileges confirmed via ${adminSource}`);

      // Get user record for additional info
      userRecord = await auth.getUser(decodedToken.uid);
      
    } catch (authError) {
      console.error('Firebase Auth verification error:', authError);
      
      // Handle specific Firebase Auth errors
      let errorCode = 'INVALID_TOKEN';
      let errorMessage = 'Invalid or expired Firebase ID token';
      
      if (authError.code === 'auth/id-token-expired') {
        errorCode = 'TOKEN_EXPIRED';
        errorMessage = 'Token has expired';
      } else if (authError.code === 'auth/id-token-revoked') {
        errorCode = 'TOKEN_REVOKED';
        errorMessage = 'Token has been revoked';
      } else if (authError.code === 'auth/invalid-id-token') {
        errorCode = 'INVALID_TOKEN_FORMAT';
        errorMessage = 'Invalid token format';
      }
      
      return res.status(401).json({
        success: false,
        error: {
          code: errorCode,
          message: errorMessage
        },
        timestamp: new Date().toISOString()
      });
    }

    // Create or get admin user in database with comprehensive recovery
    const adminId = decodedToken.uid; // Use Firebase UID as admin ID
    
    let adminUser = null; // Will be populated from lookup or recovery
    
    // Use admin user data from previous lookup if available
    if (adminUserData) {
      // Ensure admin user data has all required fields
      adminUser = {
        id: adminUserData.id || adminUserData.uid,
        uid: adminUserData.uid,
        email: adminUserData.email || userRecord.email,
        name: adminUserData.name || adminUserData.displayName || userRecord.displayName || 'Admin User',
        userType: adminUserData.userType || 'admin',
        role: adminUserData.role || 'super_admin',
        permissions: adminUserData.permissions || ['all'],
        isActive: adminUserData.isActive !== undefined ? adminUserData.isActive : true,
        isVerified: adminUserData.isVerified !== undefined ? adminUserData.isVerified : true,
        createdAt: adminUserData.createdAt || new Date(),
        updatedAt: new Date(),
        lastLogin: new Date()
      };
      console.log('✅ [ADMIN LOGIN] Using admin user data from lookup');
    } else {
      console.log('🔧 [ADMIN LOGIN] Admin user data not found, attempting recovery...');
      
      // Try to find existing admin user
      const existingAdminQuery = await db.collection('users')
        .where('uid', '==', adminId)
        .where('userType', '==', 'admin')
        .limit(1)
        .get();

      if (!existingAdminQuery.empty) {
        adminUser = existingAdminQuery.docs[0].data();
        adminUser.id = existingAdminQuery.docs[0].id;
        console.log('✅ [ADMIN LOGIN] Found existing admin user in database');
      } else {
        // Create new admin user as recovery mechanism
        console.log('🔧 [ADMIN LOGIN] Creating admin user as recovery mechanism...');
        const newAdminUserData = {
          id: adminId,
          uid: adminId,
          email: userRecord.email,
          name: userRecord.displayName || 'Admin User',
          userType: 'admin',
          role: customClaims.role || 'super_admin',
          permissions: customClaims.permissions || ['all'],
          isActive: true,
          isVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLogin: new Date()
        };

        // Create in both collections for consistency
        try {
          await Promise.all([
            db.collection('users').doc(adminId).set(newAdminUserData),
            db.collection('adminUsers').doc(adminId).set(newAdminUserData)
          ]);
          
          adminUser = newAdminUserData;
          console.log('✅ [ADMIN LOGIN] Admin user created successfully in both collections');
        } catch (createError) {
          console.error('❌ [ADMIN LOGIN] Error creating admin user:', createError);
          
          // Try to create in just users collection as fallback
          try {
            await db.collection('users').doc(adminId).set(newAdminUserData);
            adminUser = newAdminUserData;
            console.log('✅ [ADMIN LOGIN] Admin user created in users collection (fallback)');
          } catch (fallbackError) {
            console.error('❌ [ADMIN LOGIN] Fallback creation also failed:', fallbackError);
            throw new Error('Failed to create admin user in database');
          }
        }
      }
    }
    
    // Update last login
    try {
      await Promise.all([
        db.collection('users').doc(adminId).set({
          lastLogin: new Date(),
          updatedAt: new Date()
        }, { merge: true }),
        db.collection('adminUsers').doc(adminId).set({
          lastLogin: new Date(),
          updatedAt: new Date()
        }, { merge: true }).catch(() => {
          // Ignore if adminUsers collection doesn't exist
        })
      ]);
      console.log('✅ [ADMIN LOGIN] Last login updated successfully');
    } catch (error) {
      console.error('⚠️ [ADMIN LOGIN] Error updating last login:', error);
      // Don't fail login for this error
    }

    // Set custom claims for admin user
    const adminCustomClaims = {
      role: 'super_admin',
      roleBasedUID: adminId, // Admin uses Firebase UID as role-based UID
      phone: userRecord.phone_number,
      appType: 'admin',
      verified: true
    };

    try {
      await auth.setCustomUserClaims(adminId, adminCustomClaims);
      console.log(`✅ Custom claims set for admin:`, adminCustomClaims);
    } catch (claimsError) {
      console.error('❌ Failed to set custom claims for admin:', claimsError);
      // Continue with authentication even if claims fail
    }

    // Generate JWT token
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        error: {
          message: 'JWT_SECRET environment variable is required',
          code: 'JWT_SECRET_MISSING'
        }
      });
    }
    
    const token = jwt.sign(
      {
        userId: adminUser.uid,
        email: adminUser.email,
        userType: 'admin',
        role: adminUser.role,
        permissions: adminUser.permissions
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ [ADMIN LOGIN] Sending successful response...');
    console.log('📤 [ADMIN LOGIN] Response data:', {
      success: true,
      message: 'Admin login successful',
      data: {
        user: {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
          permissions: adminUser.permissions
        },
        token: token ? 'JWT_TOKEN_PRESENT' : 'JWT_TOKEN_MISSING'
      }
    });

    res.json({
      success: true,
      message: 'Admin login successful',
      data: {
        user: {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
          permissions: adminUser.permissions
        },
        token: token
      },
      timestamp: new Date().toISOString()
    });
    
    console.log('✅ [ADMIN LOGIN] Response sent successfully');

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGIN_ERROR',
        message: 'Failed to login admin user',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/auth/verify-token
 * @desc    Verify admin token and get user info
 * @access  Private (Admin)
 */
router.post('/verify-token', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NO_TOKEN',
          message: 'No token provided'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Verify JWT token
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        error: {
          message: 'JWT_SECRET environment variable is required',
          code: 'JWT_SECRET_MISSING'
        }
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (!decoded || decoded.userType !== 'admin') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid admin token'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get admin user data
    const db = getFirestore();
    const adminDoc = await db.collection('users').doc(decoded.userId).get();
    
    if (!adminDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ADMIN_NOT_FOUND',
          message: 'Admin user not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const adminData = adminDoc.data();

    res.json({
      success: true,
      message: 'Token verified successfully',
      data: {
        user: {
          id: adminData.id,
          email: adminData.email,
          name: adminData.name,
          role: adminData.role,
          permissions: adminData.permissions
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_VERIFICATION_FAILED',
        message: 'Failed to verify token',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
