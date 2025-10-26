const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');
const crypto = require('crypto');

/**
 * Role-Based Authentication Service
 * Handles same phone number with different roles using separate UIDs
 */
class RoleBasedAuthService {
  constructor() {
    this.db = getFirestore();
  }

  /**
   * Generate role-specific UID for same phone number
   * @param {string} phoneNumber - Phone number
   * @param {string} userType - User type (customer, driver, admin)
   * @returns {string} Role-specific UID
   */
  generateRoleSpecificUID(phoneNumber, userType) {
    // Create a deterministic but role-specific UID
    const baseString = `${phoneNumber}_${userType}`;
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
      const roleSpecificUID = this.generateRoleSpecificUID(phoneNumber, userType);
      
      console.log(`🔑 Generated role-specific UID for ${userType}: ${roleSpecificUID}`);
      
      // Check if user with this role-specific UID exists
      const userDoc = await this.db.collection('users').doc(roleSpecificUID).get();
      
      if (userDoc.exists) {
        console.log(`✅ Found existing ${userType} user: ${roleSpecificUID}`);
        
        // ✅ CRITICAL FIX: Ensure custom claims are set for existing users
        try {
          await admin.auth().setCustomUserClaims(decodedToken.uid, {
            role: userType,
            roleBasedUID: roleSpecificUID,
            phone: decodedToken.phone_number,
            appType: 'customer_app',
            verified: true
          });
          console.log(`✅ Custom claims updated for existing user: ${decodedToken.uid}`);
        } catch (claimsError) {
          console.error('❌ Failed to update custom claims for existing user:', claimsError);
        }
        
        return userDoc.data();
      }
      
      // Create new user with role-specific UID
      console.log(`👤 Creating new ${userType} user: ${roleSpecificUID}`);
      const userData = await this.createRoleSpecificUser(decodedToken, userType, roleSpecificUID, additionalData);
      
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
      
      // ✅ CRITICAL FIX: Set custom claims for Firebase Auth
      try {
        await admin.auth().setCustomUserClaims(decodedToken.uid, {
          role: userType,
          roleBasedUID: roleSpecificUID,
          phone: decodedToken.phone_number,
          appType: 'customer_app',
          verified: true
        });
        console.log(`✅ Custom claims set for Firebase UID: ${decodedToken.uid}`);
      } catch (claimsError) {
        console.error('❌ Failed to set custom claims:', claimsError);
        // Don't fail the entire process for claims error
      }
      
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
      
      return userDoc.data();
      
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
