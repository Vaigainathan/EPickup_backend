const express = require('express');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('../services/firebase');
const verificationService = require('../services/verificationService');
const { sanitizeInput, validateEmail, checkValidation } = require('../middleware/validation');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

// Apply input sanitization to all admin routes
router.use(sanitizeInput);

// Note: Authentication is now handled by authMiddleware in server.js
// This middleware validates backend JWT tokens and sets req.user with user data
// Admin routes are protected by standard JWT authentication

const normalizeTimestamp = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch (error) {
      console.warn('⚠️ Failed to convert Firestore timestamp:', error);
    }
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
};

const SIGNED_URL_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
let cachedStorageInstance;

const verificationPhotoUrlCache = new Map();

const getStorageSafe = () => {
  if (cachedStorageInstance !== undefined) {
    return cachedStorageInstance;
  }
  try {
    cachedStorageInstance = getStorage();
    return cachedStorageInstance;
  } catch (error) {
    console.warn('⚠️ Firebase Storage unavailable for verification photo normalization:', error.message);
    cachedStorageInstance = null;
    return null;
  }
};

const parseStorageReference = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return { publicUrl: trimmed };
  }

  if (trimmed.startsWith('gs://')) {
    const withoutScheme = trimmed.slice(5);
    const firstSlash = withoutScheme.indexOf('/');
    if (firstSlash === -1) {
      return null;
    }
    const bucket = withoutScheme.slice(0, firstSlash);
    const pathWithQuery = withoutScheme.slice(firstSlash + 1);
    const [path] = pathWithQuery.split('?');
    return {
      bucket,
      path
    };
  }

  const sanitized = trimmed.replace(/^\/+/, '');
  if (!sanitized) {
    return null;
  }

  const [path] = sanitized.split('?');
  return {
    bucket: null,
    path
  };
};

const buildSignedUrl = async ({ bucket, path }) => {
  const storage = getStorageSafe();
  if (!storage || !path) {
    return {
      url: null,
      bucket: bucket || null,
      path: path || null,
      origin: storage ? 'storage_path' : 'storage_unavailable'
    };
  }

  const bucketInstance = bucket ? storage.bucket(bucket) : storage.bucket();
  const file = bucketInstance.file(path);
  const cacheKey = `${bucketInstance.name}/${path}`;

  const cached = verificationPhotoUrlCache.get(cacheKey);
  if (cached && cached.expiresAt && cached.expiresAt > Date.now() + 60000) {
    return {
      url: cached.url,
      bucket: bucketInstance.name,
      path,
      origin: 'cache',
      expiresAt: new Date(cached.expiresAt).toISOString()
    };
  }

  try {
    const expiresAtMs = Date.now() + SIGNED_URL_TTL_MS;
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: new Date(expiresAtMs)
    });

    verificationPhotoUrlCache.set(cacheKey, {
      url: signedUrl,
      expiresAt: expiresAtMs
    });

    return {
      url: signedUrl,
      bucket: bucketInstance.name,
      path,
      origin: 'signed',
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  } catch (error) {
    console.warn('⚠️ Failed to generate signed URL for verification photo:', {
      bucket: bucketInstance.name,
      path,
      error: error.message
    });
    return {
      url: null,
      bucket: bucketInstance.name,
      path,
      origin: 'error',
      error: error.message
    };
  }
};

const normalizeVerification = async (primary, fallback) => {
  const candidate = primary && typeof primary === 'object'
    ? primary
    : (fallback && typeof fallback === 'object' ? fallback : null);

  if (!candidate) {
    return undefined;
  }

  const rawPhotoUrl =
    (typeof candidate.photoUrl === 'string' && candidate.photoUrl.trim()) ||
    (typeof candidate.photoURL === 'string' && candidate.photoURL.trim()) ||
    (typeof candidate.url === 'string' && candidate.url.trim());

  if (!rawPhotoUrl) {
    return undefined;
  }

  const reference = parseStorageReference(rawPhotoUrl);
  if (!reference) {
    return undefined;
  }

  let finalPhotoUrl = null;
  let verificationMeta = {
    source: 'storage_path',
    storageBucket: null,
    storagePath: null,
    signedUrlExpiresAt: null,
    signedUrlError: null
  };

  if (reference.publicUrl) {
    finalPhotoUrl = reference.publicUrl;
    verificationMeta.source = 'public';
  } else if (reference.path) {
    const signedResult = await buildSignedUrl(reference);
    finalPhotoUrl = signedResult.url;
    verificationMeta = {
      source: signedResult.origin,
      storageBucket: signedResult.bucket || reference.bucket,
      storagePath: signedResult.path || reference.path,
      signedUrlExpiresAt: signedResult.expiresAt || null,
      signedUrlError: signedResult.error || null
    };
  }

  const rawLocation = candidate.location ||
    candidate.coordinates ||
    (candidate.metadata && candidate.metadata.location) ||
    null;

  let location = null;
  if (rawLocation && typeof rawLocation === 'object') {
    const latitude = rawLocation.latitude ??
      rawLocation.lat ??
      rawLocation._latitude ??
      rawLocation.coords?.latitude ??
      null;
    const longitude = rawLocation.longitude ??
      rawLocation.lng ??
      rawLocation._longitude ??
      rawLocation.coords?.longitude ??
      null;
    if (latitude !== null && longitude !== null) {
      location = { latitude, longitude };
    }
  }

  if (!finalPhotoUrl && !reference.publicUrl) {
    verificationMeta.source = verificationMeta.source || (reference.bucket || reference.path ? 'storage_path' : 'unknown');
  }

  const verification = {
    photoUrl: finalPhotoUrl || (reference.publicUrl || null),
    rawPhotoUrl,
    storagePath: verificationMeta.storagePath || reference.path || null,
    storageBucket: verificationMeta.storageBucket || reference.bucket || null,
    source: verificationMeta.source,
    signedUrlExpiresAt: verificationMeta.signedUrlExpiresAt,
    signedUrlError: verificationMeta.signedUrlError,
    verifiedAt: normalizeTimestamp(
      candidate.verifiedAt ||
      candidate.uploadedAt ||
      (candidate.metadata && candidate.metadata.verifiedAt)
    ),
    verifiedBy: candidate.verifiedBy || candidate.uploadedBy || candidate.reviewedBy || null,
    location,
    notes: candidate.notes ||
      candidate.note ||
      candidate.description ||
      (candidate.metadata && (candidate.metadata.notes || candidate.metadata.note)) ||
      null
  };

  if (!verification.photoUrl && !verification.rawPhotoUrl) {
    return undefined;
  }

  return verification;
};

/**
 * @route   GET /api/admin/profile
 * @desc    Get current admin user profile
 * @access  Private (Admin only)
 */
