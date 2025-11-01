const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');

/**
 * Role-Based Authentication Service
 * Handles same phone number with different roles using separate UIDs
 */
class RoleBasedAuthService {
  constructor() {
    this.initializeFirebase();
    this.db = getFirestore();
  }

  /**
   * Initialize Firebase Admin SDK
   */
  initializeFirebase() {
    try {
      if (admin.apps.length > 0) {
        console.log('✅ Firebase Admin SDK already initialized');
        return admin.app();
      }

      if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PROJECT_ID) {
        let privateKey = process.env.FIREBASE_PRIVATE_KEY;
        
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
          try {
            privateKey = Buffer.from(privateKey, 'base64').toString('utf8');
          } catch {
            privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
          }
        } else {
          privateKey = privateKey.replace(/\\n/g, '\n');
        }

        const serviceAccount = {
          type: "service_account",
          project_id: process.env.FIREBASE_PROJECT_ID,
          private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
          private_key: privateKey,
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          client_id: process.env.FIREBASE_CLIENT_ID,
          auth_uri: process.env.FIREBASE_AUTH_URI,
          token_uri: process.env.FIREBASE_TOKEN_URI,
          auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
          client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
        };

        const app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID
        });

        console.log('✅ Firebase Admin SDK initialized with service account');
        return app;
      } else {
        const app = admin.initializeApp();
        console.log('✅ Firebase Admin SDK initialized with default credentials');
        return app;
      }
    } catch (error) {
      console.error('❌ Firebase initialization failed:', error);
      throw error;
    }
  }

  /**
   * Generate role-specific UID for same phone number
   * @param {string} phoneNumber - Phone number
   * @param {string} userType - User type (customer, driver, admin)
   * @returns {string} Role-specific UID
   */
  generateRoleSpecificUID(phoneNumber, userType) {
    const normalizedType = (userType || '').toString().trim().toLowerCase();
    const allowed = new Set(['customer', 'driver', 'admin']);
    
    // ✅ CRITICAL FIX: Never default to customer - validate userType
    if (!normalizedType || !allowed.has(normalizedType)) {
      console.error('❌ [ROLE_BASED_AUTH] Invalid or missing userType for UID generation:', userType);
      throw new Error(`Invalid userType: ${userType}. Must be one of: customer, driver, admin`);
    }
    
    const safeType = normalizedType; // Now guaranteed to be valid
    // Create a deterministic but role-specific UID
    const baseString = `${phoneNumber}_${safeType}`;
    const hash = crypto.createHash('sha256').update(baseString).digest('hex');
    
    // Take first 28 characters and ensure it starts with a letter
    let uid = hash.substring(0, 28);
    if (!/^[a-zA-Z]/.test(uid)) {
      uid = 'U' + uid.substring(1, 28);
    }
    
    return uid;
  }

  /**
   * Get or create user with role-specific UID
   * @param {Object} decodedToken - Firebase decoded token
   * @param {string} userType - User type (customer, driver)
   * @param {Object} additionalData - Additional user data
   * @returns {Promise<Object>} User data with role-specific UID
   */
  async getOrCreateRoleSpecificUser(decodedToken, userType, additionalData = {}) {
    try {
      const phoneNumber = decodedToken.phone_number;
      const normalizedType = (userType || '').toString().trim().toLowerCase();
      const allowed = new Set(['customer', 'driver', 'admin']);
      
      // ✅ CRITICAL FIX: Never default to customer without validation
      // This ensures driver users don't accidentally get customer role
      if (!normalizedType || !allowed.has(normalizedType)) {
        console.error('❌ [ROLE_BASED_AUTH] Invalid or missing userType:', userType);
        throw new Error(`Invalid userType: ${userType}. Must be one of: customer, driver, admin`);
      }
      
      const safeType = normalizedType; // Now guaranteed to be valid
      const roleSpecificUID = this.generateRoleSpecificUID(phoneNumber, safeType);
      
      console.log(`🔑 Generated role-specific UID for ${safeType}: ${roleSpecificUID}`);
      
      // Check if user with this role-specific UID exists
      const userDoc = await this.db.collection('users').doc(roleSpecificUID).get();
      
      if (userDoc.exists) {
        console.log(`✅ Found existing ${userType} user: ${roleSpecificUID}`);
        
        // ✅ CRITICAL FIX: Ensure returned data includes id and uid fields
        // Note: Custom claims will be set by the calling code in auth.js
        const userData = userDoc.data();
        return {
          ...userData,
          id: roleSpecificUID,
          uid: roleSpecificUID
        };
      }
      
      // Create new user with role-specific UID
      console.log(`👤 Creating new ${safeType} user: ${roleSpecificUID}`);
      const userData = await this.createRoleSpecificUser(decodedToken, safeType, roleSpecificUID, additionalData);
      
      return userData;
      
    } catch (error) {
      console.error(`❌ Error in getOrCreateRoleSpecificUser:`, error);
      throw error;
    }
  }

  /**
   * Create user with role-specific UID
   * @param {Object} decodedToken - Firebase decoded token
   * @param {string} userType - User type (customer, driver, admin)
   * @param {string} roleSpecificUID - Role-specific UID
   * @param {Object} additionalData - Additional user data
   * @returns {Promise<Object>} Created user data
   */
  async createRoleSpecificUser(decodedToken, userType, roleSpecificUID, additionalData = {}) {
    try {
      const baseUserData = {
        id: roleSpecificUID,
        uid: roleSpecificUID,
        originalFirebaseUID: decodedToken.uid, // Keep original Firebase UID for reference
        email: decodedToken.email || null,
        phone: decodedToken.phone_number || null,
        name: decodedToken.name || additionalData.name || null,
        photoURL: decodedToken.picture || null,
        userType: userType,
        isVerified: true,
        isActive: true,
        accountStatus: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...additionalData
      };

      // Add role-specific fields
      if (userType === 'driver') {
        baseUserData.driver = {
          vehicleDetails: {
            type: 'motorcycle',
            model: '',
            number: '',
            color: ''
          },
          verificationStatus: 'pending',
          isOnline: false,
          isAvailable: false,
          rating: 0,
          totalTrips: 0,
          earnings: {
            total: 0,
            thisMonth: 0,
            thisWeek: 0
          },
          wallet: {
            balance: 0,
            currency: 'INR',
            lastUpdated: new Date().toISOString(),
            transactions: []
          },
          currentLocation: null,
          welcomeBonusGiven: false,
          welcomeBonusAmount: 0,
          welcomeBonusGivenAt: null,
          documents: {},
          verificationRequests: []
        };
      } else if (userType === 'customer') {
        baseUserData.customer = {
          totalBookings: 0,
          totalSpent: 0,
          preferences: {
            vehicleType: 'motorcycle',
            notifications: true
          },
          wallet: {
            balance: 0,
            currency: 'INR',
            lastUpdated: new Date().toISOString(),
            transactions: []
          }
        };
      } else if (userType === 'admin') {
        baseUserData.role = additionalData.role || 'super_admin';
        baseUserData.permissions = additionalData.permissions || ['all'];
        baseUserData.isEmailVerified = true;
        baseUserData.isActive = true;
        baseUserData.accountStatus = 'active';
      }

      // Create user document
      await this.db.collection('users').doc(roleSpecificUID).set(baseUserData);
      
      // Note: Custom claims will be set by the calling code in auth.js
      console.log(`✅ Created ${userType} user with role-specific UID: ${roleSpecificUID}`);
      
      return baseUserData;
      
    } catch (error) {
      console.error(`❌ Error creating role-specific user:`, error);
      throw error;
    }
  }

  /**
   * Get user by role-specific UID
   * @param {string} roleSpecificUID - Role-specific UID
   * @returns {Promise<Object|null>} User data
   */
  async getUserByRoleSpecificUID(roleSpecificUID) {
    try {
      const userDoc = await this.db.collection('users').doc(roleSpecificUID).get();
      
      if (!userDoc.exists) {
        return null;
      }
      
      // ✅ CRITICAL FIX: Ensure returned data includes id and uid fields
      const userData = userDoc.data();
      return {
        ...userData,
        id: roleSpecificUID,
        uid: roleSpecificUID
      };
      
    } catch (error) {
      console.error(`❌ Error getting user by role-specific UID:`, error);
      throw error;
    }
  }

  /**
   * Get all roles for a phone number
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<Array>} Array of user roles
   */
  async getRolesForPhone(phoneNumber) {
    try {
      const usersSnapshot = await this.db.collection('users')
        .where('phone', '==', phoneNumber)
        .get();
      
      const roles = [];
      usersSnapshot.forEach(doc => {
        const userData = doc.data();
        roles.push({
          uid: doc.id,
          userType: userData.userType,
          name: userData.name,
          createdAt: userData.createdAt
        });
      });
      
      return roles;
      
    } catch (error) {
      console.error(`❌ Error getting roles for phone:`, error);
      throw error;
    }
  }

  /**
   * Check if user exists with specific role
   * @param {string} phoneNumber - Phone number
   * @param {string} userType - User type
   * @returns {Promise<boolean>} True if user exists with this role
   */
  async userExistsWithRole(phoneNumber, userType) {
    try {
      const roleSpecificUID = this.generateRoleSpecificUID(phoneNumber, userType);
      const userDoc = await this.db.collection('users').doc(roleSpecificUID).get();
      
      return userDoc.exists;
      
    } catch (error) {
      console.error(`❌ Error checking user existence with role:`, error);
      throw error;
    }
  }
}

// Use lazy initialization to avoid Firebase initialization issues
let roleBasedAuthServiceInstance = null;

function getRoleBasedAuthService() {
  if (!roleBasedAuthServiceInstance) {
    roleBasedAuthServiceInstance = new RoleBasedAuthService();
  }
  return roleBasedAuthServiceInstance;
}

// Export a proxy object that creates the instance only when methods are called
const lazyRoleBasedAuthService = new Proxy({}, {
  get(target, prop) {
    const instance = getRoleBasedAuthService();
    return instance[prop];
  }
});

module.exports = lazyRoleBasedAuthService;
module.exports.RoleBasedAuthService = RoleBasedAuthService;
module.exports.getRoleBasedAuthService = getRoleBasedAuthService;
