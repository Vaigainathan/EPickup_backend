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
      // Check if Firebase Admin SDK is actually initialized
      if (admin.apps.length === 0) {
        console.error('❌ Firebase Admin SDK is not initialized! Cannot initialize Auth Service.');
        throw new Error('Firebase Admin SDK must be initialized before FirebaseAuthService');
      }
      
      this.auth = admin.auth();
      this.db = getFirestore();
      this.initialized = true;
      console.log('✅ Firebase Auth Service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Firebase Auth Service:', error.message);
      this.auth = null;
      this.db = null;
      this.initialized = false;
      throw error;
    }
  }

  /**
   * Ensure Firebase services are initialized
   */
  ensureInitialized() {
    if (!this.initialized || !this.auth) {
      this.initialize();
    }
    
    if (!this.auth) {
      throw new Error('Firebase Auth is not available. Please check Firebase Admin SDK initialization.');
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
   * Get user by phone number from Firebase Auth
   * @param {string} phoneNumber - Phone number in E.164 format
   * @returns {Promise<Object|null>} User record or null if not found
   */
  async getUserByPhoneNumber(phoneNumber) {
    try {
      this.ensureInitialized();
      
      if (!phoneNumber) {
        throw new Error('Phone number is required');
      }

      // Get user by phone number from Firebase Auth
      const userRecord = await this.auth.getUserByPhoneNumber(phoneNumber);
      
      console.log('✅ Found user by phone number:', {
        uid: userRecord.uid,
        phoneNumber: userRecord.phoneNumber,
        disabled: userRecord.disabled
      });

      return userRecord;
    } catch (error) {
      // If user not found, return null instead of throwing
      if (error.code === 'auth/user-not-found') {
        console.log('ℹ️ No user found with phone number:', phoneNumber);
        return null;
      }
      
      console.error('❌ Error getting user by phone number:', error.message);
      throw error;
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
      
      // For admin users, check adminUsers collection first
      if (userType === 'admin') {
        const adminDoc = await this.db.collection('adminUsers').doc(uid).get();
        if (adminDoc.exists) {
          const adminData = adminDoc.data();
          console.log(`✅ Found admin user in adminUsers collection:`, uid);
          
          // Also check/sync with users collection
          const userDoc = await this.db.collection('users').doc(uid).get();
          if (!userDoc.exists) {
            // Sync admin user to users collection
            await this.db.collection('users').doc(uid).set({
              ...adminData,
              userType: 'admin',
              originalFirebaseUID: uid
            });
            console.log(`✅ Synced admin user to users collection:`, uid);
          }
          
          return {
            ...adminData,
            userType: 'admin',
            originalFirebaseUID: uid
          };
        } else {
          // Admin user not found in adminUsers collection, check users collection
          const userDoc = await this.db.collection('users').doc(uid).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            if (userData.userType === 'admin') {
              // Sync to adminUsers collection
              await this.db.collection('adminUsers').doc(uid).set({
                ...userData,
                originalFirebaseUID: uid
              });
              console.log(`✅ Synced admin user to adminUsers collection:`, uid);
              
              return {
                ...userData,
                originalFirebaseUID: uid
              };
            }
          }
          
          console.log(`❌ Admin user not found in any collection:`, uid);
          return null;
        }
      }
      
      // Check users collection for all user types
      const userDoc = await this.db.collection('users').doc(uid).get();
      
      if (!userDoc.exists) {
        console.log(`❌ User not found in users collection:`, uid);
        return null;
      }

      const userData = userDoc.data();
      
      // If userType is specified, check if user can switch roles
      if (userType && userData.userType !== userType) {
        console.log(`🔄 User type switch requested: ${userData.userType} → ${userType}`);
        
        // Allow role switching for same phone number
        // Update user type and return updated data
        const updatedUserData = {
          ...userData,
          userType: userType,
          updatedAt: new Date().toISOString(),
          roleSwitchedAt: new Date().toISOString(),
          previousUserType: userData.userType
        };
        
        // Update the user document with new role
        await this.db.collection('users').doc(uid).update({
          userType: userType,
          updatedAt: new Date().toISOString(),
          roleSwitchedAt: new Date().toISOString(),
          previousUserType: userData.userType
        });
        
        console.log(`✅ User role switched successfully: ${userData.userType} → ${userType}`);
        return updatedUserData;
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
          welcomeBonusAmount: 0,
          welcomeBonusGivenAt: null
        };
      }

      // For admin users, store in both adminUsers and users collections
      if (userType === 'admin') {
        // Store in adminUsers collection (Admin App expects this)
        await this.db.collection('adminUsers').doc(uid).set({
          ...userData,
          userType: 'admin',
          role: userData.role || 'super_admin',
          permissions: userData.permissions || ['all']
        });
        console.log(`✅ Stored admin user in adminUsers collection:`, uid);
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
      if (userType === 'admin') {
        // For admin users, set proper role based on user data
        const adminRole = userData.role || 'super_admin';
        await this.setCustomClaims(uid, { userType: 'admin', role: adminRole });
      } else {
        await this.setCustomClaims(uid, { userType, role: userType });
      }

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

// Use lazy initialization to avoid Firebase initialization issues
let firebaseAuthServiceInstance = null;

function getFirebaseAuthService() {
  if (!firebaseAuthServiceInstance) {
    firebaseAuthServiceInstance = new FirebaseAuthService();
  }
  return firebaseAuthServiceInstance;
}

// Export a proxy object that creates the instance only when methods are called
const lazyFirebaseAuthService = new Proxy({}, {
  get(target, prop) {
    const instance = getFirebaseAuthService();
    return instance[prop];
  }
});

module.exports = lazyFirebaseAuthService;
module.exports.FirebaseAuthService = FirebaseAuthService;
module.exports.getFirebaseAuthService = getFirebaseAuthService;