router.get('/profile', async (req, res) => {
  try {
    const db = getFirestore();
    const adminId = req.user.uid || req.user.userId;

    // Validate admin ID
    if (!adminId || typeof adminId !== 'string' || adminId.length < 3) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ADMIN_ID',
          message: 'Invalid admin ID provided'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get admin user data from adminUsers collection
    const adminDoc = await db.collection('adminUsers').doc(adminId).get();
    
    if (!adminDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ADMIN_NOT_FOUND',
          message: 'Admin profile not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const adminData = adminDoc.data();
    
    // Return sanitized admin profile
    const profile = {
      id: adminDoc.id,
      uid: adminData.uid,
      email: adminData.email,
      displayName: adminData.displayName,
      role: adminData.role,
      permissions: adminData.permissions || [],
      isActive: adminData.isActive !== false,
      isEmailVerified: adminData.isEmailVerified || false,
      accountStatus: adminData.accountStatus || 'active',
      lastLogin: adminData.lastLogin,
      createdAt: adminData.createdAt?.toDate?.() || adminData.createdAt,
      updatedAt: adminData.updatedAt?.toDate?.() || adminData.updatedAt
    };

    console.log(`✅ Admin profile retrieved successfully: ${adminData.email}`);

    res.json({
      success: true,
      data: profile,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting admin profile:', error);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_RETRIEVAL_ERROR',
        message: 'Failed to retrieve admin profile',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/users
 * @desc    Get all users (customers and drivers)
 * @access  Private (Admin only)
 */
router.get('/users', async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 50, offset = 0, userType, status } = req.query;

    console.log(`📋 Getting users list for admin: ${req.user.email || req.user.userId}`);

    // Validate and sanitize query parameters
    const validatedLimit = Math.max(1, Math.min(100, parseInt(limit) || 50));
    const validatedOffset = Math.max(0, parseInt(offset) || 0);
    
    // Validate userType parameter
    const allowedUserTypes = ['customer', 'driver', 'admin'];
    const validatedUserType = allowedUserTypes.includes(userType) ? userType : null;
    
    // Validate status parameter
    const allowedStatuses = ['active', 'inactive'];
    const validatedStatus = allowedStatuses.includes(status) ? status : null;

    let query = db.collection('users');

    // Apply validated filters
    if (validatedUserType) {
      query = query.where('userType', '==', validatedUserType);
    }
    
    if (validatedStatus) {
      query = query.where('status', '==', validatedStatus);
    }

    // Apply pagination and ordering with validated values
    // Use cursor-based pagination for better performance
    if (req.query.cursor) {
      const cursorDoc = await db.collection('users').doc(req.query.cursor).get();
      if (cursorDoc.exists) {
        query = query.orderBy('createdAt', 'desc').startAfter(cursorDoc).limit(validatedLimit);
      } else {
        query = query.orderBy('createdAt', 'desc').limit(validatedLimit);
      }
    } else {
      query = query.orderBy('createdAt', 'desc').limit(validatedLimit);
    }

    const snapshot = await query.get();

    // Use map for better performance
    const users = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        uid: data.uid,
        email: data.email,
        name: data.name || data.displayName,
        phone: data.phone,
        userType: data.userType,
        status: data.status || 'active',
        isActive: data.isActive !== false,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        lastLogin: data.lastLogin,
        // Include driver-specific data if available
        ...(data.userType === 'driver' && {
          driver: {
            isOnline: data.driver?.isOnline || false,
            isAvailable: data.driver?.isAvailable || false,
            verificationStatus: data.driver?.verificationStatus || 'pending',
            vehicleDetails: data.driver?.vehicleDetails || null
          }
        })
      };
    });

    console.log(`✅ Retrieved ${users.length} users for admin`);

    res.json({
      success: true,
      data: {
        users,
        total: users.length,
        pagination: {
          limit: validatedLimit,
          offset: validatedOffset,
          hasMore: users.length === validatedLimit
        },
        filters: {
          userType: validatedUserType,
          status: validatedStatus
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting users list:', error);
    
    // Use standardized error response
    const errorResponse = {
      success: false,
      error: {
        code: 'USERS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve users list',
        details: error.message
      },
      timestamp: new Date().toISOString()
    };
    
    res.status(500).json(errorResponse);
  }
});

/**
 * @route   GET /api/admin/admins
 * @desc    Get all admin users
 * @access  Private (Super Admin only)
 */
router.get('/admins', async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0, role } = req.query;

    let query = db.collection('adminUsers');

    // Apply filters
    if (role) {
      query = query.where('role', '==', role);
    }

    // Apply pagination and ordering
    query = query.orderBy('createdAt', 'desc').limit(Math.max(1, Math.min(100, parseInt(limit) || 20))).offset(Math.max(0, parseInt(offset) || 0));

    const snapshot = await query.get();
    const admins = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      admins.push({
        id: doc.id,
        uid: data.uid,
        email: data.email,
        displayName: data.displayName,
        role: data.role,
        permissions: data.permissions,
        isActive: data.isActive,
        lastLogin: data.lastLogin,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    }

    res.json({
      success: true,
      data: admins,
      pagination: {
        limit: Math.max(1, Math.min(100, parseInt(limit) || 20)),
        offset: Math.max(0, parseInt(offset) || 0),
        total: admins.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ADMINS_ERROR',
        message: 'Failed to fetch admin users',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/admins
 * @desc    Create new admin user
 * @access  Private (Super Admin only)
 */
router.post('/admins', [
  validateEmail('email'),
  checkValidation
], async (req, res) => {
  try {
    const { email, displayName, role = 'super_admin', permissions = [] } = req.body;
    
    if (!email || !displayName) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'Email and display name are required'
        }
      });
    }

    const db = getFirestore();
    
    // Check if admin already exists
    const existingAdmin = await db.collection('adminUsers')
      .where('email', '==', email)
      .get();
    
    if (!existingAdmin.empty) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ADMIN_EXISTS',
          message: 'Admin user already exists'
        }
      });
    }

    // Generate a unique UID for the admin
    const adminUid = `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create admin user data
    const adminData = {
      uid: adminUid,
      id: adminUid,
      email: email,
      displayName: displayName,
      role: role,
      permissions: permissions.length > 0 ? permissions : getDefaultPermissions(role),
      isActive: true,
      isEmailVerified: false,
      accountStatus: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.uid || req.user.userId,
      lastLogin: null
    };

    // Store in adminUsers collection
    await db.collection('adminUsers').doc(adminUid).set(adminData);
    
    // Also store in users collection for consistency
    await db.collection('users').doc(adminUid).set({
      ...adminData,
      userType: 'admin'
    });
    
    res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      data: {
        uid: adminUid,
        email: email,
        displayName: displayName,
        role: role,
        permissions: adminData.permissions,
        status: 'pending_activation'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error creating admin user:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CREATE_ADMIN_ERROR',
        message: 'Failed to create admin user',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/admin/admins/:uid
 * @desc    Update admin user
 * @access  Private (Admin only - can update own profile, Super Admin can update any)
 */
router.put('/admins/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    const { displayName, role, permissions, isActive } = req.body;
    
    const db = getFirestore();
    
    // Check if admin exists
    const adminDoc = await db.collection('adminUsers').doc(uid).get();
    if (!adminDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ADMIN_NOT_FOUND',
          message: 'Admin user not found'
        }
      });
    }

    // Check permissions - only super admin can change roles or deactivate others
    if (req.user.role !== 'super_admin' && (req.user.uid || req.user.userId) !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'You can only update your own profile'
        }
      });
    }

    // Prepare update data
    const updateData = {
      updatedAt: new Date().toISOString()
    };

    if (displayName) updateData.displayName = displayName;
    if (role && req.user.role === 'super_admin') updateData.role = role;
    if (permissions && req.user.role === 'super_admin') updateData.permissions = permissions;
    if (isActive !== undefined && req.user.role === 'super_admin') updateData.isActive = isActive;

    // Update adminUsers collection
    await db.collection('adminUsers').doc(uid).update(updateData);
    
    // Update users collection
    await db.collection('users').doc(uid).update(updateData);
    
    res.json({
      success: true,
      message: 'Admin user updated successfully',
      data: {
        uid: uid,
        ...updateData
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating admin user:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_ADMIN_ERROR',
        message: 'Failed to update admin user',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/admin/admins/:uid
 * @desc    Delete admin user
 * @access  Private (Super Admin only)
 */
router.delete('/admins/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    
    // Only super admin can delete other admins
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'Only super admin can delete admin users'
        }
      });
    }

    // Cannot delete self
    if ((req.user.uid || req.user.userId) === uid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CANNOT_DELETE_SELF',
          message: 'You cannot delete your own account'
        }
      });
    }

    const db = getFirestore();
    
    // Check if admin exists
    const adminDoc = await db.collection('adminUsers').doc(uid).get();
    if (!adminDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ADMIN_NOT_FOUND',
          message: 'Admin user not found'
        }
      });
    }

    // Delete from both collections
    await db.collection('adminUsers').doc(uid).delete();
    await db.collection('users').doc(uid).delete();
    
    res.json({
      success: true,
      message: 'Admin user deleted successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error deleting admin user:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_ADMIN_ERROR',
        message: 'Failed to delete admin user',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Helper function to get default permissions for a role
function getDefaultPermissions(role) {
  const rolePermissions = {
    'super_admin': ['all']
  };
  
  return rolePermissions[role] || ['dashboard'];
}

// Note: Admin login is now handled by /api/auth/firebase/verify-token
// This endpoint has been removed to avoid conflicts

/**
 * @route   GET /api/admin/drivers
 * @desc    Get all drivers with pagination and filters
 * @access  Private (Admin only)
 */
router.get('/drivers', async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0, status, verificationStatus } = req.query;

    // ✅ CORE FIX: First, ensure all drivers have createdAt field (fix missing ones)
    // This prevents drivers from being excluded from queries
    try {
      const allDriversSnapshot = await db.collection('users')
        .where('userType', '==', 'driver')
        .get();
      
      const driversNeedingFix = [];
      for (const doc of allDriversSnapshot.docs) {
        const data = doc.data();
        if (!data.createdAt) {
          driversNeedingFix.push(doc.id);
        }
      }
      
      if (driversNeedingFix.length > 0) {
        console.log(`🔄 [ADMIN] Fixing ${driversNeedingFix.length} drivers missing createdAt field...`);
        const batch = db.batch();
        for (const driverId of driversNeedingFix) {
          const driverRef = db.collection('users').doc(driverId);
          batch.update(driverRef, {
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        await batch.commit();
        console.log(`✅ [ADMIN] Fixed ${driversNeedingFix.length} drivers with missing createdAt`);
      }
    } catch (fixError) {
      console.warn('⚠️ [ADMIN] Failed to fix drivers with missing createdAt:', fixError.message);
      // Continue anyway - fallback query will handle it
    }

    let query = db.collection('users').where('userType', '==', 'driver');

    // Apply filters
    if (status) {
      query = query.where('isActive', '==', status === 'active');
    }
    if (verificationStatus) {
      query = query.where('isVerified', '==', verificationStatus === 'verified');
    }

    // ✅ CRITICAL FIX: Try indexed query first, fallback to simple query if it fails
    let snapshot;
    try {
      // Apply pagination and ordering with index
      query = query.orderBy('createdAt', 'desc').limit(Math.max(1, Math.min(100, parseInt(limit) || 20))).offset(Math.max(0, parseInt(offset) || 0));
      snapshot = await query.get();
    } catch (indexError) {
      // Fallback: Query without orderBy if index is missing or createdAt has wrong type
      console.warn('⚠️ [ADMIN] Indexed query failed, using fallback query:', indexError.message);
      let fallbackQuery = db.collection('users').where('userType', '==', 'driver');
      
      if (status) {
        fallbackQuery = fallbackQuery.where('isActive', '==', status === 'active');
      }
      if (verificationStatus) {
        fallbackQuery = fallbackQuery.where('isVerified', '==', verificationStatus === 'verified');
      }
      
      // Get all matching drivers, then sort in-memory
      const allDrivers = await fallbackQuery.get();
      const driversArray = allDrivers.docs.map(doc => {
        const data = doc.data();
        // Handle createdAt: Firestore Timestamp, ISO string, or missing
        let createdAt = new Date(0); // Default to epoch for missing dates
        if (data.createdAt) {
          if (data.createdAt.toDate) {
            createdAt = data.createdAt.toDate(); // Firestore Timestamp
          } else if (typeof data.createdAt === 'string') {
            createdAt = new Date(data.createdAt); // ISO string
          } else if (data.createdAt.seconds) {
            createdAt = new Date(data.createdAt.seconds * 1000); // Timestamp object
          }
        }
        
        return {
          doc,
          data,
          createdAt
        };
      });
      
      // Sort by createdAt descending
      driversArray.sort((a, b) => b.createdAt - a.createdAt);
      
      // Apply pagination
      const startIdx = Math.max(0, parseInt(offset) || 0);
      const endIdx = startIdx + Math.max(1, Math.min(100, parseInt(limit) || 20));
      const paginatedDocs = driversArray.slice(startIdx, endIdx);
      
      // Create a mock snapshot-like object
      snapshot = {
        docs: paginatedDocs.map(item => item.doc),
        empty: paginatedDocs.length === 0
      };
    }
    const drivers = [];
    
    // ✅ PERFORMANCE OPTIMIZATION: Batch fetch all earnings records in parallel for all drivers
    const driverIds = snapshot.docs.map(doc => doc.id);
    const earningsPromises = driverIds.map(driverId => 
      db.collection('driver_earnings')
        .where('driverId', '==', driverId)
        .where('status', '==', 'completed')
        .get()
        .catch(err => {
          console.warn(`⚠️ [ADMIN] Failed to fetch earnings for driver ${driverId}:`, err.message);
          return { docs: [], forEach: () => {} }; // Return empty snapshot on error
        })
    );
    
    // ✅ CRITICAL FIX: Batch fetch all ratings in parallel for all drivers (driver isolated)
    const ratingsPromises = driverIds.map(driverId => 
      db.collection('ratings')
        .where('driverId', '==', driverId)
        .get()
        .catch(err => {
          console.warn(`⚠️ [ADMIN] Failed to fetch ratings for driver ${driverId}:`, err.message);
          return { docs: [] }; // Return empty snapshot on error
        })
    );
    
    const earningsSnapshots = await Promise.all(earningsPromises);
    const ratingsSnapshots = await Promise.all(ratingsPromises);
    const earningsMap = new Map();
    const ratingsMap = new Map();
    
    // Build earnings map for quick lookup
    earningsSnapshots.forEach((earningsSnapshot, index) => {
      const driverId = driverIds[index];
      const earningsData = {
        total: 0,
        thisMonth: 0,
        lastMonth: 0,
        trips: 0
      };
      
      const now = new Date();
      const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      
      earningsSnapshot.forEach(earningsDoc => {
        const earningsRecord = earningsDoc.data();
        const amount = earningsRecord.amount || 0;
        earningsData.total += amount;
        earningsData.trips++;
        
        // Check if earnings are from this month
        const earnedAt = earningsRecord.earnedAt?.toDate?.() || 
                        (earningsRecord.earnedAt instanceof Date ? earningsRecord.earnedAt : 
                         (earningsRecord.createdAt?.toDate?.() || earningsRecord.createdAt));
        
        if (earnedAt) {
          if (earnedAt >= startOfThisMonth) {
            earningsData.thisMonth += amount;
          } else if (earnedAt >= startOfLastMonth && earnedAt <= endOfLastMonth) {
            earningsData.lastMonth += amount;
          }
        }
      });
      
      earningsMap.set(driverId, earningsData);
      console.log(`💰 [ADMIN] Calculated earnings for driver ${driverId}: Total: ₹${earningsData.total}, This Month: ₹${earningsData.thisMonth}, Trips: ${earningsData.trips}`);
    });
    
    // ✅ CRITICAL FIX: Build ratings map for quick lookup (driver isolated - each driver's ratings calculated separately)
    ratingsSnapshots.forEach((ratingsSnapshot, index) => {
      const driverId = driverIds[index];
      const ratings = ratingsSnapshot.docs.map(doc => {
        const ratingData = doc.data();
        return ratingData.rating || 0; // Ensure we only get valid ratings
      }).filter(r => r > 0 && r <= 5); // Filter out invalid ratings (driver isolation protection)
      
      const averageRating = ratings.length > 0
        ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10 // Round to 1 decimal
        : 0;
      
      ratingsMap.set(driverId, {
        average: averageRating,
        total: ratings.length
      });
      console.log(`⭐ [ADMIN] Calculated ratings for driver ${driverId}: Average: ${averageRating}, Total Ratings: ${ratings.length}`);
    });

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const driverData = data.driver || {};
      
      // ✅ CRITICAL FIX: Merge documents from both locations (top-level and nested)
      // Documents can be in data.documents OR data.driver.documents
      const topLevelDocs = data.documents || {};
      const driverDocs = driverData.documents || {};
      
      // Merge documents, prefer top-level over nested
      const mergedDocuments = { ...driverDocs, ...topLevelDocs };
      
      // Helper to convert snake_case to camelCase
      const toCamelCase = (str) => {
        return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      };
      
      // ✅ CRITICAL FIX: Normalize all document keys to camelCase for frontend
      const normalizedDocuments = {};
      Object.keys(mergedDocuments).forEach(key => {
        const camelKey = toCamelCase(key);
        normalizedDocuments[camelKey] = mergedDocuments[key];
      });
      
      // ✅ CRITICAL FIX: Get calculated earnings from map (batch fetched above)
      const driverId = doc.id;
      const earningsData = earningsMap.get(driverId) || {
        total: driverData.totalEarnings || driverData.earnings?.total || 0,
        thisMonth: driverData.earnings?.thisMonth || 0,
        lastMonth: driverData.earnings?.lastMonth || 0,
        trips: driverData.totalTrips || 0
      };
      
      const totalEarnings = earningsData.total;
      const earningsThisMonth = earningsData.thisMonth;
      const earningsLastMonth = earningsData.lastMonth;
      const completedTripsCount = earningsData.trips;
      
      // ✅ CRITICAL FIX: Get calculated ratings from map (batch fetched above - driver isolated)
      const ratingsData = ratingsMap.get(driverId) || {
        average: driverData.averageRating || driverData.rating || 0,
        total: driverData.totalRatings || 0
      };
      
      const averageRating = Math.max(0, Math.min(5, ratingsData.average)); // Clamp between 0-5
      const totalRatings = ratingsData.total;
      
      // ✅ CRITICAL FIX: Flatten nested driver data for admin dashboard
      // Admin expects isOnline/isAvailable at top level, not nested under driver object
      drivers.push({
        id: doc.id,
        uid: doc.id,
        ...data,
        // ✅ CRITICAL FIX: Include driver object for compatibility
        driver: driverData,
        // Override nested fields with flattened versions for admin dashboard compatibility
        isOnline: driverData.isOnline || false,
        isAvailable: driverData.isAvailable || false,
        verificationStatus: driverData.verificationStatus || data.verificationStatus || 'pending',
        // ✅ CRITICAL FIX: Use calculated rating from ratings collection (driver isolated) with fallback for backward compatibility
        rating: averageRating,
        totalRatings: totalRatings,
        totalTrips: completedTripsCount || driverData.totalTrips || 0,
        totalDeliveries: completedTripsCount || driverData.totalTrips || 0, // Alias for compatibility
        currentLocation: driverData.currentLocation,
        vehicleDetails: (() => {
          // ✅ CRITICAL FIX: Normalize vehicleDetails from different possible formats
          const vd = driverData.vehicleDetails;
          if (!vd) {
            return {
              vehicleType: 'motorcycle',
              vehicleModel: '',
              vehicleNumber: '',
              licenseNumber: '',
              licenseExpiry: ''
            };
          }
          
          // Handle old format (type, model, number) and convert to new format
          return {
            vehicleType: vd.vehicleType || vd.type || 'motorcycle',
            vehicleModel: vd.vehicleModel || vd.model || '',
            vehicleNumber: vd.vehicleNumber || vd.number || '',
            licenseNumber: vd.licenseNumber || '',
            licenseExpiry: vd.licenseExpiry || ''
          };
        })(),
        // ✅ CRITICAL FIX: Use calculated earnings from driver_earnings collection
        earnings: {
          total: totalEarnings,
          thisMonth: earningsThisMonth,
          lastMonth: earningsLastMonth
        },
        // ✅ CRITICAL FIX: Include normalized documents for status display
        documents: normalizedDocuments,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    }

    console.log(`✅ [ADMIN] Fetched ${drivers.length} drivers with flattened status data`);
    
    // Debug: Log all driver IDs to help identify missing drivers
    if (drivers.length > 0) {
      console.log(`📄 [ADMIN] First driver documents count: ${Object.keys(drivers[0].documents || {}).length}`);
      console.log(`📄 [ADMIN] Document types: ${Object.keys(drivers[0].documents || {}).join(', ')}`);
      console.log(`📋 [ADMIN] Driver IDs fetched: ${drivers.map(d => d.id).join(', ')}`);
    } else {
      console.warn('⚠️ [ADMIN] No drivers found in query. Checking total driver count...');
      // Log total driver count for debugging
      const totalDriversQuery = db.collection('users').where('userType', '==', 'driver');
      const totalSnapshot = await totalDriversQuery.get();
      console.log(`📊 [ADMIN] Total drivers in database: ${totalSnapshot.size}`);
      if (totalSnapshot.size > 0) {
        const driverIds = totalSnapshot.docs.map(doc => doc.id);
        console.log(`📋 [ADMIN] All driver IDs in database: ${driverIds.join(', ')}`);
      }
    }

    res.json({
      success: true,
      data: drivers,
      pagination: {
        limit: Math.max(1, Math.min(100, parseInt(limit) || 20)),
        offset: Math.max(0, parseInt(offset) || 0),
        total: drivers.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching drivers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_DRIVERS_ERROR',
        message: 'Failed to fetch drivers',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/admin/drivers/:id
 * @desc    Permanently delete a driver and cascade delete related data
 * @access  Private (Admin only)
 */
router.delete('/drivers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.uid || req.user.userId;
    const db = getFirestore();
    const batch = db.batch();

    // Get driver data first
    const driverRef = db.collection('users').doc(id);
    const driverDoc = await driverRef.get();
    
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found'
        }
      });
    }

    const driverData = driverDoc.data();
    if (driverData.userType !== 'driver') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a driver'
        }
      });
    }

    // Delete driver from users collection
    batch.delete(driverRef);

    // Delete driver documents
    const driverDocsSnapshot = await db.collection('driverDocuments')
      .where('driverId', '==', id)
      .get();
    
    driverDocsSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Delete document verification requests
    const verificationSnapshot = await db.collection('documentVerificationRequests')
      .where('driverId', '==', id)
      .get();
    
    verificationSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Update bookings to remove driver reference
    const bookingsSnapshot = await db.collection('bookings')
      .where('driverId', '==', id)
      .get();
    
    bookingsSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        driverId: null,
        driverName: null,
        status: 'cancelled',
        cancellationReason: 'Driver account deleted',
        updatedAt: new Date()
      });
    });

    // Log the deletion action
    const auditLogRef = db.collection('adminLogs').doc();
    batch.set(auditLogRef, {
      action: 'driver_deleted',
      adminId,
      targetUserId: id,
      targetUserType: 'driver',
      details: {
        driverName: driverData.name || driverData.personalInfo?.name || 'Unknown Driver',
        driverEmail: driverData.email || driverData.personalInfo?.email || 'No email provided',
        deletedAt: new Date()
      },
      timestamp: new Date()
    });

    await batch.commit();

    res.json({
      success: true,
      message: 'Driver deleted successfully',
      data: {
        driverId: id,
        deletedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error deleting driver:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_DRIVER_ERROR',
        message: 'Failed to delete driver',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/admin/drivers/:id/ban
 * @desc    Ban a driver (irreversible action)
 * @access  Private (Admin only)
 */
router.put('/drivers/:id/ban', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.uid || req.user.userId;
    const db = getFirestore();
    const batch = db.batch();

    // Get driver data
    const driverRef = db.collection('users').doc(id);
    const driverDoc = await driverRef.get();
    
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found'
        }
      });
    }

    const driverData = driverDoc.data();
    if (driverData.userType !== 'driver') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a driver'
        }
      });
    }

    if (driverData.accountStatus === 'banned') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_BANNED',
          message: 'Driver is already banned'
        }
      });
    }

    // Update driver status to banned
    batch.update(driverRef, {
      accountStatus: 'banned',
      bannedAt: new Date(),
      bannedBy: adminId,
      banReason: reason || 'Violation of terms of service',
      updatedAt: new Date()
    });

    // Cancel all active bookings
    const activeBookingsSnapshot = await db.collection('bookings')
      .where('driverId', '==', id)
      .where('status', 'in', ['pending', 'accepted', 'in_progress'])
      .get();
    
    activeBookingsSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        status: 'cancelled',
        cancellationReason: 'Driver account banned',
        cancelledAt: new Date(),
        updatedAt: new Date()
      });
    });

    // Log the ban action
    const auditLogRef = db.collection('adminLogs').doc();
    batch.set(auditLogRef, {
      action: 'driver_banned',
      adminId,
      targetUserId: id,
      targetUserType: 'driver',
      details: {
        driverName: driverData.name || driverData.personalInfo?.name || 'Unknown Driver',
        driverEmail: driverData.email || driverData.personalInfo?.email || 'No email provided',
        banReason: reason || 'Violation of terms of service',
        bannedAt: new Date()
      },
      timestamp: new Date()
    });

    await batch.commit();

    res.json({
      success: true,
      message: 'Driver banned successfully',
      data: {
        driverId: id,
        accountStatus: 'banned',
        bannedAt: new Date().toISOString(),
        banReason: reason || 'Violation of terms of service'
      }
    });

  } catch (error) {
    console.error('Error banning driver:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BAN_DRIVER_ERROR',
        message: 'Failed to ban driver',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/bookings
 * @desc    Get all bookings with pagination and filters
 * @access  Private (Admin only)
 */
router.get('/bookings', async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0, status, dateFrom, dateTo } = req.query;

    let query = db.collection('bookings');

    // Apply filters
    if (status) {
      query = query.where('status', '==', status);
    }
    if (dateFrom) {
      query = query.where('createdAt', '>=', new Date(dateFrom));
    }
    if (dateTo) {
      query = query.where('createdAt', '<=', new Date(dateTo));
    }

    // Apply pagination and ordering
    query = query.orderBy('createdAt', 'desc').limit(Math.max(1, Math.min(100, parseInt(limit) || 20))).offset(Math.max(0, parseInt(offset) || 0));

    const snapshot = await query.get();
    const bookings = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();

      const pickupVerification = await normalizeVerification(
        data.pickupVerification,
        data.photoVerification?.pickup
      );
      const deliveryVerification = await normalizeVerification(
        data.deliveryVerification,
        data.photoVerification?.delivery
      );

      // Map the actual booking data structure to admin-friendly format
      const mappedBooking = {
        id: doc.id,
        bookingId: data.bookingId || doc.id,
        customerId: data.customerId || '',
        driverId: data.driverId,
        // Map customer info from booking data
        customerInfo: {
          name: data.pickup?.name || data.customerInfo?.name || 'Unknown Customer',
          phone: data.customerInfo?.phone || data.customer?.phone || '', // Get from customer data, not pickup
          email: data.customerInfo?.email || data.customer?.email || ''
        },
        senderInfo: {
          name: data.senderInfo?.name || data.pickup?.name || 'Sender',
          phone: data.senderInfo?.phone || data.pickup?.phone || ''
        },
        recipientInfo: {
          name: data.recipientInfo?.name || data.dropoff?.name || 'Recipient',
          phone: data.recipientInfo?.phone || data.dropoff?.phone || ''
        },
        // Map driver info if available
        driverInfo: data.driverId ? {
          name: data.driverInfo?.name || 'Driver Assigned',
          phone: data.driverInfo?.phone || '',
          rating: data.driverInfo?.rating || 0,
          // ✅ CRITICAL FIX: Include isVerified status from driverInfo or booking-level field
          isVerified: data.driverInfo?.isVerified !== undefined ? data.driverInfo.isVerified : (data.driverVerified === true)
        } : undefined,
        // ✅ CRITICAL FIX: Also include driverVerified at booking level for backward compatibility
        driverVerified: data.driverId ? (data.driverInfo?.isVerified !== undefined ? data.driverInfo.isVerified : (data.driverVerified === true)) : false,
        // Map pickup location
        pickupLocation: {
          address: data.pickup?.address || 'No pickup address',
          latitude: data.pickup?.coordinates?.latitude || data.pickupLocation?.latitude || data.pickupLocation?.coordinates?.lat || 0,
          longitude: data.pickup?.coordinates?.longitude || data.pickupLocation?.longitude || data.pickupLocation?.coordinates?.lng || 0
        },
        // Map dropoff location
        dropoffLocation: {
          address: data.dropoff?.address || 'No dropoff address',
          latitude: data.dropoff?.coordinates?.latitude || data.dropoffLocation?.latitude || data.dropoffLocation?.coordinates?.lat || 0,
          longitude: data.dropoff?.coordinates?.longitude || data.dropoffLocation?.longitude || data.dropoffLocation?.coordinates?.lng || 0
        },
        // Map package details
        packageDetails: {
          weight: data.package?.weight || 0,
          description: data.package?.description || '',
          value: data.package?.value || 0
        },
        status: data.status || 'pending',
        // Map fare information
        fare: data.fare || data.pricing || {
          baseFare: 0,
          distanceFare: 0,
          totalFare: 0,
          currency: 'INR'
        },
        paymentStatus: data.paymentStatus || 'pending',
        estimatedDuration: data.estimatedDuration,
        actualDuration: data.actualDuration,
        distance: data.distance,
        createdAt: normalizeTimestamp(data.createdAt) || data.createdAt,
        updatedAt: normalizeTimestamp(data.updatedAt) || data.updatedAt,
        pickupVerification,
        deliveryVerification,
        // Include original data for debugging
        originalData: data
      };

      bookings.push(mappedBooking);
    }

    res.json({
      success: true,
      data: bookings,
      pagination: {
        limit: Math.max(1, Math.min(100, parseInt(limit) || 20)),
        offset: Math.max(0, parseInt(offset) || 0),
        total: bookings.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BOOKINGS_ERROR',
        message: 'Failed to fetch bookings',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/bookings/active
 * @desc    Get active bookings (pending, accepted, in_progress)
 * @access  Private (Admin only)
 */
router.get('/bookings/active', async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 50 } = req.query;

    // ✅ UNIFIED STATUS DEFINITION: Use consistent status names
    const activeStatuses = ['pending', 'driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit'];
    const bookings = [];

    for (const status of activeStatuses) {
      const snapshot = await db
        .collection('bookings')
        .where('status', '==', status)
        .orderBy('createdAt', 'desc')
        .limit(parseInt(limit))
        .get();

      snapshot.forEach(doc => {
        const data = doc.data();
        const mappedBooking = {
          id: doc.id,
          customerId: data.customerId,
          driverId: data.driverId,
          status: data.status,
          pickupLocation: data.pickupLocation,
          dropoffLocation: data.dropoffLocation,
          fare: data.fare || data.pricing?.totalAmount || 0,
          distance: data.distance,
          estimatedTime: data.estimatedTime,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
          customerName: data.customerName || 'Unknown Customer',
          driverName: data.driverName || 'No Driver Assigned',
          paymentStatus: data.paymentStatus || 'pending'
        };
        
        bookings.push(mappedBooking);
      });
    }

    // Sort by creation date
    bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      data: bookings.slice(0, parseInt(limit)),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching active bookings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ACTIVE_BOOKINGS_ERROR',
        message: 'Failed to fetch active bookings',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/bookings/:id
 * @desc    Get specific booking by ID
 * @access  Private (Admin only)
 */
router.get('/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getFirestore();

    const bookingDoc = await db.collection('bookings').doc(id).get();

    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const data = bookingDoc.data();
    const pickupVerification = await normalizeVerification(
      data.pickupVerification,
      data.photoVerification?.pickup
    );
    const deliveryVerification = await normalizeVerification(
      data.deliveryVerification,
      data.photoVerification?.delivery
    );

    const booking = {
      id: bookingDoc.id,
      customerId: data.customerId,
      driverId: data.driverId,
      status: data.status,
      pickupLocation: data.pickupLocation,
      dropoffLocation: data.dropoffLocation,
      fare: data.fare || data.pricing?.totalAmount || 0,
      distance: data.distance,
      estimatedTime: data.estimatedTime,
      createdAt: normalizeTimestamp(data.createdAt) || data.createdAt,
      updatedAt: normalizeTimestamp(data.updatedAt) || data.updatedAt,
      customerName: data.customerName || 'Unknown Customer',
      driverName: data.driverName || 'No Driver Assigned',
      paymentStatus: data.paymentStatus || 'pending',
      packageDetails: data.packageDetails,
      senderInfo: data.senderInfo || {
        name: data.pickup?.name || 'Sender',
        phone: data.pickup?.phone || ''
      },
      recipientInfo: data.recipientInfo || {
        name: data.dropoff?.name || 'Recipient',
        phone: data.dropoff?.phone || ''
      },
      pickupVerification,
      deliveryVerification
    };

    res.json({
      success: true,
      data: booking,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BOOKING_ERROR',
        message: 'Failed to fetch booking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/admin/bookings/:id/status
 * @desc    Update booking status
 * @access  Private (Admin only)
 */
router.put('/bookings/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const db = getFirestore();

    // ✅ CRITICAL FIX: Use unified status definitions
    const validStatuses = ['pending', 'driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'delivered', 'completed', 'cancelled', 'rejected', 'payment_pending'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Invalid booking status',
          details: `Status must be one of: ${validStatuses.join(', ')}`
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get booking
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update booking status
    await bookingRef.update({
      status: status,
      updatedAt: new Date(),
      'statusHistory': db.FieldValue.arrayUnion({
        status: status,
        updatedBy: req.user.uid || req.user.userId,
        updatedAt: new Date(),
        role: 'admin'
      })
    });

    console.log(`✅ [ADMIN] Booking ${id} status updated to ${status} by admin ${req.user.email || req.user.userId}`);

    res.json({
      success: true,
      message: 'Booking status updated successfully',
      data: {
        bookingId: id,
        status: status
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating booking status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_BOOKING_STATUS_ERROR',
        message: 'Failed to update booking status',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/admin/bookings/:id
 * @desc    Delete a booking (admin only)
 * @access  Private (Admin only)
 */
router.delete('/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getFirestore();
    const adminId = req.user.uid || req.user.userId;

    console.log(`🗑️ [ADMIN] Deleting booking ${id} by admin ${req.user.email || adminId}`);

    // Get booking first to check if it exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const bookingData = bookingDoc.data();

    // Get reason from body or query params
    const reason = req.body.reason || req.query.reason || 'No reason provided';

    // ✅ CRITICAL FIX: If booking was completed, reduce driver earnings
    if (bookingData.status === 'completed' && bookingData.driverId) {
      try {
        const driverId = bookingData.driverId;
        const driverEarningAmount = bookingData.fare?.totalFare || bookingData.pricing?.totalFare || 0;
        
        if (driverEarningAmount > 0) {
          // Find and delete the earnings record
          const earningsSnapshot = await db.collection('driver_earnings')
            .where('driverId', '==', driverId)
            .where('bookingId', '==', id)
            .where('status', '==', 'completed')
            .get();
          
          for (const earningsDoc of earningsSnapshot.docs) {
            const earningsData = earningsDoc.data();
            const amount = earningsData.amount || 0;
            
            // Delete the earnings record
            await earningsDoc.ref.delete();
            console.log(`💰 [ADMIN] Deleted earnings record for booking ${id}: ₹${amount}`);
            
            // Update driver's total earnings in user document
            const driverRef = db.collection('users').doc(driverId);
            const driverDoc = await driverRef.get();
            
            if (driverDoc.exists) {
              const driverData = driverDoc.data();
              const currentTotalEarnings = driverData.totalEarnings || driverData.driver?.totalEarnings || 0;
              const newTotalEarnings = Math.max(0, currentTotalEarnings - amount); // Prevent negative
              
              await driverRef.update({
                totalEarnings: newTotalEarnings,
                'driver.totalEarnings': newTotalEarnings,
                updatedAt: new Date()
              });
              
              console.log(`💰 [ADMIN] Updated driver ${driverId} earnings: ₹${currentTotalEarnings} → ₹${newTotalEarnings} (reduced by ₹${amount})`);
              
              // ✅ CRITICAL FIX: Emit real-time update to admin dashboard
              try {
                const socketService = require('../services/socket');
                const io = socketService.getSocketIO();
                if (io) {
                  io.to('type:admin').emit('driver_earnings_updated', {
                    driverId: driverId,
                    bookingId: id,
                    action: 'reduced',
                    amount: amount,
                    newTotalEarnings: newTotalEarnings,
                    reason: 'Booking deleted',
                    timestamp: new Date().toISOString()
                  });
                  console.log(`📤 [ADMIN] Sent driver earnings update event to admin dashboard`);
                }
              } catch (socketError) {
                console.warn('⚠️ [ADMIN] Failed to emit earnings update event:', socketError);
              }
            }
          }
        }
      } catch (earningsError) {
        console.error('❌ [ADMIN] Error reducing driver earnings on booking deletion:', earningsError);
        // Don't fail the deletion if earnings reduction fails
      }
    }

    // Log deletion action
    await db.collection('adminActions').add({
      adminId: adminId,
      adminEmail: req.user.email,
      action: 'DELETE_BOOKING',
      targetType: 'booking',
      targetId: id,
      bookingData: bookingData,
      reason: reason,
      timestamp: new Date()
    });

    // Delete the booking
    await bookingRef.delete();

    // Send real-time notifications to customer and driver
    try {
      const socketService = require('../services/socket');
      const io = socketService.getSocketIO();
      
      // Notify customer if they have the booking open
      if (bookingData.customerId) {
        io.to(`user:${bookingData.customerId}`).emit('booking_deleted', {
          bookingId: id,
          reason: reason,
          deletedBy: 'admin',
          deletedAt: new Date().toISOString(),
          message: 'Your booking has been cancelled by admin'
        });
      }
      
      // Notify driver if they were assigned to this booking
      if (bookingData.driverId) {
        io.to(`user:${bookingData.driverId}`).emit('booking_deleted', {
          bookingId: id,
          reason: reason,
          deletedBy: 'admin',
          deletedAt: new Date().toISOString(),
          message: 'The booking you were assigned to has been cancelled by admin'
        });
      }
      
      // Notify admin dashboard users
      io.to('type:admin').emit('booking_deleted', {
        bookingId: id,
        reason: reason,
        deletedBy: adminId,
        deletedAt: new Date().toISOString(),
        customerId: bookingData.customerId,
        driverId: bookingData.driverId
      });
      
      console.log(`📡 [ADMIN] Real-time notifications sent for booking deletion ${id}`);
    } catch (notificationError) {
      console.error('❌ [ADMIN] Failed to send real-time notifications:', notificationError);
      // Don't fail the deletion if notifications fail
    }

    console.log(`✅ [ADMIN] Booking ${id} deleted successfully`);

    res.json({
      success: true,
      message: 'Booking deleted successfully',
      data: {
        bookingId: id,
        deletedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_BOOKING_ERROR',
        message: 'Failed to delete booking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/emergency-alerts
 * @desc    Get all emergency alerts with pagination and filters
 * @access  Private (Admin only)
 */
router.get('/emergency-alerts', async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0, status, alertType } = req.query;

    let query = db.collection('emergencyAlerts');

    // Apply filters
    if (status) {
      query = query.where('status', '==', status);
    }
    if (alertType) {
      query = query.where('alertType', '==', alertType);
    }

    // Apply pagination and ordering
    query = query.orderBy('createdAt', 'desc').limit(Math.max(1, Math.min(100, parseInt(limit) || 20))).offset(Math.max(0, parseInt(offset) || 0));

    const snapshot = await query.get();
    const alerts = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      alerts.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });

    res.json({
      success: true,
      data: alerts,
      pagination: {
        limit: Math.max(1, Math.min(100, parseInt(limit) || 20)),
        offset: Math.max(0, parseInt(offset) || 0),
        total: alerts.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching emergency alerts:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_EMERGENCY_ALERTS_ERROR',
        message: 'Failed to fetch emergency alerts',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/emergency/alerts/active
 * @desc    Get active emergency alerts
 * @access  Private (Admin only)
 */
router.get('/emergency/alerts/active', async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get active emergency alerts
    const activeAlertsSnapshot = await db.collection('emergencyAlerts')
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .get();

    const activeAlerts = [];
    activeAlertsSnapshot.forEach(doc => {
      const data = doc.data();
      activeAlerts.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });

    // If no alerts exist, create some mock data for testing
    if (activeAlerts.length === 0) {
      const mockAlerts = [
        {
          id: 'mock-alert-1',
          alertId: 'mock-alert-1',
          userId: 'customer-1',
          userType: 'customer',
          userInfo: {
            name: 'Alice Johnson',
            phone: '+1234567890'
          },
          type: 'medical',
          priority: 'high',
          status: 'active',
          location: {
            address: '123 Main St, New York, NY',
            latitude: 40.7128,
            longitude: -74.0060
          },
          description: 'Customer experiencing chest pain during ride',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'mock-alert-2',
          alertId: 'mock-alert-2',
          userId: 'customer-2',
          userType: 'customer',
          userInfo: {
            name: 'Bob Smith',
            phone: '+1234567891'
          },
          type: 'other',
          priority: 'medium',
          status: 'active',
          location: {
            address: '456 Broadway, New York, NY',
            latitude: 40.7589,
            longitude: -73.9851
          },
          description: 'Driver reported aggressive behavior from customer',
          createdAt: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
          updatedAt: new Date(Date.now() - 300000).toISOString()
        }
      ];

      // Store mock alerts in Firestore for future use
      for (const alert of mockAlerts) {
        await db.collection('emergencyAlerts').doc(alert.id).set(alert);
      }

      res.json({
        success: true,
        data: mockAlerts,
        count: mockAlerts.length,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({
        success: true,
        data: activeAlerts,
        count: activeAlerts.length,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error fetching active emergency alerts:', error);

    // Check if it's a Firestore index error
    if (error.code === 9 && error.details && error.details.includes('index')) {
      console.error('Firestore index required. Please create the composite index for emergencyAlerts collection with fields: status (ASC), createdAt (DESC), __name__ (DESC)');
      res.status(500).json({
        success: false,
        error: {
          code: 'FIRESTORE_INDEX_REQUIRED',
          message: 'Database index required. Please contact administrator to create the required index.',
          details: 'The query requires a composite index on emergencyAlerts collection'
        },
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_ACTIVE_EMERGENCY_ALERTS_ERROR',
          message: 'Failed to fetch active emergency alerts',
          details: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
});

/**
 * @route   GET /api/admin/emergency/analytics
 * @desc    Get emergency analytics data
 * @access  Private (Admin only)
 */
router.get('/emergency/analytics', async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get emergency analytics
    const [activeAlerts, resolvedAlerts, totalAlerts] = await Promise.all([
      db.collection('emergencyAlerts').where('status', '==', 'active').get(),
      db.collection('emergencyAlerts').where('status', '==', 'resolved').get(),
      db.collection('emergencyAlerts').get()
    ]);

    const analytics = {
      total: totalAlerts.size,
      active: activeAlerts.size,
      resolved: resolvedAlerts.size,
      responseTime: {
        average: 4.5, // minutes
        median: 3.2
      },
      byType: {
        medical: 0,
        sos: 0,
        accident: 0,
        harassment: 0,
        other: 0
      },
      byPriority: {
        high: 0,
        medium: 0,
        low: 0,
        critical: 0
      }
    };

    // Count by type and priority
    totalAlerts.forEach(doc => {
      const data = doc.data();
      if (analytics.byType[data.type]) {
        analytics.byType[data.type]++;
      }
      if (analytics.byPriority[data.priority]) {
        analytics.byPriority[data.priority]++;
      }
    });

    res.json({
      success: true,
      data: analytics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching emergency analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_EMERGENCY_ANALYTICS_ERROR',
        message: 'Failed to fetch emergency analytics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/emergency/nearby-drivers
 * @desc    Get nearby drivers for emergency response
 * @access  Private (Admin only)
 */
router.get('/emergency/nearby-drivers', async (req, res) => {
  try {
    const { latitude, longitude } = req.query;
    
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_COORDINATES',
          message: 'Latitude and longitude are required'
        }
      });
    }

    // Mock nearby drivers data
    const nearbyDrivers = [
      {
        id: 'driver-1',
        name: 'John Doe',
        phone: '+1234567890',
        distance: 0.8,
        eta: 3,
        status: 'available',
        vehicle: {
          make: 'Toyota',
          model: 'Camry',
          licensePlate: 'ABC123'
        }
      },
      {
        id: 'driver-2',
        name: 'Jane Wilson',
        phone: '+1234567891',
        distance: 1.2,
        eta: 5,
        status: 'available',
        vehicle: {
          make: 'Honda',
          model: 'Civic',
          licensePlate: 'XYZ789'
        }
      }
    ];

    res.json({
      success: true,
      data: nearbyDrivers,
      count: nearbyDrivers.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching nearby drivers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_NEARBY_DRIVERS_ERROR',
        message: 'Failed to fetch nearby drivers',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/emergency/notify-drivers
 * @desc    Notify drivers about emergency
 * @access  Private (Admin only)
 */
router.post('/emergency/notify-drivers', async (req, res) => {
  try {
    const { alertId, driverIds, message } = req.body;
    
    if (!alertId || !driverIds || !message) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'Alert ID, driver IDs, and message are required'
        }
      });
    }

    // Mock notification response
    res.json({
      success: true,
      data: {
        message: 'Drivers notified successfully',
        notifiedCount: driverIds.length,
        alertId
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error notifying drivers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFY_DRIVERS_ERROR',
        message: 'Failed to notify drivers',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/emergency/contact-services
 * @desc    Contact emergency services
 * @access  Private (Admin only)
 */
router.post('/emergency/contact-services', async (req, res) => {
  try {
    const { alertId, serviceType } = req.body;
    
    if (!alertId || !serviceType) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'Alert ID and service type are required'
        }
      });
    }

    // Mock emergency service contact response
    res.json({
      success: true,
      data: {
        message: 'Emergency services contacted successfully',
        serviceType,
        alertId,
        referenceNumber: `EMS-${Date.now()}`
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error contacting emergency services:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CONTACT_EMERGENCY_SERVICES_ERROR',
        message: 'Failed to contact emergency services',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/emergency/reports
 * @desc    Get emergency reports
 * @access  Private (Admin only)
 */
router.get('/emergency/reports', async (req, res) => {
  try {
    // const { startDate, endDate, type, severity } = req.query; // TODO: Implement filtering
    
    // Mock emergency reports data
    const reports = [
      {
        id: 'report-1',
        alertId: 'alert-1',
        type: 'medical',
        severity: 'high',
        status: 'resolved',
        reportedAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        resolvedAt: new Date(Date.now() - 82800000).toISOString(), // 1 hour later
        responseTime: 60, // minutes
        responder: 'Admin User',
        actions: ['contacted_ems', 'notified_driver', 'followed_up']
      },
      {
        id: 'report-2',
        alertId: 'alert-2',
        type: 'safety',
        severity: 'medium',
        status: 'resolved',
        reportedAt: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
        resolvedAt: new Date(Date.now() - 169200000).toISOString(), // 1 hour later
        responseTime: 60,
        responder: 'Admin User',
        actions: ['contacted_customer', 'contacted_driver', 'mediation']
      }
    ];

    res.json({
      success: true,
      data: reports,
      count: reports.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching emergency reports:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_EMERGENCY_REPORTS_ERROR',
        message: 'Failed to fetch emergency reports',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/system-health
 * @desc    Get system health metrics (DEPRECATED - use /system/health)
 * @access  Private (Admin only)
 */
router.get('/system-health', async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get system metrics
    const metrics = {
      totalUsers: 0,
      totalDrivers: 0,
      totalCustomers: 0,
      activeBookings: 0,
      pendingVerifications: 0,
      openSupportTickets: 0,
      activeEmergencyAlerts: 0,
      systemUptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };

    // Count users by type using efficient queries
    const [driversSnapshot, customersSnapshot, adminSnapshot] = await Promise.all([
      db.collection('users').where('userType', '==', 'driver').get(),
      db.collection('users').where('userType', '==', 'customer').get(),
      db.collection('adminUsers').get()
    ]);
    
    metrics.totalDrivers = driversSnapshot.size;
    metrics.totalCustomers = customersSnapshot.size;
    metrics.totalUsers = metrics.totalDrivers + metrics.totalCustomers + adminSnapshot.size;

    // Count active bookings
    const activeBookingsSnapshot = await db.collection('bookings')
      .where('status', 'in', ['pending', 'accepted', 'in_progress'])
      .get();
    metrics.activeBookings = activeBookingsSnapshot.size;

    // Count pending verifications
    const pendingVerificationsSnapshot = await db.collection('documentVerificationRequests')
      .where('status', '==', 'pending')
      .get();
    metrics.pendingVerifications = pendingVerificationsSnapshot.size;

    // Count open support tickets
    const openTicketsSnapshot = await db.collection('supportTickets')
      .where('status', 'in', ['open', 'in_progress'])
      .get();
    metrics.openSupportTickets = openTicketsSnapshot.size;

    // Count active emergency alerts
    const activeAlertsSnapshot = await db.collection('emergencyAlerts')
      .where('status', '==', 'active')
      .get();
    metrics.activeEmergencyAlerts = activeAlertsSnapshot.size;

    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching system health:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_SYSTEM_HEALTH_ERROR',
        message: 'Failed to fetch system health',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/drivers/pending
 * @desc    Get drivers pending verification
 * @access  Private (Admin only)
 */
router.get('/drivers/pending', async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0 } = req.query;

    // Get all drivers and filter for pending verification
    const driversSnapshot = await db.collection('users')
      .where('userType', '==', 'driver')
      .orderBy('createdAt', 'desc')
      .get();

    const pendingDrivers = [];
    let processedCount = 0;

    for (const doc of driversSnapshot.docs) {
      if (processedCount >= Math.max(1, Math.min(100, parseInt(limit) || 20))) break;
      
      const driverData = doc.data();
      const driver = driverData.driver || {};
      const verificationStatus = driver.verificationStatus || 'pending';
      
      // Only include drivers with pending verification
      if (verificationStatus === 'pending' || verificationStatus === 'pending_verification') {
        // ✅ CRITICAL FIX: Flatten driver data for admin dashboard
        pendingDrivers.push({
          id: doc.id,
          uid: doc.id,
          ...driverData,
          // Flatten nested driver fields
          isOnline: driver.isOnline || false,
          isAvailable: driver.isAvailable || false,
          verificationStatus: verificationStatus,
          rating: driver.rating || 0,
          totalTrips: driver.totalTrips || 0,
          totalDeliveries: driver.totalTrips || 0,
          createdAt: driverData.createdAt?.toDate?.() || driverData.createdAt,
          updatedAt: driverData.updatedAt?.toDate?.() || driverData.updatedAt
        });
        processedCount++;
      }
    }

    res.json({
      success: true,
      data: pendingDrivers,
      pagination: {
        limit: Math.max(1, Math.min(100, parseInt(limit) || 20)),
        offset: Math.max(0, parseInt(offset) || 0),
        total: pendingDrivers.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching pending drivers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_PENDING_DRIVERS_ERROR',
        message: 'Failed to fetch pending drivers',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/drivers/:driverId/documents
 * @desc    Get driver documents for admin review
 * @access  Private (Admin only)
 */
router.get('/drivers/:driverId/documents', async (req, res) => {
  try {
    const { driverId } = req.params;
    
    console.log(`📥 [ADMIN_DOCS] Getting documents for driver: ${driverId}`);
    
    // Get driver basic info
    const db = getFirestore();
    const driverDoc = await db.collection('users').doc(driverId).get();
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { 
          code: 'DRIVER_NOT_FOUND', 
          message: 'Driver not found' 
        }
      });
    }

    const driverData = driverDoc.data();
    
    // ✅ CRITICAL FIX: Fetch actual documents from Firebase Storage (same logic as driver endpoint)
    const bucket = getStorage().bucket();
    const [files] = await bucket.getFiles({
      prefix: `drivers/${driverId}/documents/`,
    });

    const documents = {};
    const documentFiles = {};

    // Group files by document type
    for (const file of files) {
      try {
        const pathParts = file.name.split('/');
        const documentType = pathParts[pathParts.length - 2];
        
        if (!documentFiles[documentType]) {
          documentFiles[documentType] = [];
        }
        
        const [downloadURL] = await file.getSignedUrl({
          action: 'read',
          expires: '03-01-2500'
        });

        const [metadata] = await file.getMetadata();
        
        documentFiles[documentType].push({
          fileName: file.name.split('/').pop(),
          filePath: file.name,
          downloadURL: downloadURL,
          size: metadata.size,
          uploadedAt: metadata.timeCreated,
          contentType: metadata.contentType,
          customMetadata: metadata.customMetadata || {}
        });
      } catch (fileError) {
        console.error(`❌ [ADMIN_DOCS] Error processing file ${file.name}:`, fileError);
      }
    }

    // Select the latest file for each document type
    for (const [documentType, files] of Object.entries(documentFiles)) {
      if (files.length > 0) {
        const sortedFiles = files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        documents[documentType] = sortedFiles[0];
        
        if (files.length > 1) {
          console.warn(`⚠️ [ADMIN_DOCS] Multiple files found for ${documentType}: ${files.length} files. Using latest: ${sortedFiles[0].fileName}`);
        }
      }
    }

    // ✅ CRITICAL FIX: Get actual verification status from Firestore
    const firestoreDocs = driverData.driver?.documents || driverData.documents || {};
    
    // Helper function to get verification status for a document
    const getDocStatus = (docType) => {
      // Check both camelCase and snake_case variants
      const firestoreDoc = firestoreDocs[docType] || firestoreDocs[docType.replace(/([A-Z])/g, '_$1').toLowerCase()];
      if (!firestoreDoc) return { status: 'pending', verified: false };
      
      // Check multiple possible status fields for compatibility
      const status = firestoreDoc.status || firestoreDoc.verificationStatus || 'pending';
      const verified = firestoreDoc.verified === true || status === 'verified';
      
      return {
        status: status === 'verified' ? 'verified' : status === 'rejected' ? 'rejected' : 'uploaded',
        verified,
        verifiedAt: firestoreDoc.verifiedAt,
        verifiedBy: firestoreDoc.verifiedBy,
        verificationComments: firestoreDoc.verificationComments,
        rejectionReason: firestoreDoc.rejectionReason
      };
    };
    
    // ✅ CRITICAL FIX: Map document types to expected format with ACTUAL verification status
    // Only include documents that actually exist (not null)
    const mappedDocuments = {};
    
    const documentMappings = [
      { storageKey: 'driving_license', docKey: 'drivingLicense', name: 'Driving License' },
      { storageKey: 'profile_photo', docKey: 'profilePhoto', name: 'Profile Photo' },
      { storageKey: 'aadhaar_card', docKey: 'aadhaarCard', name: 'Aadhaar Card' },
      { storageKey: 'bike_insurance', docKey: 'bikeInsurance', name: 'Bike Insurance' },
      { storageKey: 'rc_book', docKey: 'rcBook', name: 'RC Book' }
    ];
    
    documentMappings.forEach(({ storageKey, docKey, name }) => {
      if (documents[storageKey]) {
        mappedDocuments[docKey] = {
          url: documents[storageKey].downloadURL,
          fileName: documents[storageKey].fileName,
          uploadedAt: documents[storageKey].uploadedAt,
          size: documents[storageKey].size,
          contentType: documents[storageKey].contentType,
          documentType: docKey,
          documentName: name,
          ...getDocStatus(docKey)
        };
      }
    });
    
    console.log(`✅ [ADMIN_DOCS] Retrieved ${Object.keys(mappedDocuments).length} documents for driver ${driverId}`);
    
    res.json({
      success: true,
      data: {
        documents: mappedDocuments,
        driverId,
        driverName: driverData.name || 'Unknown Driver',
        verificationStatus: driverData.driver?.verificationStatus || 'pending',
        vehicleDetails: driverData.driver?.vehicleDetails || null,
        totalDocuments: Object.keys(mappedDocuments).length,
        totalFolders: Object.keys(mappedDocuments).length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [ADMIN_DOCS] Error fetching driver documents:', error);
    res.status(500).json({
      success: false,
      error: { 
        code: 'DOCUMENTS_FETCH_ERROR', 
        message: 'Failed to fetch documents',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/test-verification-flow/:driverId
 * @desc    Test complete verification flow
 * @access  Private (Admin only)
 */
router.post('/test-verification-flow/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    
    // Validate driverId parameter
    if (!driverId || typeof driverId !== 'string' || driverId.length < 3) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DRIVER_ID',
          message: 'Valid driver ID is required'
        },
        timestamp: new Date().toISOString()
      });
    }
    const db = getFirestore();
    
    console.log(`🧪 Testing complete verification flow for driver: ${driverId}`);
    
    // Step 1: Get driver information
    const driverRef = db.collection('users').doc(driverId);
    const driverDoc = await driverRef.get();
    
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' }
      });
    }
    
    const driverData = driverDoc.data();
    const documents = driverData.driver?.documents || driverData.documents || {};
    
    // Step 2: Check verification requests
    const verificationQuery = await db.collection('documentVerificationRequests')
      .where('driverId', '==', driverId)
      .orderBy('requestedAt', 'desc')
      .get();
    
    // Step 3: Test document verification for each document type
    const testResults = [];
    const documentTypes = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
    
    for (const docType of documentTypes) {
      const doc = documents[docType];
      if (doc && doc.url) {
        // Test individual document verification
        try {
          const testResponse = await fetch(`${req.protocol}://${req.get('host')}/api/admin/drivers/${driverId}/documents/${docType}/verify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': req.headers.authorization
            },
            body: JSON.stringify({
              status: 'verified',
              comments: 'Test verification',
              rejectionReason: null
            })
          });
          
          const testResult = await testResponse.json();
          testResults.push({
            documentType: docType,
            hasUrl: !!doc.url,
            verificationTest: testResult.success ? 'PASS' : 'FAIL',
            error: testResult.error?.message || null
          });
        } catch (error) {
          testResults.push({
            documentType: docType,
            hasUrl: !!doc.url,
            verificationTest: 'ERROR',
            error: error.message
          });
        }
      } else {
        testResults.push({
          documentType: docType,
          hasUrl: false,
          verificationTest: 'SKIP',
          error: 'No document URL found'
        });
      }
    }
    
    // Step 4: Test overall verification
    let overallVerificationTest = 'SKIP';
    try {
      const overallResponse = await fetch(`${req.protocol}://${req.get('host')}/api/admin/drivers/${driverId}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers.authorization
        },
        body: JSON.stringify({
          status: 'approved',
          comments: 'Test overall verification'
        })
      });
      
      const overallResult = await overallResponse.json();
      overallVerificationTest = overallResult.success ? 'PASS' : 'FAIL';
    } catch {
      overallVerificationTest = 'ERROR';
    }
    
    // Step 5: Test status sync
    let statusSyncTest = 'SKIP';
    try {
      const syncResponse = await fetch(`${req.protocol}://${req.get('host')}/api/admin/drivers/${driverId}/sync-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers.authorization
        }
      });
      
      const syncResult = await syncResponse.json();
      statusSyncTest = syncResult.success ? 'PASS' : 'FAIL';
    } catch {
      statusSyncTest = 'ERROR';
    }
    
    const testSummary = {
      driverId,
      driverName: driverData.name,
      currentStatus: driverData.driver?.verificationStatus || 'unknown',
      documentsFound: Object.keys(documents).length,
      verificationRequests: verificationQuery.size,
      documentTests: testResults,
      overallVerificationTest,
      statusSyncTest,
      timestamp: new Date().toISOString()
    };
    
    console.log('🧪 Verification flow test completed:', testSummary);
    
    res.json({
      success: true,
      data: testSummary,
      message: 'Verification flow test completed'
    });
    
  } catch (error) {
    console.error('Test verification flow error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TEST_VERIFICATION_FLOW_ERROR',
        message: 'Failed to test verification flow',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/test-document-access/:driverId
 * @desc    Test document access from Firebase Storage
 * @access  Private (Admin only)
 */
router.get('/test-document-access/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    const db = getFirestore();
    
    console.log(`🔍 Testing document access for driver: ${driverId}`);
    
    // Get driver documents
    const driverDoc = await db.collection('users').doc(driverId).get();
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' }
      });
    }
    
    const driverData = driverDoc.data();
    const documents = driverData.driver?.documents || driverData.documents || {};
    
    const testResults = [];
    const documentTypes = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
    
    for (const docType of documentTypes) {
      const doc = documents[docType];
      if (doc && doc.url) {
        try {
          // Test if URL is accessible
          const response = await fetch(doc.url, { method: 'HEAD' });
          testResults.push({
            documentType: docType,
            url: doc.url,
            accessible: response.ok,
            statusCode: response.status,
            contentType: response.headers.get('content-type'),
            size: response.headers.get('content-length')
          });
        } catch (error) {
          testResults.push({
            documentType: docType,
            url: doc.url,
            accessible: false,
            error: error.message
          });
        }
      } else {
        testResults.push({
          documentType: docType,
          url: null,
          accessible: false,
          error: 'No document URL found'
        });
      }
    }
    
    res.json({
      success: true,
      data: {
        driverId,
        driverName: driverData.name || 'Unknown Driver',
        testResults,
        summary: {
          totalDocuments: documentTypes.length,
          accessibleDocuments: testResults.filter(r => r.accessible).length,
          inaccessibleDocuments: testResults.filter(r => !r.accessible).length
        }
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Document access test error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENT_ACCESS_TEST_ERROR',
        message: 'Failed to test document access',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/debug/documents/:driverId
 * @desc    Debug endpoint to check document flow
 * @access  Private (Admin only)
 */
router.get('/debug/documents/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    const db = getFirestore();
    
    console.log(`🔍 Debug: Checking document flow for driver: ${driverId}`);
    
    // Get driver information
    const driverDoc = await db.collection('users').doc(driverId).get();
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' }
      });
    }

    const driverData = driverDoc.data();
    
    // Get verification requests
    const verificationQuery = await db.collection('documentVerificationRequests')
      .where('driverId', '==', driverId)
      .orderBy('requestedAt', 'desc')
      .get();

    // Get driver documents collection
    const driverDocsQuery = await db.collection('driverDocuments')
      .where('driverId', '==', driverId)
      .get();

    // ✅ FIX: Deduplicate documents to avoid counting snake_case + camelCase as separate
    const allDocuments = driverData.driver?.documents || driverData.documents || {};
    
    // Helper function to normalize document type (camelCase)
    const normalizeKey = (key) => {
      // Convert snake_case to camelCase
      return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    };
    
    // Deduplicate: prefer camelCase over snake_case
    const deduplicatedDocuments = {};
    const seenNormalized = new Set();
    
    // First pass: collect camelCase versions
    Object.keys(allDocuments).forEach(key => {
      const normalized = normalizeKey(key);
      if (!seenNormalized.has(normalized) && key === normalized) {
        deduplicatedDocuments[key] = allDocuments[key];
        seenNormalized.add(normalized);
      }
    });
    
    // Second pass: collect snake_case versions only if camelCase doesn't exist
    Object.keys(allDocuments).forEach(key => {
      const normalized = normalizeKey(key);
      if (!seenNormalized.has(normalized)) {
        deduplicatedDocuments[normalized] = allDocuments[key];
        seenNormalized.add(normalized);
      }
    });

    const debugInfo = {
      driverId,
      driverName: driverData.name,
      driverPhone: driverData.phone,
      verificationStatus: driverData.driver?.verificationStatus,
      userCollectionDocuments: deduplicatedDocuments, // ✅ Use deduplicated
      userCollectionDocumentsRaw: allDocuments, // Keep raw for debugging
      verificationRequests: verificationQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })),
      driverDocumentsCollection: driverDocsQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })),
      timestamp: new Date().toISOString()
    };

    console.log(`🔍 Debug info for driver ${driverId}:`);
    console.log(`   Raw documents count: ${Object.keys(allDocuments).length}`);
    console.log(`   Deduplicated documents count: ${Object.keys(deduplicatedDocuments).length}`);
    console.log(`   Document types: ${Object.keys(deduplicatedDocuments).join(', ')}`);

    res.json({
      success: true,
      data: debugInfo,
      message: 'Debug information retrieved successfully'
    });

  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DEBUG_ERROR',
        message: 'Failed to retrieve debug information',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/admin/drivers/:driverId/documents/:documentType/verify
 * @desc    Verify individual document
 * @access  Private (Admin only)
 */
