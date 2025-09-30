const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');

/**
 * Firebase Authentication Service for Backend
 * Handles Firebase ID token verification and user management
 */
class FirebaseAuthService {
  constructor() {
    this.auth = null;
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize Firebase services (lazy initialization)
   */
  initialize() {
    if (this.initialized) return;
    
    try {
      this.auth = admin.auth();
      this.db = getFirestore();
      this.initialized = true;
      console.log('✅ Firebase Auth Service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Firebase Auth Service:', error.message);
      throw error;
    }
  }

  /**
   * Ensure Firebase services are initialized
   */
  ensureInitialized() {
    if (!this.initialized) {
      this.initialize();
    }
  }

  /**
   * Verify Firebase ID token
   * @param {string} idToken - Firebase ID token
   * @returns {Promise<Object>} Decoded token with user info
   */
  async verifyIdToken(idToken) {
    try {
      this.ensureInitialized();
      
      if (!idToken) {
        throw new Error('ID token is required');
      }

      // Verify the Firebase ID token
      const decodedToken = await this.auth.verifyIdToken(idToken);
      
      console.log('✅ Firebase ID token verified successfully:', {
        uid: decodedToken.uid,
        email: decodedToken.email,
        phone_number: decodedToken.phone_number,
        auth_time: new Date(decodedToken.auth_time * 1000).toISOString()
      });

      return decodedToken;
    } catch (error) {
      console.error('❌ Firebase ID token verification failed:', error.message);
      
      // Handle specific Firebase Auth errors
      if (error.code === 'auth/id-token-expired') {
        throw new Error('Token has expired. Please login again.');
      } else if (error.code === 'auth/id-token-revoked') {
        throw new Error('Token has been revoked. Please login again.');
      } else if (error.code === 'auth/invalid-id-token') {
        throw new Error('Invalid token format.');
      } else if (error.code === 'auth/argument-error') {
        throw new Error('Invalid token provided.');
      }
      
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Get user data from Firestore based on Firebase UID
   * @param {string} uid - Firebase UID
   * @param {string} userType - Type of user (customer, driver, admin)
   * @returns {Promise<Object|null>} User data or null if not found
   */
  async getUserByUid(uid, userType = null) {
    try {
      this.ensureInitialized();
      
      // All users are now in the 'users' collection with userType field
      const userDoc = await this.db.collection('users').doc(uid).get();
      
      if (!userDoc.exists) {
        console.log(`❌ User not found in users collection:`, uid);
        return null;
      }

      const userData = userDoc.data();
      
      // If userType is specified, verify it matches
      if (userType && userData.userType !== userType) {
        console.log(`⚠️ User type mismatch: expected ${userType}, found ${userData.userType}`);
        return null;
      }

      console.log(`✅ Found user in users collection:`, uid, `(userType: ${userData.userType})`);
      return userData;
    } catch (error) {
      console.error('❌ Error fetching user data from Firestore:', error);
      throw new Error('Failed to fetch user data');
    }
  }

  /**
   * Create or update user data in Firestore
   * @param {Object} decodedToken - Decoded Firebase token
   * @param {Object} additionalData - Additional user data
   * @param {string} userType - Type of user (customer, driver, admin)
   * @returns {Promise<Object>} Created/updated user data
   */
  async createOrUpdateUser(decodedToken, additionalData = {}, userType = 'customer') {
    try {
      this.ensureInitialized();
      const uid = decodedToken.uid;
      const userData = {
        id: uid,
        email: decodedToken.email || null,
        phone: decodedToken.phone_number || null,
        name: decodedToken.name || additionalData.name || null,
        photoURL: decodedToken.picture || null,
        isVerified: true, // Firebase users are verified by default
        isActive: true, // Set account as active by default
        accountStatus: 'active', // Set account status as active
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...additionalData
      };

      // Add driver-specific fields if userType is 'driver'
      if (userType === 'driver') {
        userData.driver = {
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
          welcomeBonusAmount: 500,
          welcomeBonusGivenAt: null
        };
      }

      // All users go into the 'users' collection with userType field
      const collectionName = 'users';
      
      // Add userType to userData
      userData.userType = userType;

      // Check if user already exists
      const existingUser = await this.getUserByUid(uid, userType);
      
      if (existingUser) {
        // Update existing user
        userData.updatedAt = new Date().toISOString();
        await this.db.collection(collectionName).doc(uid).update(userData);
        console.log(`✅ Updated ${userType} user in Firestore:`, uid);
      } else {
        // Create new user
        await this.db.collection(collectionName).doc(uid).set(userData);
        console.log(`✅ Created new ${userType} user in Firestore:`, uid);
      }

      // Set custom claims for userType
      await this.setCustomClaims(uid, { userType, role: userType });

      return userData;
    } catch (error) {
      console.error(`❌ Error creating/updating ${userType} user:`, error);
      throw new Error(`Failed to create/update user: ${error.message}`);
    }
  }

  /**
   * Get user role for admin users
   * @param {string} uid - Firebase UID
   * @returns {Promise<string>} User role
   */
  async getUserRole(uid) {
    try {
      this.ensureInitialized();
      const adminDoc = await this.db.collection('admins').doc(uid).get();
      if (adminDoc.exists) {
        return adminDoc.data().role || 'pending';
      }
      return 'pending';
    } catch (error) {
      console.error('❌ Error fetching user role:', error);
      return 'pending';
    }
  }

  /**
   * Revoke user session (sign out)
   * @param {string} uid - Firebase UID
   * @returns {Promise<void>}
   */
  async revokeUserSession(uid) {
    try {
      this.ensureInitialized();
      await this.auth.revokeRefreshTokens(uid);
      console.log('✅ User session revoked:', uid);
    } catch (error) {
      console.error('❌ Error revoking user session:', error);
      throw new Error('Failed to revoke user session');
    }
  }

  /**
   * Get user by email
   * @param {string} email - User email
   * @returns {Promise<Object|null>} User data or null if not found
   */
  async getUserByEmail(email) {
    try {
      this.ensureInitialized();
      const userRecord = await this.auth.getUserByEmail(email);
      return userRecord;
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        return null;
      }
      console.error('❌ Error fetching user by email:', error);
      throw new Error('Failed to fetch user by email');
    }
  }

  /**
   * Set custom claims for a user
   * @param {string} uid - Firebase UID
   * @param {Object} claims - Custom claims to set
   * @returns {Promise<void>}
   */
  async setCustomClaims(uid, claims) {
    try {
      this.ensureInitialized();
      await this.auth.setCustomUserClaims(uid, claims);
      console.log(`✅ Custom claims set for user ${uid}:`, claims);
    } catch (error) {
      console.error('❌ Error setting custom claims:', error);
      throw new Error('Failed to set custom claims');
    }
  }

  /**
   * Create custom token for testing or special cases
   * @param {string} uid - Firebase UID
   * @param {Object} additionalClaims - Additional claims
   * @returns {Promise<string>} Custom token
   */
  async createCustomToken(uid, additionalClaims = {}) {
    try {
      this.ensureInitialized();
      const customToken = await this.auth.createCustomToken(uid, additionalClaims);
      return customToken;
    } catch (error) {
      console.error('❌ Error creating custom token:', error);
      throw new Error('Failed to create custom token');
    }
  }
}

module.exports = new FirebaseAuthService();
