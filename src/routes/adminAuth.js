const express = require('express');
const { getFirestore } = require('firebase-admin/firestore');
const jwt = require('jsonwebtoken');
const router = express.Router();

/**
 * @route   POST /api/admin/auth/login
 * @desc    Admin login with email and password
 * @access  Public
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Email and password are required'
        },
        timestamp: new Date().toISOString()
      });
    }

    // For now, use hardcoded admin credentials
    // In production, this should be stored securely in the database
    const adminCredentials = {
      email: 'admin@epickup.com',
      password: 'admin123', // In production, this should be hashed
      name: 'Admin User',
      role: 'super_admin'
    };

    if (email !== adminCredentials.email || password !== adminCredentials.password) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Create or get admin user in database
    const db = getFirestore();
    const adminId = 'admin_' + Date.now();
    
    // Check if admin user already exists
    const existingAdminQuery = await db.collection('users')
      .where('email', '==', email)
      .where('userType', '==', 'admin')
      .limit(1)
      .get();

    let adminUser;
    if (!existingAdminQuery.empty) {
      adminUser = existingAdminQuery.docs[0].data();
      adminUser.id = existingAdminQuery.docs[0].id;
    } else {
      // Create new admin user
      const adminUserData = {
        id: adminId,
        email: adminCredentials.email,
        name: adminCredentials.name,
        userType: 'admin',
        role: adminCredentials.role,
        permissions: ['all'],
        isActive: true,
        isVerified: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const adminRef = db.collection('users').doc(adminId);
      await adminRef.set(adminUserData);
      adminUser = adminUserData;
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
        userId: adminUser.id,
        email: adminUser.email,
        userType: 'admin',
        role: adminUser.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

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