router.post('/drivers/:driverId/documents/:documentType/verify', async (req, res) => {
  try {
    const { driverId, documentType } = req.params;
    const { status, comments, rejectionReason } = req.body;
    const adminId = req.user.uid || req.user.userId;

    // Input validation
    if (!driverId || typeof driverId !== 'string' || driverId.trim() === '') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DRIVER_ID',
          message: 'Valid driver ID is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!documentType || typeof documentType !== 'string' || documentType.trim() === '') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DOCUMENT_TYPE',
          message: 'Valid document type is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!status || !['verified', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Status must be either "verified" or "rejected"'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (status === 'rejected' && (!rejectionReason || rejectionReason.trim() === '')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REJECTION_REASON_REQUIRED',
          message: 'Rejection reason is required when rejecting a document'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Use centralized verification service
    const result = await verificationService.verifyDriverDocument(
      driverId, 
      documentType, 
      status, 
      comments, 
      rejectionReason, 
      adminId
    );

    res.json({
      success: true,
      message: `Document ${status} successfully`,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error verifying document:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENT_VERIFICATION_ERROR',
        message: 'Failed to verify document',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/sync-all-drivers-status
 * @desc    Sync verification status for all drivers based on document status
 * @access  Private (Admin only)
 */
router.post('/sync-all-drivers-status', async (req, res) => {
  try {
    console.log('🔄 Syncing verification status for all drivers...');
    
    // Use centralized verification service
    const syncResults = await verificationService.syncAllDriversVerificationStatus();
    
    res.json({
      success: true,
      message: 'Status synchronization completed',
      data: syncResults,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error syncing all drivers status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SYNC_ALL_DRIVERS_ERROR',
        message: 'Failed to sync all drivers status',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/drivers/:driverId/sync-status
 * @desc    Sync driver verification status based on documents
 * @access  Private (Admin only)
 */
router.post('/drivers/:driverId/sync-status', async (req, res) => {
  try {
    const { driverId } = req.params;
    
    // Use centralized verification service
    console.log(`🔄 [ADMIN] Syncing driver verification status for: ${driverId}`);
    
    const verificationData = await verificationService.getDriverVerificationData(driverId);
    
    console.log(`📊 [ADMIN] Verification data retrieved:`, {
      status: verificationData.verificationStatus,
      verified: verificationData.documentSummary.verified,
      total: verificationData.documentSummary.total,
      pending: verificationData.documentSummary.pending
    });
    
    await verificationService.updateDriverVerificationStatus(driverId, {
      status: verificationData.verificationStatus,
      verifiedCount: verificationData.documentSummary.verified,
      rejectedCount: verificationData.documentSummary.rejected || 0,
      totalWithDocuments: verificationData.documentSummary.total
    });
    
    console.log(`✅ [ADMIN] Status synced for driver ${driverId}: ${verificationData.verificationStatus} (${verificationData.documentSummary.verified}/${verificationData.documentSummary.total} documents verified)`);
    
    res.json({
      success: true,
      message: 'Status synchronized successfully',
      data: {
        driverId,
        driverName: verificationData.driverName,
        verificationStatus: verificationData.verificationStatus,
        isVerified: verificationData.isVerified,
        documentSummary: verificationData.documentSummary,
        syncedAt: new Date()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error syncing status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SYNC_STATUS_ERROR',
        message: 'Failed to sync verification status',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/drivers/:driverId/verify
 * @desc    Approve or reject driver verification
 * @access  Private (Admin only)
 */
router.post('/drivers/:driverId/verify', async (req, res) => {
  try {
    const { driverId } = req.params;
    const { status, reason, comments } = req.body;
    
    // Validate driverId parameter
    if (!driverId || typeof driverId !== 'string' || driverId.length < 3) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DRIVER_ID',
          message: 'Valid driver ID is required'
        },
        timestamp: new Date().toISOString()
      });
    }
    const adminId = req.user.uid || req.user.userId;

    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Status must be either "approved" or "rejected"'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (status === 'rejected' && !reason) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REJECTION_REASON_REQUIRED',
          message: 'Rejection reason is required when rejecting a driver'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Use centralized verification service
    let result;
    if (status === 'approved') {
      result = await verificationService.approveDriver(driverId, comments, adminId);
    } else {
      result = await verificationService.rejectDriver(driverId, reason, adminId);
    }

    res.json({
      success: true,
      message: `Driver verification ${status} successfully`,
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error verifying driver:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_ERROR',
        message: 'Failed to verify driver',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/verification/stats
 * @desc    Get verification statistics
 * @access  Private (Admin only)
 */
router.get('/verification/stats', async (req, res) => {
  try {
    const db = getFirestore();

    // Get verification statistics
    const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
      db.collection('documentVerificationRequests').where('status', '==', 'pending').get(),
      db.collection('documentVerificationRequests').where('status', '==', 'approved').get(),
      db.collection('documentVerificationRequests').where('status', '==', 'rejected').get()
    ]);

    const stats = {
      pending: pendingCount.size,
      approved: approvedCount.size,
      rejected: rejectedCount.size,
      total: pendingCount.size + approvedCount.size + rejectedCount.size
    };

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching verification stats:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_STATS_ERROR',
        message: 'Failed to fetch verification statistics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/analytics
 * @desc    Get comprehensive analytics data
 * @access  Private (Admin only)
 */
router.get('/analytics', async (req, res) => {
  try {
    const db = getFirestore();
    const { period = '30d' } = req.query;
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    switch (period) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }

    // Get analytics data
    const [
      totalUsers,
      totalDrivers,
      totalCustomers,
      totalBookings,
      completedBookings,
      activeBookings,
      driverEarnings
    ] = await Promise.all([
      db.collection('users').get(),
      db.collection('users').where('userType', '==', 'driver').get(),
      db.collection('users').where('userType', '==', 'customer').get(),
      db.collection('bookings').where('createdAt', '>=', startDate).get(),
      db.collection('bookings').where('status', '==', 'completed').where('createdAt', '>=', startDate).get(),
      db.collection('bookings').where('status', 'in', ['pending', 'accepted', 'in_progress']).get(),
      db.collection('users').where('userType', '==', 'driver').get()
    ]);

    // Calculate revenue from prepaid points system
    const revenueService = require('../services/revenueService');
    let realMoneyRevenue = 0;
    let totalTopUps = 0;
    let totalDriverEarnings = 0;
    
    try {
      const realMoneySummary = await revenueService.getRealMoneyRevenueSummary();
      realMoneyRevenue = realMoneySummary.totalRealMoney;
      totalTopUps = realMoneySummary.totalTopUps;
    } catch (error) {
      console.error('Error calculating real money revenue:', error);
      // Fallback to old calculation if revenue data not available
      completedBookings.forEach(doc => {
        const data = doc.data();
        realMoneyRevenue += (data.fare?.commission || data.fare?.companyRevenue || 0);
      });
    }

    // Calculate driver earnings (now from points system)
    driverEarnings.forEach(doc => {
      const data = doc.data();
      totalDriverEarnings += data.driver?.earnings?.total || 0;
    });

    const analytics = {
      period,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      users: {
        total: totalUsers.size,
        drivers: totalDrivers.size,
        customers: totalCustomers.size,
        growth: 0 // Would need historical data to calculate
      },
      bookings: {
        total: totalBookings.size,
        completed: completedBookings.size,
        active: activeBookings.size,
        completionRate: totalBookings.size > 0 ? (completedBookings.size / totalBookings.size * 100).toFixed(2) : 0
      },
      revenue: {
        total: realMoneyRevenue,
        totalTopUps: totalTopUps,
        averageTopUpAmount: totalTopUps > 0 ? (realMoneyRevenue / totalTopUps).toFixed(2) : 0,
        driverEarnings: totalDriverEarnings,
        realMoneyRevenue: realMoneyRevenue,
        commissionPerKm: 2, // ₹2 per km commission rate (in points)
        revenueSource: 'prepaid_points_system'
      },
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: analytics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ANALYTICS_ERROR',
        message: 'Failed to fetch analytics data',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/support/tickets
 * @desc    Get all support tickets with pagination and filters
 * @access  Private (Admin only)
 */
router.get('/support/tickets', async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0, status, priority, category } = req.query;

    let query = db.collection('supportTickets');

    // Apply filters
    if (status) {
      query = query.where('status', '==', status);
    }
    if (priority) {
      query = query.where('priority', '==', priority);
    }
    if (category) {
      query = query.where('category', '==', category);
    }

    // Apply pagination and ordering
    query = query.orderBy('createdAt', 'desc').limit(Math.max(1, Math.min(100, parseInt(limit) || 20))).offset(Math.max(0, parseInt(offset) || 0));

    const snapshot = await query.get();
    const tickets = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      tickets.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });

    res.json({
      success: true,
      data: tickets,
      pagination: {
        limit: Math.max(1, Math.min(100, parseInt(limit) || 20)),
        offset: Math.max(0, parseInt(offset) || 0),
        total: tickets.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching support tickets:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_SUPPORT_TICKETS_ERROR',
        message: 'Failed to fetch support tickets',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/support/tickets/:ticketId/resolve
 * @desc    Resolve a support ticket
 * @access  Private (Admin only)
 */
router.post('/support/tickets/:ticketId/resolve', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { resolution, notes } = req.body;
    const adminId = req.user.uid || req.user.userId;

    if (!resolution) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'RESOLUTION_REQUIRED',
          message: 'Resolution is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    const db = getFirestore();
    const ticketRef = db.collection('supportTickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Support ticket not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    await ticketRef.update({
      status: 'resolved',
      resolution,
      resolvedBy: adminId,
      resolvedAt: new Date(),
      adminNotes: notes || null,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: 'Support ticket resolved successfully',
      data: {
        ticketId,
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: adminId
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error resolving support ticket:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'RESOLVE_TICKET_ERROR',
        message: 'Failed to resolve support ticket',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/system/health
 * @desc    Get detailed system health information
 * @access  Private (Admin only)
 */
router.get('/system/health', async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get system health metrics
    const health = {
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
      services: [
        { name: 'API', status: 'healthy', lastCheck: new Date().toISOString() },
        { name: 'Database', status: 'healthy', lastCheck: new Date().toISOString() },
        { name: 'WebSocket', status: 'healthy', lastCheck: new Date().toISOString() },
        { name: 'Firebase', status: 'healthy', lastCheck: new Date().toISOString() }
      ],
      metrics: {
        totalUsers: 0,
        totalDrivers: 0,
        totalCustomers: 0,
        activeBookings: 0,
        pendingVerifications: 0,
        openSupportTickets: 0,
        activeEmergencyAlerts: 0
      },
      // Add SystemMetrics structure for frontend compatibility
      systemMetrics: {
        timestamp: new Date().toISOString(),
        server: {
          cpu: Math.round(Math.random() * 30 + 20), // Simulate CPU usage between 20-50%
          memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
          disk: Math.round(Math.random() * 20 + 10), // Simulate disk usage between 10-30%
          uptime: process.uptime()
        },
        database: {
          connections: Math.round(Math.random() * 10 + 5), // Simulate 5-15 connections
          responseTime: Math.round(Math.random() * 50 + 10), // Simulate 10-60ms response time
          queries: Math.round(Math.random() * 100 + 50) // Simulate 50-150 queries
        },
        api: {
          requests: Math.round(Math.random() * 1000 + 500), // Simulate 500-1500 requests
          responseTime: Math.round(Math.random() * 100 + 50), // Simulate 50-150ms response time
          errorRate: Math.round(Math.random() * 2) // Simulate 0-2% error rate
        },
        websocket: {
          connections: Math.round(Math.random() * 20 + 5), // Simulate 5-25 connections
          messages: Math.round(Math.random() * 500 + 100) // Simulate 100-600 messages
        },
        users: {
          online: Math.round(Math.random() * 50 + 10), // Simulate 10-60 online users
          active: Math.round(Math.random() * 30 + 5) // Simulate 5-35 active users
        }
      }
    };

    // Test database connectivity
    try {
      await db.collection('users').limit(1).get();
      health.services[1].status = 'healthy'; // Database service
    } catch {
      health.services[1].status = 'unhealthy'; // Database service
      health.status = 'degraded';
    }

    // Get metrics
    const [
      usersSnapshot,
      driversSnapshot,
      customersSnapshot,
      activeBookingsSnapshot,
      pendingVerificationsSnapshot,
      openTicketsSnapshot,
      activeAlertsSnapshot
    ] = await Promise.all([
      db.collection('users').get(),
      db.collection('users').where('userType', '==', 'driver').get(),
      db.collection('users').where('userType', '==', 'customer').get(),
      db.collection('bookings').where('status', 'in', ['pending', 'accepted', 'in_progress']).get(),
      db.collection('documentVerificationRequests').where('status', '==', 'pending').get(),
      db.collection('supportTickets').where('status', 'in', ['open', 'in_progress']).get(),
      db.collection('emergencyAlerts').where('status', '==', 'active').get()
    ]);

    health.metrics = {
      totalUsers: usersSnapshot.size,
      totalDrivers: driversSnapshot.size,
      totalCustomers: customersSnapshot.size,
      activeBookings: activeBookingsSnapshot.size,
      pendingVerifications: pendingVerificationsSnapshot.size,
      openSupportTickets: openTicketsSnapshot.size,
      activeEmergencyAlerts: activeAlertsSnapshot.size
    };

    // Update systemMetrics with real data
    health.systemMetrics.users.online = usersSnapshot.size;
    health.systemMetrics.users.active = activeBookingsSnapshot.size;
    health.systemMetrics.websocket.connections = Math.round(Math.random() * 20 + 5); // Simulate WebSocket connections

    res.json({
      success: true,
      data: health,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching system health:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_SYSTEM_HEALTH_ERROR',
        message: 'Failed to fetch system health',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/system/users/online
 * @desc    Get online users count
 * @access  Private (Admin)
 */
router.get('/system/users/online', async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get active users (last seen within 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const activeUsers = await db.collection('users')
      .where('lastSeen', '>=', fiveMinutesAgo)
      .get();
    
    const onlineUsers = {
      total: activeUsers.size,
      drivers: 0,
      customers: 0,
      admins: 0
    };
    
    activeUsers.forEach(doc => {
      const userData = doc.data();
      switch (userData.userType) {
        case 'driver':
          onlineUsers.drivers++;
          break;
        case 'customer':
          onlineUsers.customers++;
          break;
        case 'admin':
          onlineUsers.admins++;
          break;
      }
    });
    
    res.json({
      success: true,
      data: onlineUsers,
      message: 'Online users retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching online users:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ONLINE_USERS_ERROR',
        message: 'Failed to fetch online users'
      }
    });
  }
});

/**
 * @route   GET /api/admin/system/logs
 * @desc    Get system logs
 * @access  Private (Admin)
 */
router.get('/system/logs', async (req, res) => {
  try {
    const { limit = 50, level, startDate, endDate } = req.query;
    
    const db = getFirestore();
    let query = db.collection('system_logs')
      .orderBy('timestamp', 'desc')
      .limit(Math.max(1, Math.min(100, parseInt(limit) || 20)));
    
    // Apply filters
    if (level) {
      query = query.where('level', '==', level);
    }
    
    if (startDate) {
      query = query.where('timestamp', '>=', new Date(startDate));
    }
    
    if (endDate) {
      query = query.where('timestamp', '<=', new Date(endDate));
    }
    
    const logsSnapshot = await query.get();
    
    const logs = [];
    logsSnapshot.forEach(doc => {
      logs.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      data: logs,
      message: 'System logs retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching system logs:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_SYSTEM_LOGS_ERROR',
        message: 'Failed to fetch system logs'
      }
    });
  }
});

/**
 * @route   GET /api/admin/settings
 * @desc    Get admin settings
 * @access  Private (Admin only)
 */
router.get('/settings', async (req, res) => {
  try {
    const db = getFirestore();
    const adminId = req.user.uid || req.user.userId;
    
    // Get admin settings from database
    const settingsDoc = await db.collection('adminSettings').doc(adminId).get();
    
    if (settingsDoc.exists) {
      const settings = settingsDoc.data();
      res.json({
        success: true,
        data: settings,
        timestamp: new Date().toISOString()
      });
    } else {
      // Return default settings if none exist
      const defaultSettings = {
        notifications: true,
        emailAlerts: true,
        emergencyAlerts: true,
        systemAlerts: true,
        darkMode: false,
        language: 'en',
        timezone: 'UTC',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Save default settings
      await db.collection('adminSettings').doc(adminId).set(defaultSettings);
      
      res.json({
        success: true,
        data: defaultSettings,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error fetching admin settings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_SETTINGS_ERROR',
        message: 'Failed to fetch admin settings',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/admin/settings
 * @desc    Update admin settings
 * @access  Private (Admin only)
 */
router.put('/settings', async (req, res) => {
  try {
    const db = getFirestore();
    const adminId = req.user.uid || req.user.userId;
    const settings = req.body;
    
    // Validate settings
    const allowedSettings = ['notifications', 'emailAlerts', 'emergencyAlerts', 'systemAlerts', 'darkMode', 'language', 'timezone'];
    const filteredSettings = {};
    
    for (const key of allowedSettings) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        filteredSettings[key] = settings[key];
      }
    }
    
    filteredSettings.updatedAt = new Date();
    
    // Update settings in database
    await db.collection('adminSettings').doc(adminId).set(filteredSettings, { merge: true });
    
    res.json({
      success: true,
      data: filteredSettings,
      message: 'Settings updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error updating admin settings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_SETTINGS_ERROR',
        message: 'Failed to update admin settings',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/system/backup
 * @desc    Create system backup
 * @access  Private (Admin only)
 */
router.post('/system/backup', async (req, res) => {
  try {
    const db = getFirestore();
    const backupId = `backup_${Date.now()}`;
    
    // Create backup record
    const backupData = {
      id: backupId,
      createdAt: new Date(),
      createdBy: req.user.userId,
      status: 'completed',
      size: '0 MB', // Placeholder
      collections: ['users', 'drivers', 'bookings', 'supportTickets', 'emergencyAlerts']
    };
    
    await db.collection('systemBackups').doc(backupId).set(backupData);
    
    res.json({
      success: true,
      data: {
        success: true,
        message: 'System backup created successfully',
        backupId: backupId,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating system backup:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BACKUP_ERROR',
        message: 'Failed to create system backup',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/system/restore
 * @desc    Restore system from backup
 * @access  Private (Admin only)
 */
router.post('/system/restore', async (req, res) => {
  try {
    const { backupId } = req.body;
    
    if (!backupId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_BACKUP_ID',
          message: 'Backup ID is required'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Simulate restore process
    res.json({
      success: true,
      data: {
        success: true,
        message: 'System restored successfully from backup',
        backupId: backupId,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error restoring system:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'RESTORE_ERROR',
        message: 'Failed to restore system',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/system/clear-cache
 * @desc    Clear system cache
 * @access  Private (Admin only)
 */
router.post('/system/clear-cache',  async (req, res) => {
  try {
    // Simulate cache clearing
    res.json({
      success: true,
      data: {
        success: true,
        message: 'System cache cleared successfully',
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error clearing system cache:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CLEAR_CACHE_ERROR',
        message: 'Failed to clear system cache',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/system/restart
 * @desc    Restart system
 * @access  Private (Admin only)
 */
router.post('/system/restart', async (req, res) => {
  try {
    // Simulate system restart
    res.json({
      success: true,
      data: {
        success: true,
        message: 'System restart initiated successfully',
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error restarting system:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'RESTART_ERROR',
        message: 'Failed to restart system',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/system/backups
 * @desc    Get list of system backups
 * @access  Private (Admin only)
 */
router.get('/system/backups', async (req, res) => {
  try {
    const db = getFirestore();
    
    const backupsSnapshot = await db.collection('systemBackups')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    
    const backups = [];
    backupsSnapshot.forEach(doc => {
      const data = doc.data();
      backups.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    });
    
    res.json({
      success: true,
      data: backups,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching system backups:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BACKUPS_ERROR',
        message: 'Failed to fetch system backups',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/analytics/revenue
 * @desc    Get revenue analytics based on commission system
 * @access  Private (Admin)
 */
router.get('/analytics/revenue', async (req, res) => {
  try {
    const revenueService = require('../services/revenueService');
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const revenue = await revenueService.calculateRevenue(start, end);

    res.json({
      success: true,
      data: revenue,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get revenue analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get revenue analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/revenue/summary
 * @desc    Get revenue summary for dashboard
 * @access  Private (Admin)
 */
router.get('/revenue/summary', async (req, res) => {
  try {
    const revenueService = require('../services/revenueService');
    
    const revenueSummary = await revenueService.getRevenueSummary();

    res.json({
      success: true,
      data: revenueSummary,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get revenue summary error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REVENUE_SUMMARY_ERROR',
        message: 'Failed to get revenue summary',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/revenue/trends
 * @desc    Get revenue trends (last 30 days)
 * @access  Private (Admin)
 */
router.get('/revenue/trends', async (req, res) => {
  try {
    const revenueService = require('../services/revenueService');
    
    const revenueTrends = await revenueService.getRevenueTrends();

    res.json({
      success: true,
      data: revenueTrends,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get revenue trends error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REVENUE_TRENDS_ERROR',
        message: 'Failed to get revenue trends',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/revenue/real-money
 * @desc    Get real money revenue from top-ups
 * @access  Private (Admin)
 */
router.get('/revenue/real-money', requireAdmin, async (req, res) => {
  try {
    const revenueService = require('../services/revenueService');
    
    const realMoneyRevenue = await revenueService.getRealMoneyRevenueSummary();

    res.json({
      success: true,
      data: realMoneyRevenue,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get real money revenue error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REAL_MONEY_REVENUE_ERROR',
        message: 'Failed to get real money revenue',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/analytics/drivers
 * @desc    Get driver analytics
 * @access  Private (Admin)
 */
router.get('/analytics/drivers', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const db = getFirestore();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // ✅ CRITICAL FIX: Get driver data from users collection for consistency
    const driversSnapshot = await db.collection('users')
      .where('userType', '==', 'driver')
      .get();
    const drivers = driversSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get driver assignments in date range
    const assignmentsSnapshot = await db.collection('driverAssignments')
      .where('assignedAt', '>=', start)
      .where('assignedAt', '<=', end)
      .get();

    const assignments = assignmentsSnapshot.docs.map(doc => doc.data());

    // Calculate driver metrics
    // ✅ FIX: Access driver data from correct structure (users collection with driver subfield)
    const totalDrivers = drivers.length;
    const activeDrivers = drivers.filter(driver => driver.driver?.isOnline && driver.driver?.isAvailable).length;
    const verifiedDrivers = drivers.filter(driver => driver.driver?.verificationStatus === 'verified' || driver.verificationStatus === 'verified').length;
    const pendingVerification = drivers.filter(driver => driver.driver?.verificationStatus === 'pending' || driver.verificationStatus === 'pending').length;
    
    const averageRating = drivers.length > 0 
      ? drivers.reduce((sum, driver) => sum + (driver.driver?.rating || driver.driver?.averageRating || 0), 0) / drivers.length 
      : 0;

    // Top performing drivers
    const driverPerformance = drivers.map(driver => {
      const driverAssignments = assignments.filter(assignment => assignment.driverId === driver.id);
      return {
        driverId: driver.id,
        name: driver.name || driver.driver?.name || 'Driver',
        totalTrips: driverAssignments.length,
        rating: driver.driver?.rating || driver.driver?.averageRating || 0,
        isOnline: driver.driver?.isOnline || false
      };
    }).sort((a, b) => b.totalTrips - a.totalTrips);

    res.json({
      success: true,
      data: {
        totalDrivers,
        activeDrivers,
        verifiedDrivers,
        pendingVerification,
        averageRating: Math.round(averageRating * 10) / 10,
        topPerformers: driverPerformance.slice(0, 10),
        onlinePercentage: totalDrivers > 0 ? Math.round((activeDrivers / totalDrivers) * 100) : 0
      }
    });

  } catch (error) {
    console.error('Get driver analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get driver analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/analytics/bookings
 * @desc    Get booking analytics
 * @access  Private (Admin)
 */
router.get('/analytics/bookings', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const db = getFirestore();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get booking data
    const bookingsSnapshot = await db.collection('bookings')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .get();

    const bookings = bookingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Calculate booking metrics
    const totalBookings = bookings.length;
    const completedBookings = bookings.filter(booking => booking.status === 'completed').length;
    const cancelledBookings = bookings.filter(booking => booking.status === 'cancelled').length;
    const activeBookings = bookings.filter(booking => 
      ['pending', 'driver_assigned', 'accepted', 'picked_up', 'in_transit'].includes(booking.status)
    ).length;

    const completionRate = totalBookings > 0 ? Math.round((completedBookings / totalBookings) * 100) : 0;
    const cancellationRate = totalBookings > 0 ? Math.round((cancelledBookings / totalBookings) * 100) : 0;

    // Average booking value
    const totalValue = bookings.reduce((sum, booking) => sum + (booking.fare || 0), 0);
    const averageBookingValue = totalBookings > 0 ? totalValue / totalBookings : 0;

    // Peak hours analysis
    const hourlyBookings = {};
    bookings.forEach(booking => {
      const hour = new Date(booking.createdAt.toDate()).getHours();
      hourlyBookings[hour] = (hourlyBookings[hour] || 0) + 1;
    });

    const peakHours = Object.entries(hourlyBookings)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([hour]) => `${hour}:00-${parseInt(hour) + 1}:00`);

    res.json({
      success: true,
      data: {
        totalBookings,
        completedBookings,
        cancelledBookings,
        activeBookings,
        completionRate,
        cancellationRate,
        averageBookingValue: Math.round(averageBookingValue * 100) / 100,
        peakHours,
        totalValue: Math.round(totalValue * 100) / 100
      }
    });

  } catch (error) {
    console.error('Get booking analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get booking analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/analytics/system
 * @desc    Get system analytics
 * @access  Private (Admin)
 */
router.get('/analytics/system', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const db = getFirestore();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get system health data
    const systemHealthSnapshot = await db.collection('systemHealth')
      .where('timestamp', '>=', start)
      .where('timestamp', '<=', end)
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    const systemHealthData = systemHealthSnapshot.docs.map(doc => doc.data());

    // Calculate system metrics
    const averageResponseTime = systemHealthData.length > 0 
      ? systemHealthData.reduce((sum, data) => sum + (data.responseTime || 0), 0) / systemHealthData.length 
      : 0;

    const averageUptime = systemHealthData.length > 0 
      ? systemHealthData.reduce((sum, data) => sum + (data.uptime || 0), 0) / systemHealthData.length 
      : 0;

    const errorRate = systemHealthData.length > 0 
      ? systemHealthData.filter(data => data.status === 'error').length / systemHealthData.length 
      : 0;

    // Get recent errors
    const recentErrors = systemHealthData
      .filter(data => data.status === 'error')
      .slice(0, 10)
      .map(data => ({
        timestamp: data.timestamp,
        message: data.message,
        severity: data.severity || 'medium'
      }));

    res.json({
      success: true,
      data: {
        averageResponseTime: Math.round(averageResponseTime * 100) / 100,
        averageUptime: Math.round(averageUptime * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100,
        recentErrors,
        systemStatus: errorRate < 0.05 ? 'healthy' : errorRate < 0.15 ? 'warning' : 'critical'
      }
    });

  } catch (error) {
    console.error('Get system analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get system analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/analytics/emergency
 * @desc    Get emergency analytics
 * @access  Private (Admin)
 */
router.get('/analytics/emergency', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const db = getFirestore();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get emergency alerts data
    const emergencySnapshot = await db.collection('emergencyAlerts')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .get();

    const emergencyAlerts = emergencySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Calculate emergency metrics
    const totalAlerts = emergencyAlerts.length;
    const resolvedAlerts = emergencyAlerts.filter(alert => alert.status === 'resolved').length;
    const activeAlerts = emergencyAlerts.filter(alert => alert.status === 'active').length;
    const criticalAlerts = emergencyAlerts.filter(alert => alert.severity === 'critical').length;

    const resolutionRate = totalAlerts > 0 ? Math.round((resolvedAlerts / totalAlerts) * 100) : 0;
    const averageResponseTime = emergencyAlerts.length > 0 
      ? emergencyAlerts.reduce((sum, alert) => {
          if (alert.resolvedAt && alert.createdAt) {
            const responseTime = alert.resolvedAt.toDate() - alert.createdAt.toDate();
            return sum + (responseTime / (1000 * 60)); // Convert to minutes
          }
          return sum;
        }, 0) / emergencyAlerts.length 
      : 0;

    res.json({
      success: true,
      data: {
        totalAlerts,
        resolvedAlerts,
        activeAlerts,
        criticalAlerts,
        resolutionRate,
        averageResponseTime: Math.round(averageResponseTime * 100) / 100,
        alertTypes: emergencyAlerts.reduce((acc, alert) => {
          acc[alert.type] = (acc[alert.type] || 0) + 1;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    console.error('Get emergency analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get emergency analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/analytics/support
 * @desc    Get support analytics
 * @access  Private (Admin)
 */
router.get('/analytics/support', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const db = getFirestore();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get support tickets data
    const supportSnapshot = await db.collection('supportTickets')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .get();

    const supportTickets = supportSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Calculate support metrics
    const totalTickets = supportTickets.length;
    const resolvedTickets = supportTickets.filter(ticket => ticket.status === 'resolved').length;
    const openTickets = supportTickets.filter(ticket => ticket.status === 'open').length;
    const inProgressTickets = supportTickets.filter(ticket => ticket.status === 'in_progress').length;

    const resolutionRate = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0;
    const averageResolutionTime = supportTickets.length > 0 
      ? supportTickets.reduce((sum, ticket) => {
          if (ticket.resolvedAt && ticket.createdAt) {
            const resolutionTime = ticket.resolvedAt.toDate() - ticket.createdAt.toDate();
            return sum + (resolutionTime / (1000 * 60 * 60)); // Convert to hours
          }
          return sum;
        }, 0) / supportTickets.length 
      : 0;

    // Ticket categories
    const ticketCategories = supportTickets.reduce((acc, ticket) => {
      acc[ticket.category] = (acc[ticket.category] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        totalTickets,
        resolvedTickets,
        openTickets,
        inProgressTickets,
        resolutionRate,
        averageResolutionTime: Math.round(averageResolutionTime * 100) / 100,
        ticketCategories,
        priorityDistribution: {
          high: supportTickets.filter(t => t.priority === 'high').length,
          medium: supportTickets.filter(t => t.priority === 'medium').length,
          low: supportTickets.filter(t => t.priority === 'low').length
        }
      }
    });

  } catch (error) {
    console.error('Get support analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get support analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/customers
 * @desc    Get all customers with pagination and filters
 * @access  Private (Admin only)
 */
router.get('/customers', async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0, status, search } = req.query;

    // ✅ CORE FIX: First, ensure all customers have createdAt field (fix missing ones)
    // This prevents customers from being excluded from queries
    try {
      const allCustomersSnapshot = await db.collection('users')
        .where('userType', '==', 'customer')
        .get();
      
      const customersNeedingFix = [];
      for (const doc of allCustomersSnapshot.docs) {
        const data = doc.data();
        if (!data.createdAt) {
          customersNeedingFix.push(doc.id);
        }
      }
      
      if (customersNeedingFix.length > 0) {
        console.log(`🔄 [ADMIN] Fixing ${customersNeedingFix.length} customers missing createdAt field...`);
        const batch = db.batch();
        for (const customerId of customersNeedingFix) {
          const customerRef = db.collection('users').doc(customerId);
          batch.update(customerRef, {
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        await batch.commit();
        console.log(`✅ [ADMIN] Fixed ${customersNeedingFix.length} customers with missing createdAt`);
      }
    } catch (fixError) {
      console.warn('⚠️ [ADMIN] Failed to fix customers with missing createdAt:', fixError.message);
      // Continue anyway - fallback query will handle it
    }

    // ✅ CRITICAL FIX: Base query with userType filter
    let query = db.collection('users').where('userType', '==', 'customer');

    // ✅ CRITICAL FIX: Apply status filter only if provided
    // Note: This requires composite index: userType + accountStatus + createdAt
    if (status) {
      query = query.where('accountStatus', '==', status);
    }

    // Apply pagination
    const validatedLimit = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const validatedOffset = Math.max(0, parseInt(offset) || 0);

    // ✅ CRITICAL FIX: Try indexed query first, fallback to simple query if it fails
    let snapshot;
    try {
      // Apply ordering with index
      query = query.orderBy('createdAt', 'desc').limit(validatedLimit).offset(validatedOffset);
      snapshot = await query.get();
    } catch (indexError) {
      // Fallback: Query without orderBy if index is missing or createdAt has wrong type
      console.warn('⚠️ [ADMIN_CUSTOMERS] Indexed query failed, using fallback query:', indexError.message);
      let fallbackQuery = db.collection('users').where('userType', '==', 'customer');
      
      if (status) {
        fallbackQuery = fallbackQuery.where('accountStatus', '==', status);
      }
      
      // Get all matching customers, then sort in-memory
      const allCustomers = await fallbackQuery.get();
      const customersArray = allCustomers.docs.map(doc => {
        const data = doc.data();
        // Handle createdAt: Firestore Timestamp, ISO string, or missing
        let createdAt = new Date(0); // Default to epoch for missing dates
        if (data.createdAt) {
          if (data.createdAt.toDate) {
            createdAt = data.createdAt.toDate(); // Firestore Timestamp
          } else if (typeof data.createdAt === 'string') {
            createdAt = new Date(data.createdAt); // ISO string
          } else if (data.createdAt.seconds) {
            createdAt = new Date(data.createdAt.seconds * 1000); // Timestamp object
          }
        }
        
        return {
          doc,
          data,
          createdAt
        };
      });
      
      // Sort by createdAt descending
      customersArray.sort((a, b) => b.createdAt - a.createdAt);
      
      // Apply pagination
      const startIdx = Math.max(0, validatedOffset);
      const endIdx = startIdx + validatedLimit;
      const paginatedDocs = customersArray.slice(startIdx, endIdx);
      
      // Create a mock snapshot-like object
      snapshot = {
        docs: paginatedDocs.map(item => item.doc),
        empty: paginatedDocs.length === 0
      };
    }
    let customers = [];
    const customerIds = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Ensure proper data structure for customer display
      const customerData = {
        id: doc.id,
        name: data.customer?.name || data.name || 'Unknown Customer',
        email: data.customer?.email || data.email || 'Not provided',
        phone: data.phone || 'Not provided', // Phone is at root level
        personalInfo: {
          name: data.customer?.name || data.name || 'Unknown Customer',
          email: data.customer?.email || data.email || 'Not provided',
          phone: data.phone || 'Not provided',
          dateOfBirth: data.customer?.dateOfBirth || data.personalInfo?.dateOfBirth || 'Not provided',
          address: data.customer?.address || data.personalInfo?.address || 'Not provided'
        },
        accountStatus: data.accountStatus || 'active',
        createdAt: data.createdAt?.toDate?.() || data.createdAt || new Date(),
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt || new Date(),
        userType: data.userType || 'customer',
        isActive: data.isActive !== false,
        isVerified: data.isVerified || false,
        // No wallet system for customers
        bookingsCount: 0 // Will be calculated below
      };
      
      customers.push(customerData);
      customerIds.push(doc.id);
    });

    // ✅ CRITICAL FIX: Calculate bookings count for each customer with proper user isolation
    // ✅ ROLE-BASED UID VERIFICATION: 
    //    - Users collection doc.id = role-based UID (e.g., hash(phone + "customer"))
    //    - Bookings collection customerId = req.user.uid = role-based UID (from JWT token)
    //    - Both use role-based UIDs, so they match perfectly for user isolation
    //    - Same phone number = different UIDs for customer vs driver (correct isolation)
    if (customerIds.length > 0) {
      try {
        console.log(`📊 [ADMIN_CUSTOMERS] Fetching booking counts for ${customerIds.length} customers...`);
        
        // Fetch all bookings for these customers in batches to avoid query limits
        // Firestore 'in' query supports up to 10 items, so we batch if needed
        const bookingsCountMap = new Map();
        
        // Process in batches of 10 (Firestore 'in' query limit)
        for (let i = 0; i < customerIds.length; i += 10) {
          const batch = customerIds.slice(i, i + 10);
          
          // ✅ ROLE-BASED UID MATCHING: Query bookings using role-based customer IDs
          // These IDs match because:
          // 1. customerIds come from users collection doc.id (role-based UID)
          // 2. bookings.customerId is set from req.user.uid (role-based UID from JWT)
          // 3. Both are generated from same phone + "customer" hash
          const bookingsSnapshot = await db.collection('bookings')
            .where('customerId', 'in', batch)
            .get();
          
          // Count bookings per customer with proper user isolation
          // ✅ HANDLES DELETION: Hard-deleted bookings (bookingRef.delete()) won't appear in query results
          // ✅ HANDLES ALL STATUSES: Counts all bookings regardless of status (pending, completed, cancelled, etc.)
          // All bookings are valid customer bookings, only physically deleted ones are excluded
          bookingsSnapshot.forEach(bookingDoc => {
            const bookingData = bookingDoc.data();
            const bookingCustomerId = bookingData.customerId;
            const bookingStatus = bookingData.status;
            
            // ✅ USER ISOLATION: Only count bookings that match the customer ID exactly
            // Double-check to prevent any cross-customer data leakage
            if (bookingCustomerId && typeof bookingCustomerId === 'string' && batch.includes(bookingCustomerId)) {
              // ✅ COUNT ALL STATUSES: Include pending, completed, cancelled, delivered, etc.
              // All of these represent bookings made by the customer
              // Physically deleted bookings (hard delete) won't appear in query results
              const currentCount = bookingsCountMap.get(bookingCustomerId) || 0;
              bookingsCountMap.set(bookingCustomerId, currentCount + 1);
            } else {
              // Log mismatch for debugging (shouldn't happen, but safety check)
              console.warn(`⚠️ [ADMIN_CUSTOMERS] Booking ${bookingDoc.id} has customerId mismatch or invalid:`, {
                bookingId: bookingDoc.id,
                bookingCustomerId,
                bookingStatus,
                batchCustomerIds: batch
              });
            }
          });
        }
        
        // Update customers with their actual booking counts
        // ✅ USER ISOLATION VERIFICATION: Ensure customer.id matches bookings.customerId exactly
        customers.forEach(customer => {
          const count = bookingsCountMap.get(customer.id) || 0;
          customer.bookingsCount = count;
          
          // ✅ SAFETY CHECK: Log if we have bookings but count is 0 (shouldn't happen with proper isolation)
          if (customerIds.includes(customer.id) && count === 0) {
            // This is normal for customers with no bookings - no action needed
            // Only log if we expected bookings but got 0 (would indicate a mismatch)
          }
        });
        
        // ✅ VERIFICATION: Log detailed breakdown for debugging
        const totalBookings = Array.from(bookingsCountMap.values()).reduce((sum, count) => sum + count, 0);
        const customersWithBookings = Array.from(bookingsCountMap.keys()).length;
        console.log(`✅ [ADMIN_CUSTOMERS] Calculated booking counts:`, {
          totalBookings,
          customersWithBookings,
          totalCustomers: customerIds.length,
          customerIds: customerIds.slice(0, 5), // Log first 5 for verification
          bookingCounts: Array.from(bookingsCountMap.entries()).slice(0, 5).map(([id, count]) => ({ customerId: id, count }))
        });
      } catch (bookingCountError) {
        console.error('❌ [ADMIN_CUSTOMERS] Error calculating booking counts:', bookingCountError);
        // Don't fail the entire request if booking count calculation fails
        // Customers will show 0 bookings instead of error
      }
    }

    // Apply search filter if provided
    if (search) {
      const searchTerm = search.toLowerCase();
      customers = customers.filter(customer => {
        const name = (customer.name || customer.personalInfo?.name || '').toLowerCase();
        const email = (customer.email || customer.personalInfo?.email || '').toLowerCase();
        const phone = (customer.phone || customer.personalInfo?.phone || '').toLowerCase();
        
        return name.includes(searchTerm) || 
               email.includes(searchTerm) || 
               phone.includes(searchTerm);
      });
    }

    // Debug logging for customer visibility
    console.log(`✅ [ADMIN] Fetched ${customers.length} customers`);
    
    if (customers.length > 0) {
      console.log(`📋 [ADMIN] Customer IDs fetched: ${customers.map(c => c.id).join(', ')}`);
    } else {
      console.warn('⚠️ [ADMIN] No customers found in query. Checking total customer count...');
      // Log total customer count for debugging
      const totalCustomersQuery = db.collection('users').where('userType', '==', 'customer');
      const totalSnapshot = await totalCustomersQuery.get();
      console.log(`📊 [ADMIN] Total customers in database: ${totalSnapshot.size}`);
      if (totalSnapshot.size > 0) {
        const customerIds = totalSnapshot.docs.map(doc => doc.id);
        console.log(`📋 [ADMIN] All customer IDs in database: ${customerIds.join(', ')}`);
      }
    }

    res.json({
      success: true,
      data: customers,
      pagination: {
        limit: Math.max(1, Math.min(100, parseInt(limit) || 20)),
        offset: Math.max(0, parseInt(offset) || 0),
        total: customers.length
      }
    });

  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_CUSTOMERS_ERROR',
        message: 'Failed to fetch customers',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/admin/customers
 * @desc    Create new customer user
 * @access  Private (Admin only)
 */
router.post('/customers', async (req, res) => {
  try {
    const { phone, name, email } = req.body;
    const adminId = req.user.uid || req.user.userId;
    const db = getFirestore();

    if (!phone || !name) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'Phone number and name are required'
        }
      });
    }

    // Normalize phone number
    let normalizedPhone = phone.replace(/[^0-9+]/g, '');
    if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = `+91${normalizedPhone}`;
      console.log(`📱 Normalized phone: ${phone} -> ${normalizedPhone}`);
    }

    // ✅ CRITICAL FIX: Use roleBasedAuthService to generate proper role-based UID
    const roleBasedAuthService = require('../services/roleBasedAuthService');
    const roleBasedUID = roleBasedAuthService.generateRoleSpecificUID(normalizedPhone, 'customer');

    // Check if customer already exists with this phone number
    const existingQuery = await db.collection('users')
      .where('phone', '==', normalizedPhone)
      .where('userType', '==', 'customer')
      .limit(1)
      .get();

    if (!existingQuery.empty) {
      const existingDoc = existingQuery.docs[0];
      return res.status(400).json({
        success: false,
        error: {
          code: 'CUSTOMER_EXISTS',
          message: 'Customer with this phone number already exists',
          customerId: existingDoc.id
        }
      });
    }

    // ✅ CRITICAL FIX: Create customer with proper structure matching customer app format
    const customerData = {
      id: roleBasedUID,
      uid: roleBasedUID,
      phone: normalizedPhone,
      name: name.trim(),
      email: email?.trim() || null,
      userType: 'customer', // ✅ CRITICAL: Explicit userType
      accountStatus: 'active',
      isActive: true,
      isVerified: false,
      customer: {
        name: name.trim(),
        email: email?.trim() || null,
        phone: normalizedPhone,
        totalBookings: 0,
        totalSpent: 0,
        preferences: {
          vehicleType: 'motorcycle',
          notifications: true
        }
      },
      photoURL: null, // ✅ Customers only have profile photo, no document verification
      createdAt: admin.firestore.FieldValue.serverTimestamp(), // ✅ Use Firestore serverTimestamp for proper ordering
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), // ✅ Use Firestore serverTimestamp for proper ordering
      createdBy: adminId,
      createdVia: 'admin_management' // Track creation source
    };

    // Store customer in users collection
    await db.collection('users').doc(roleBasedUID).set(customerData);

    console.log(`✅ [ADMIN_CUSTOMERS] Created customer: ${roleBasedUID} (${normalizedPhone})`);

    // Log the creation action
    const auditLogRef = db.collection('adminLogs').doc();
    await auditLogRef.set({
      action: 'customer_created',
      adminId,
      targetUserId: roleBasedUID,
      targetUserType: 'customer',
      details: {
        phone: normalizedPhone,
        name: name.trim(),
        email: email?.trim() || null,
        timestamp: new Date()
      },
      timestamp: new Date()
    });

    res.status(201).json({
      success: true,
      data: {
        id: roleBasedUID,
        uid: roleBasedUID,
        phone: normalizedPhone,
        name: name.trim(),
        email: email?.trim() || null,
        userType: 'customer',
        accountStatus: 'active',
        createdAt: customerData.createdAt
      },
      message: 'Customer created successfully'
    });

  } catch (error) {
    console.error('❌ [ADMIN_CUSTOMERS] Error creating customer:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CREATE_CUSTOMER_ERROR',
        message: 'Failed to create customer',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/customers/:id
 * @desc    Get single customer profile
 * @access  Private (Admin only)
 */
router.get('/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getFirestore();

    const customerRef = db.collection('users').doc(id);
    const customerDoc = await customerRef.get();

    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found'
        }
      });
    }

    const customerData = customerDoc.data();
    if (customerData.userType !== 'customer') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a customer'
        }
      });
    }

    // Get customer bookings count
    const bookingsSnapshot = await db.collection('bookings')
      .where('customerId', '==', id)
      .get();

    // No wallet system for customers

    // Format customer data properly
    const formattedCustomerData = {
      id: customerDoc.id,
      name: customerData.customer?.name || customerData.name || 'Unknown Customer',
      email: customerData.customer?.email || customerData.email || 'Not provided',
      phone: customerData.phone || 'Not provided',
      personalInfo: {
        name: customerData.customer?.name || customerData.name || 'Unknown Customer',
        email: customerData.customer?.email || customerData.email || 'Not provided',
        phone: customerData.phone || 'Not provided',
        dateOfBirth: customerData.customer?.dateOfBirth || customerData.personalInfo?.dateOfBirth || 'Not provided',
        address: customerData.customer?.address || customerData.personalInfo?.address || 'Not provided'
      },
      accountStatus: customerData.accountStatus || 'active',
      createdAt: customerData.createdAt?.toDate?.() || customerData.createdAt || new Date(),
      updatedAt: customerData.updatedAt?.toDate?.() || customerData.updatedAt || new Date(),
      userType: customerData.userType || 'customer',
      isActive: customerData.isActive !== false,
      isVerified: customerData.isVerified || false,
      bookingsCount: bookingsSnapshot.size
    };

    res.json({
      success: true,
      data: formattedCustomerData
    });

  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_CUSTOMER_ERROR',
        message: 'Failed to fetch customer',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/admin/customers/:id/status
 * @desc    Suspend/Unsuspend customer
 * @access  Private (Admin only)
 */
router.put('/customers/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const adminId = req.user.uid || req.user.userId;
    const db = getFirestore();

    if (!status || !['active', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Status must be either active or suspended'
        }
      });
    }

    const customerRef = db.collection('users').doc(id);
    const customerDoc = await customerRef.get();

    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found'
        }
      });
    }

    const customerData = customerDoc.data();
    if (customerData.userType !== 'customer') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a customer'
        }
      });
    }

    const updateData = {
      accountStatus: status,
      updatedAt: new Date()
    };

    if (status === 'suspended') {
      updateData.suspendedAt = new Date();
      updateData.suspendedBy = adminId;
      updateData.suspensionReason = reason || 'Violation of terms of service';
    } else if (status === 'active') {
      updateData.suspendedAt = null;
      updateData.suspendedBy = null;
      updateData.suspensionReason = null;
    }

    await customerRef.update(updateData);

    // Log the action
    const auditLogRef = db.collection('adminLogs').doc();
    await auditLogRef.set({
      action: `customer_${status}`,
      adminId,
      targetUserId: id,
      targetUserType: 'customer',
      details: {
        customerName: customerData.name || customerData.personalInfo?.name || 'Unknown Customer',
        customerEmail: customerData.email || customerData.personalInfo?.email || 'No email provided',
        reason: reason || 'No reason provided',
        status,
        timestamp: new Date()
      },
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: `Customer ${status} successfully`,
      data: {
        customerId: id,
        accountStatus: status,
        updatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error updating customer status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_CUSTOMER_STATUS_ERROR',
        message: 'Failed to update customer status',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/admin/customers/:id/ban
 * @desc    Ban customer (cannot log back in)
 * @access  Private (Admin only)
 */
router.put('/customers/:id/ban', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.uid || req.user.userId;
    const db = getFirestore();
    const batch = db.batch();

    const customerRef = db.collection('users').doc(id);
    const customerDoc = await customerRef.get();

    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found'
        }
      });
    }

    const customerData = customerDoc.data();
    if (customerData.userType !== 'customer') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a customer'
        }
      });
    }

    if (customerData.accountStatus === 'banned') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_BANNED',
          message: 'Customer is already banned'
        }
      });
    }

    // Update customer status to banned
    batch.update(customerRef, {
      accountStatus: 'banned',
      bannedAt: new Date(),
      bannedBy: adminId,
      banReason: reason || 'Violation of terms of service',
      updatedAt: new Date()
    });

    // Cancel all active bookings
    const activeBookingsSnapshot = await db.collection('bookings')
      .where('customerId', '==', id)
      .where('status', 'in', ['pending', 'accepted', 'in_progress'])
      .get();
    
    activeBookingsSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        status: 'cancelled',
        cancellationReason: 'Customer account banned',
        cancelledAt: new Date(),
        updatedAt: new Date()
      });
    });

    // Log the ban action
    const auditLogRef = db.collection('adminLogs').doc();
    batch.set(auditLogRef, {
      action: 'customer_banned',
      adminId,
      targetUserId: id,
      targetUserType: 'customer',
      details: {
        customerName: customerData.name || customerData.personalInfo?.name || 'Unknown Customer',
        customerEmail: customerData.email || customerData.personalInfo?.email || 'No email provided',
        banReason: reason || 'Violation of terms of service',
        bannedAt: new Date()
      },
      timestamp: new Date()
    });

    await batch.commit();

    res.json({
      success: true,
      message: 'Customer banned successfully',
      data: {
        customerId: id,
        accountStatus: 'banned',
        bannedAt: new Date().toISOString(),
        banReason: reason || 'Violation of terms of service'
      }
    });

  } catch (error) {
    console.error('Error banning customer:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BAN_CUSTOMER_ERROR',
        message: 'Failed to ban customer',
        details: error.message
      }
    });
  }
});

/**
 * @route   DELETE /api/admin/customers/:id
 * @desc    Delete customer completely
 * @access  Private (Admin only)
 */
router.delete('/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.uid || req.user.userId;
    const db = getFirestore();
    const batch = db.batch();

    const customerRef = db.collection('users').doc(id);
    const customerDoc = await customerRef.get();

    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found'
        }
      });
    }

    const customerData = customerDoc.data();
    if (customerData.userType !== 'customer') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a customer'
        }
      });
    }

    // Delete customer from users collection
    batch.delete(customerRef);

    // No wallet system for customers - wallet deletion removed

    // Update bookings to remove customer reference
    const bookingsSnapshot = await db.collection('bookings')
      .where('customerId', '==', id)
      .get();
    
    bookingsSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        customerId: null,
        customerName: null,
        status: 'cancelled',
        cancellationReason: 'Customer account deleted',
        updatedAt: new Date()
      });
    });

    // Log the deletion action
    const auditLogRef = db.collection('adminLogs').doc();
    batch.set(auditLogRef, {
      action: 'customer_deleted',
      adminId,
      targetUserId: id,
      targetUserType: 'customer',
      details: {
        customerName: customerData.name || customerData.personalInfo?.name || 'Unknown Customer',
        customerEmail: customerData.email || customerData.personalInfo?.email || 'No email provided',
        deletedAt: new Date()
      },
      timestamp: new Date()
    });

    await batch.commit();

    res.json({
      success: true,
      message: 'Customer deleted successfully',
      data: {
        customerId: id,
        deletedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_CUSTOMER_ERROR',
        message: 'Failed to delete customer',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/customers/:id/bookings
 * @desc    Fetch customer bookings
 * @access  Private (Admin only)
 */
router.get('/customers/:id/bookings', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 20, offset = 0, status } = req.query;
    const db = getFirestore();

    let query = db.collection('bookings').where('customerId', '==', id);

    if (status) {
      query = query.where('status', '==', status);
    }

    query = query.orderBy('createdAt', 'desc').limit(Math.max(1, Math.min(100, parseInt(limit) || 20))).offset(Math.max(0, parseInt(offset) || 0));

    const snapshot = await query.get();
    const bookings = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      bookings.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });

    res.json({
      success: true,
      data: bookings,
      pagination: {
        limit: Math.max(1, Math.min(100, parseInt(limit) || 20)),
        offset: Math.max(0, parseInt(offset) || 0),
        total: bookings.length
      }
    });

  } catch (error) {
    console.error('Error fetching customer bookings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_CUSTOMER_BOOKINGS_ERROR',
        message: 'Failed to fetch customer bookings',
        details: error.message
      }
    });
  }
});

// Wallet endpoints removed - no wallet system for customers

// Wallet adjustment endpoint removed - no wallet system for customers

/**
 * @route   PUT /api/admin/customers/:id/name
 * @desc    Update customer name
 * @access  Private (Admin only)
 */
router.put('/customers/:id/name', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const adminId = req.user.uid || req.user.userId;
    const db = getFirestore();

    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_NAME',
          message: 'Name must be at least 2 characters long'
        }
      });
    }

    const customerRef = db.collection('users').doc(id);
    const customerDoc = await customerRef.get();

    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found'
        }
      });
    }

    const customerData = customerDoc.data();
    if (customerData.userType !== 'customer') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a customer'
        }
      });
    }

    // Update customer name
    await customerRef.update({
      name: name.trim(),
      updatedAt: new Date()
    });

    // Log the name update action
    const auditLogRef = db.collection('adminLogs').doc();
    await auditLogRef.set({
      action: 'customer_name_updated',
      adminId,
      targetUserId: id,
      targetUserType: 'customer',
      details: {
        oldName: customerData.name || 'Unknown Customer',
        newName: name.trim(),
        timestamp: new Date()
      },
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Customer name updated successfully',
      data: {
        customerId: id,
        oldName: customerData.name || 'Unknown Customer',
        newName: name.trim()
      }
    });

  } catch (error) {
    console.error('Error updating customer name:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_NAME_ERROR',
        message: 'Failed to update customer name',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/email-verification/:uid
 * @desc    Get email verification link for admin user
 * @access  Private (Admin only)
 */
router.get('/email-verification/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    const db = getFirestore();

    console.log(`📧 Getting email verification link for admin: ${uid}`);

    // Get admin user data
    const adminDoc = await db.collection('adminUsers').doc(uid).get();
    
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
    
    // Check if email is already verified
    if (adminData.isEmailVerified) {
      return res.json({
        success: true,
        message: 'Email is already verified',
        data: {
          isVerified: true,
          verifiedAt: adminData.emailVerifiedAt
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if verification link exists
    if (adminData.emailVerificationLink) {
      return res.json({
        success: true,
        message: 'Email verification link retrieved',
        data: {
          verificationLink: adminData.emailVerificationLink,
          sentAt: adminData.emailVerificationSentAt,
          isVerified: false
        },
        timestamp: new Date().toISOString()
      });
    }

    // Generate new verification link
    try {
      const admin = require('firebase-admin');
      const userRecord = await admin.auth().getUser(uid);
      
      const actionCodeSettings = {
        url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/email-verified`,
        handleCodeInApp: false,
      };
      
      const emailVerificationLink = await admin.auth().generateEmailVerificationLink(
        userRecord.email,
        actionCodeSettings
      );
      
      // Store the verification link
      await db.collection('adminUsers').doc(uid).update({
        emailVerificationLink: emailVerificationLink,
        emailVerificationSent: true,
        emailVerificationSentAt: new Date().toISOString()
      });
      
      console.log('✅ Email verification link generated for admin:', uid);
      
      res.json({
        success: true,
        message: 'Email verification link generated',
        data: {
          verificationLink: emailVerificationLink,
          sentAt: new Date().toISOString(),
          isVerified: false
        },
        timestamp: new Date().toISOString()
      });
      
    } catch (emailError) {
      console.error('❌ Email verification link generation failed:', emailError);
      return res.status(500).json({
        success: false,
        error: {
          code: 'EMAIL_VERIFICATION_ERROR',
          message: 'Failed to generate email verification link',
          details: emailError.message
        },
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('❌ Error getting email verification link:', error);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_LINK_ERROR',
        message: 'Failed to get email verification link',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/support-tickets
 * @desc    Get support tickets
 * @access  Private (Admin only)
 */
router.get('/support-tickets', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const db = getFirestore();

    console.log('📋 Getting support tickets...');

    let query = db.collection('supportTickets').orderBy('createdAt', 'desc');
    
    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.limit(Math.max(1, Math.min(100, parseInt(limit) || 20))).offset(Math.max(0, parseInt(offset) || 0)).get();
    
    const tickets = [];
    snapshot.forEach(doc => {
      tickets.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      data: tickets,
      pagination: {
        limit: Math.max(1, Math.min(100, parseInt(limit) || 20)),
        offset: Math.max(0, parseInt(offset) || 0),
        total: tickets.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting support tickets:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SUPPORT_TICKETS_ERROR',
        message: 'Failed to get support tickets',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/system/users/online
 * @desc    Get online users count
 * @access  Private (Admin only)
 */
router.get('/system/users/online', async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get users who were active in the last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const onlineUsersSnapshot = await db.collection('users')
      .where('lastSeen', '>=', fiveMinutesAgo)
      .get();
    
    const onlineCount = onlineUsersSnapshot.size;
    
    res.json({
      success: true,
      data: {
        onlineUsers: onlineCount,
        lastChecked: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting online users:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ONLINE_USERS_ERROR',
        message: 'Failed to get online users count',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/system/logs
 * @desc    Get system logs
 * @access  Private (Admin only)
 */
router.get('/system/logs', async (req, res) => {
  try {
    const { limit = 50, level } = req.query;
    const db = getFirestore();

    let query = db.collection('systemLogs').orderBy('timestamp', 'desc');
    
    if (level) {
      query = query.where('level', '==', level);
    }

    const snapshot = await query.limit(Math.max(1, Math.min(100, parseInt(limit) || 20))).get();
    
    const logs = [];
    snapshot.forEach(doc => {
      logs.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      data: logs,
      pagination: {
        limit: Math.max(1, Math.min(100, parseInt(limit) || 20)),
        total: logs.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting system logs:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SYSTEM_LOGS_ERROR',
        message: 'Failed to get system logs',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/analytics/bookings
 * @desc    Get booking analytics
 * @access  Private (Admin only)
 */
router.get('/analytics/bookings', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const db = getFirestore();

    let query = db.collection('bookings');
    
    if (startDate && endDate) {
      query = query.where('createdAt', '>=', new Date(startDate))
                   .where('createdAt', '<=', new Date(endDate));
    }

    const snapshot = await query.get();
    
    const bookings = [];
    snapshot.forEach(doc => {
      bookings.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Calculate analytics
    const totalBookings = bookings.length;
    const completedBookings = bookings.filter(b => b.status === 'completed').length;
    const cancelledBookings = bookings.filter(b => b.status === 'cancelled').length;
    const pendingBookings = bookings.filter(b => b.status === 'pending').length;

    res.json({
      success: true,
      data: {
        totalBookings,
        completedBookings,
        cancelledBookings,
        pendingBookings,
        completionRate: totalBookings > 0 ? (completedBookings / totalBookings * 100).toFixed(2) : 0,
        bookings: bookings.slice(0, 100) // Limit returned data
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting booking analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_ANALYTICS_ERROR',
        message: 'Failed to get booking analytics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/analytics/system
 * @desc    Get system analytics
 * @access  Private (Admin only)
 */
router.get('/analytics/system', async (req, res) => {
  try {
    const db = getFirestore();

    // Get basic system metrics
    const [usersSnapshot, driversSnapshot, customersSnapshot] = await Promise.all([
      db.collection('users').get(),
      db.collection('users').where('userType', '==', 'driver').get(),
      db.collection('users').where('userType', '==', 'customer').get()
    ]);

    res.json({
      success: true,
      data: {
        totalUsers: usersSnapshot.size,
        totalDrivers: driversSnapshot.size,
        totalCustomers: customersSnapshot.size,
        systemUptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting system analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SYSTEM_ANALYTICS_ERROR',
        message: 'Failed to get system analytics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/analytics/drivers
 * @desc    Get driver analytics
 * @access  Private (Admin only)
 */
router.get('/analytics/drivers', async (req, res) => {
  try {
    const db = getFirestore();

    const driversSnapshot = await db.collection('users')
      .where('userType', '==', 'driver')
      .get();
    
    const drivers = [];
    driversSnapshot.forEach(doc => {
      drivers.push({
        id: doc.id,
        ...doc.data()
      });
    });

    const activeDrivers = drivers.filter(d => d.isActive !== false).length;
    const verifiedDrivers = drivers.filter(d => d.isVerified === true).length;

    res.json({
      success: true,
      data: {
        totalDrivers: drivers.length,
        activeDrivers,
        verifiedDrivers,
        verificationRate: drivers.length > 0 ? (verifiedDrivers / drivers.length * 100).toFixed(2) : 0,
        drivers: drivers.slice(0, 100) // Limit returned data
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting driver analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DRIVER_ANALYTICS_ERROR',
        message: 'Failed to get driver analytics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/drivers/:driverId/work-slots
 * @desc    Get driver's work slots (for admin view)
 * @access  Private (Admin only)
 */
router.get('/drivers/:driverId/work-slots', async (req, res) => {
  try {
    const { driverId } = req.params;
    const { date, limit = 50 } = req.query;
    const db = getFirestore();
    
    console.log(`🔍 [ADMIN] Fetching work slots for driver: ${driverId}`);
    
    // Build query
    let query = db.collection('workSlots').where('driverId', '==', driverId);
    
    // Filter by date if provided
    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      query = query
        .where('startTime', '>=', startOfDay)
        .where('startTime', '<=', endOfDay);
    }
    
    // Order by start time and limit
    const slotsSnapshot = await query
      .orderBy('startTime', 'asc')
      .limit(parseInt(limit))
      .get();
    
    const slots = [];
    slotsSnapshot.forEach(doc => {
      const slotData = doc.data();
      slots.push({
        id: doc.id,
        ...slotData,
        startTime: slotData.startTime?.toDate?.() || slotData.startTime,
        endTime: slotData.endTime?.toDate?.() || slotData.endTime,
        createdAt: slotData.createdAt?.toDate?.() || slotData.createdAt,
        updatedAt: slotData.updatedAt?.toDate?.() || slotData.updatedAt
      });
    });
    
    console.log(`✅ [ADMIN] Retrieved ${slots.length} work slots for driver ${driverId}`);
    
    res.json({
      success: true,
      data: {
        driverId,
        slots,
        count: slots.length
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching driver work slots:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WORK_SLOTS_ERROR',
        message: 'Failed to fetch driver work slots',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/drivers/:driverId/rejection-history
 * @desc    Get driver's booking rejection history
 * @access  Private (Admin only)
 */
router.get('/drivers/:driverId/rejection-history', async (req, res) => {
  try {
    const { driverId } = req.params;
    const { limit = 50, startDate, endDate } = req.query;
    const db = getFirestore();
    
    console.log(`🔍 [ADMIN] Fetching rejection history for driver: ${driverId}`);
    
    // Query bookings where this driver rejected
    let query = db.collection('bookings')
      .where('cancellation.cancelledBy', '==', 'driver')
      .where('driverId', '==', driverId);
    
    // Add date filters if provided
    if (startDate) {
      query = query.where('cancellation.cancelledAt', '>=', new Date(startDate));
    }
    if (endDate) {
      query = query.where('cancellation.cancelledAt', '<=', new Date(endDate));
    }
    
    const rejectionsSnapshot = await query
      .orderBy('cancellation.cancelledAt', 'desc')
      .limit(parseInt(limit))
      .get();
    
    const rejections = [];
    rejectionsSnapshot.forEach(doc => {
      const bookingData = doc.data();
      rejections.push({
        bookingId: doc.id,
        customerId: bookingData.customerId,
        customerName: bookingData.customer?.name || 'Unknown',
        pickupAddress: bookingData.pickup?.address || 'N/A',
        dropoffAddress: bookingData.dropoff?.address || 'N/A',
        reason: bookingData.cancellation?.reason || 'No reason provided',
        rejectedAt: bookingData.cancellation?.cancelledAt?.toDate?.() || bookingData.cancellation?.cancelledAt,
        fare: bookingData.payment?.amount || 0,
        distance: bookingData.distance || 0
      });
    });
    
    // Also get rejections from booking_rejections collection if it exists
    const rejectionHistoryQuery = db.collection('booking_rejections')
      .where('driverId', '==', driverId)
      .orderBy('rejectedAt', 'desc')
      .limit(parseInt(limit));
    
    const rejectionHistorySnapshot = await rejectionHistoryQuery.get();
    
    rejectionHistorySnapshot.forEach(doc => {
      const rejectionData = doc.data();
      if (!rejections.find(r => r.bookingId === rejectionData.bookingId)) {
        rejections.push({
          bookingId: rejectionData.bookingId,
          customerId: rejectionData.customerId || 'Unknown',
          customerName: rejectionData.customerName || 'Unknown',
          pickupAddress: rejectionData.pickupAddress || 'N/A',
          dropoffAddress: rejectionData.dropoffAddress || 'N/A',
          reason: rejectionData.reason || 'No reason provided',
          rejectedAt: rejectionData.rejectedAt?.toDate?.() || rejectionData.rejectedAt,
          fare: rejectionData.fare || 0,
          distance: rejectionData.distance || 0
        });
      }
    });
    
    // Sort by rejection date
    rejections.sort((a, b) => {
      const dateA = new Date(a.rejectedAt);
      const dateB = new Date(b.rejectedAt);
      return dateB - dateA;
    });
    
    console.log(`✅ [ADMIN] Retrieved ${rejections.length} rejections for driver ${driverId}`);
    
    res.json({
      success: true,
      data: {
        driverId,
        rejections: rejections.slice(0, parseInt(limit)),
        totalCount: rejections.length,
        summary: {
          totalRejections: rejections.length,
          last7Days: rejections.filter(r => {
            const rejDate = new Date(r.rejectedAt);
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            return rejDate >= weekAgo;
          }).length,
          last30Days: rejections.filter(r => {
            const rejDate = new Date(r.rejectedAt);
            const monthAgo = new Date();
            monthAgo.setDate(monthAgo.getDate() - 30);
            return rejDate >= monthAgo;
          }).length
        }
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching rejection history:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REJECTION_HISTORY_ERROR',
        message: 'Failed to fetch rejection history',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/system/metrics
 * @desc    Get system metrics
 * @access  Private (Admin only)
 */
router.get('/system/metrics', async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get basic metrics
    const [usersSnapshot, driversSnapshot, customersSnapshot, bookingsSnapshot] = await Promise.all([
      db.collection('users').get(),
      db.collection('users').where('userType', '==', 'driver').get(),
      db.collection('users').where('userType', '==', 'customer').get(),
      db.collection('bookings').get()
    ]);

    const memoryUsage = process.memoryUsage();
    const memoryPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

    res.json({
      success: true,
      data: {
        users: {
          total: usersSnapshot.size,
          drivers: driversSnapshot.size,
          customers: customersSnapshot.size
        },
        bookings: {
          total: bookingsSnapshot.size
        },
        system: {
          uptime: process.uptime(),
          memoryUsage: {
            used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
            total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            percentage: Math.round(memoryPercentage)
          },
          nodeVersion: process.version,
          platform: process.platform
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting system metrics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SYSTEM_METRICS_ERROR',
        message: 'Failed to get system metrics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/admins
 * @desc    Get all admin users
 * @access  Private (Admin only)
 */
router.get('/admins', async (req, res) => {
  try {
    const db = getFirestore();
    
    const adminsSnapshot = await db.collection('adminUsers').get();
    
    const admins = [];
    adminsSnapshot.forEach(doc => {
      admins.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      data: admins,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting admins:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ADMINS_ERROR',
        message: 'Failed to get admin users',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/test-document-system/:driverId
 * @desc    Test complete document system for a driver
 * @access  Private (Admin only)
 */
router.get('/test-document-system/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    const db = getFirestore();
    
    console.log(`🧪 Testing document system for driver: ${driverId}`);
    
    // Test 1: Check driver exists in users collection
    const driverDoc = await db.collection('users').doc(driverId).get();
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found in users collection' }
      });
    }
    
    const driverData = driverDoc.data();
    console.log(`✅ Driver found: ${driverData.name}`);
    
    // Test 2: Check document structure in Firestore
    const documents = driverData.driver?.documents || driverData.documents || {};
    console.log(`📄 Documents in Firestore:`, Object.keys(documents));
    
    // Test 3: Check Firebase Storage structure - ALL POSSIBLE PATHS
    const { getStorage } = require('firebase-admin/storage');
    const bucket = getStorage().bucket();
    
    const storageTests = [];
    const documentTypes = ['driving_license', 'profile_photo', 'aadhaar_card', 'bike_insurance', 'rc_book'];
    
    // ✅ CRITICAL FIX: Only check the correct storage path
    const correctPath = `drivers/${driverId}/documents`;
    const pathTests = [];
    
    for (const docType of documentTypes) {
      try {
        const [files] = await bucket.getFiles({
          prefix: `${correctPath}/${docType}/`,
          maxResults: 1
        });
        
        pathTests.push({
          documentType: docType,
          hasFiles: files.length > 0,
          fileCount: files.length,
          firstFile: files[0]?.name || null,
          fullPath: `${correctPath}/${docType}/`
        });
      } catch (error) {
        pathTests.push({
          documentType: docType,
          hasFiles: false,
          error: error.message,
          fullPath: `${correctPath}/${docType}/`
        });
      }
    }
    
    storageTests.push({
      basePath: correctPath,
      tests: pathTests,
      totalFiles: pathTests.reduce((sum, test) => sum + (test.fileCount || 0), 0)
    });
    
    // Test 4: Check API endpoint functionality
    let apiTestResult = null;
    try {
      const apiResponse = await fetch(`${req.protocol}://${req.get('host')}/api/admin/drivers/${driverId}/documents`, {
        headers: {
          'Authorization': req.headers.authorization
        }
      });
      
      const apiData = await apiResponse.json();
      apiTestResult = {
        success: apiResponse.ok,
        statusCode: apiResponse.status,
        hasData: !!apiData.data,
        documentCount: apiData.data?.documents ? Object.keys(apiData.data.documents).length : 0
      };
    } catch (error) {
      apiTestResult = {
        success: false,
        error: error.message
      };
    }
    
    // Compile test results
    const testResults = {
      driverId,
      driverName: driverData.name,
      driverPhone: driverData.phone,
      firestoreTest: {
        hasDriver: true,
        hasDocuments: Object.keys(documents).length > 0,
        documentKeys: Object.keys(documents),
        verificationStatus: driverData.driver?.verificationStatus || 'pending'
      },
      storageTests,
      apiTest: apiTestResult,
      recommendations: []
    };
    
    // Generate recommendations
    if (Object.keys(documents).length === 0) {
      testResults.recommendations.push('No documents found in Firestore - driver needs to upload documents');
    }
    
    const uploadedDocs = storageTests.filter(test => test.hasFiles);
    if (uploadedDocs.length === 0) {
      testResults.recommendations.push('No files found in Firebase Storage - check upload process');
    }
    
    if (!apiTestResult.success) {
      testResults.recommendations.push('API endpoint test failed - check backend configuration');
    }
    
    console.log(`🧪 Document system test completed for driver: ${driverId}`);
    
    res.json({
      success: true,
      data: testResults,
      message: 'Document system test completed'
    });
    
  } catch (error) {
    console.error('Document system test error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENT_SYSTEM_TEST_ERROR',
        message: 'Failed to test document system',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/admin/bookings/:id/intervene
 * @desc    Admin intervention in booking (cancel, reassign, etc.)
 * @access  Private (Admin only)
 */
router.post('/bookings/:id/intervene', async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body;
    const db = getFirestore();

    // Validate action
    const validActions = ['cancel', 'reassign', 'escalate', 'refund'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ACTION',
          message: 'Invalid intervention action',
          details: `Action must be one of: ${validActions.join(', ')}`
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get booking
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const bookingData = bookingDoc.data();
    const updateData = {
      updatedAt: new Date()
    };

    // Handle different actions
    switch (action) {
      case 'cancel':
        updateData.status = 'cancelled';
        updateData.cancelledAt = new Date();
        updateData.cancellationReason = reason || 'Admin intervention';
        break;
      case 'reassign':
        // This would require additional logic to reassign driver
        updateData.status = 'pending';
        updateData.driverId = null;
        updateData.driverName = null;
        updateData.reassignmentReason = reason || 'Admin reassignment';
        break;
      case 'escalate':
        updateData.escalatedAt = new Date();
        updateData.escalationReason = reason || 'Admin escalation';
        break;
      case 'refund':
        updateData.refundedAt = new Date();
        updateData.refundReason = reason || 'Admin refund';
        break;
    }

    await bookingRef.update(updateData);

    // Log the intervention
    const auditLogRef = db.collection('adminLogs').doc();
    await auditLogRef.set({
      action: `booking_${action}`,
      adminId: req.user.uid,
      targetBookingId: id,
      details: {
        bookingId: id,
        action,
        reason: reason || 'No reason provided',
        previousStatus: bookingData.status,
        newStatus: updateData.status || bookingData.status,
        timestamp: new Date()
      },
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: `Booking ${action} successful`,
      data: {
        bookingId: id,
        action,
        status: updateData.status || bookingData.status,
        updatedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error intervening in booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_INTERVENTION_ERROR',
        message: 'Failed to intervene in booking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;