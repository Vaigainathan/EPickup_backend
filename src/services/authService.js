const { getFirestore } = require('./firebase');
const twilioService = require('./twilioService');
const JWTService = require('./jwtService');
const crypto = require('crypto');

/**
 * Authentication Service
 * Handles OTP generation, verification, session management, and user authentication
 */
class AuthService {
  constructor() {
    this.db = getFirestore();
    this.jwtService = new JWTService();
  }

  /**
   * Generate OTP for phone number using Twilio Verify
   * @param {string} phoneNumber - Phone number to send OTP to
   * @param {boolean} isSignup - Whether this is for signup or login
   * @param {Object} options - Additional options for OTP
   * @returns {Promise<Object>} OTP session data
   */
  async generateOTP(phoneNumber, isSignup = false, options = {}) {
    try {
      // Check if user already exists in Firestore
      const userQuery = await this.db.collection('users').where('phone', '==', phoneNumber).limit(1).get();
      const existingUser = userQuery.empty ? null : userQuery.docs[0].data();
      
      if (isSignup && existingUser) {
        throw new Error('USER_EXISTS');
      }

      if (!isSignup && !existingUser) {
        throw new Error('USER_NOT_FOUND');
      }

      // Send OTP via Twilio Verify
      const result = await twilioService.sendOTP(phoneNumber, {
        ...options,
        metadata: {
          isSignup,
          ...options.metadata
        }
      });

      if (!result.success) {
        throw new Error(result.error?.code || 'OTP_SEND_FAILED');
      }

      return {
        success: true,
        sessionId: result.verificationSid,
        expiresIn: '10 minutes',
        resendCount: 0,
        maxResends: 3,
        channel: result.channel,
        to: result.to
      };

    } catch (error) {
      console.error('Error generating OTP:', error);
      throw error;
    }
  }

  /**
   * Verify OTP and authenticate user using Twilio Verify
   * @param {string} phoneNumber - Phone number
   * @param {string} otp - OTP to verify
   * @param {string} verificationSid - Verification session ID (optional)
   * @param {Object} userData - User data for new signups
   * @returns {Promise<Object>} Authentication result
   */
  async verifyOTP(phoneNumber, otp, verificationSid = null, userData = {}) {
    try {
      // Verify OTP via Twilio
      const result = await twilioService.verifyOTP(phoneNumber, otp, verificationSid);

      if (!result.success) {
        throw new Error('INVALID_OTP');
      }

      // Get or create user
      const { user, isNewUser } = await this.getOrCreateUser(phoneNumber, userData);

      // Generate JWT token for session management
      const token = this.generateJWTToken({
        userId: user.id,
        userType: user.userType,
        phone: user.phone
      });

      return {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          userType: user.userType,
          isVerified: user.isVerified
        },
        token: token,
        isNewUser
      };

    } catch (error) {
      console.error('Error verifying OTP:', error);
      throw error;
    }
  }

  /**
   * Resend OTP to phone number using Twilio Verify
   * @param {string} phoneNumber - Phone number
   * @param {Object} options - Additional options for resend
   * @returns {Promise<Object>} Resend result
   */
  async resendOTP(phoneNumber, options = {}) {
    try {
      // Resend OTP via Twilio
      const result = await twilioService.resendOTP(phoneNumber, options);

      if (!result.success) {
        throw new Error(result.error?.code || 'OTP_RESEND_FAILED');
      }

      return {
        success: true,
        sessionId: result.verificationSid,
        expiresIn: '10 minutes',
        channel: result.channel,
        to: result.to
      };

    } catch (error) {
      console.error('Error resending OTP:', error);
      throw error;
    }
  }

  /**
   * Get or create user based on phone number
   * @param {string} phoneNumber - Phone number
   * @param {Object} userData - User data for new signups
   * @returns {Promise<Object>} User data and creation status
   */
  async getOrCreateUser(phoneNumber, userData = {}) {
    try {
      // Normalize phone number (remove spaces, dashes, etc.)
      const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
      
      // Check if user exists in Firestore with proper query
      const userQuery = await this.db.collection('users')
        .where('phone', '==', normalizedPhone)
        .limit(1)
        .get();

      let user;
      let isNewUser = false;

      if (!userQuery.empty) {
        // User exists - return existing user
        const userDoc = userQuery.docs[0];
        user = {
          id: userDoc.id,
          ...userDoc.data()
        };
        
        // Update last login time for existing user
        await this.db.collection('users').doc(userDoc.id).update({
          lastLoginAt: new Date(),
          updatedAt: new Date()
        });
        
        console.log(`✅ Existing user found: ${user.id} (${normalizedPhone}) - Type: ${user.userType}`);
      } else {
        // User doesn't exist - create new user
        if (!userData.name) {
          throw new Error('NAME_REQUIRED_FOR_NEW_USER');
        }

        const userType = userData.userType || 'customer';

        // Validate user type
        if (!this.isValidUserType(userType)) {
          throw new Error(`INVALID_USER_TYPE: ${userType}`);
        }

        // Create unique user ID
        const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create base user document in Firestore
        const newUserData = {
          id: userId,
          phone: normalizedPhone,
          name: userData.name,
          userType: userType,
          isVerified: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: new Date()
        };

        // Add user type specific data using the extensible method
        const typeSpecificData = this.getUserTypeSpecificData(userType, userData);
        Object.assign(newUserData, typeSpecificData);

        // Create user document with transaction to ensure atomicity
        await this.db.runTransaction(async (transaction) => {
          // Double-check that user doesn't exist (race condition protection)
          const doubleCheckQuery = await transaction.get(
            this.db.collection('users').where('phone', '==', normalizedPhone).limit(1)
          );
          
          if (!doubleCheckQuery.empty) {
            throw new Error('USER_ALREADY_EXISTS');
          }
          
          // Create the user document
          transaction.set(this.db.collection('users').doc(userId), newUserData);
        });

        user = newUserData;
        isNewUser = true;
        
        console.log(`✅ New user created: ${userId} (${normalizedPhone}) - Type: ${userType}`);
      }

      return { user, isNewUser };

    } catch (error) {
      console.error('Error getting or creating user:', error);
      throw error;
    }
  }

  /**
   * Validate if user type is supported
   * @param {string} userType - User type to validate
   * @returns {boolean} True if valid
   */
  isValidUserType(userType) {
    const validUserTypes = ['customer', 'driver', 'admin', 'support'];
    return validUserTypes.includes(userType);
  }

  /**
   * Get user type specific data structure
   * @param {string} userType - User type
   * @param {Object} userData - Additional user data
   * @returns {Object} Type-specific data structure
   */
  getUserTypeSpecificData(userType, userData = {}) {
    const baseData = {};

    switch (userType) {
      case 'customer':
        baseData.customer = {
          wallet: {
            balance: 0,
            currency: 'INR'
          },
          savedAddresses: [],
          preferences: {
            vehicleType: '2_wheeler',
            maxWeight: 10,
            paymentMethod: 'cash'
          },
          ...userData.customer
        };
        break;

      case 'driver':
        baseData.driver = {
          vehicleDetails: {
            type: 'motorcycle',
            model: '',
            number: '',
            color: ''
          },
          documents: {
            drivingLicense: null,
            profilePhoto: null,
            aadhaarCard: null,
            bikeInsurance: null,
            rcBook: null
          },
          verificationStatus: 'pending',
          isOnline: false,
          rating: 0,
          totalTrips: 0,
          earnings: {
            total: 0,
            thisMonth: 0,
            thisWeek: 0
          },
          availability: {
            workingHours: {
              start: '09:00',
              end: '18:00'
            },
            workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
            isAvailable: false
          },
          ...userData.driver
        };
        break;

      case 'admin':
        baseData.admin = {
          permissions: ['read', 'write', 'delete'],
          role: 'admin',
          accessLevel: 'full',
          ...userData.admin
        };
        break;

      case 'support':
        baseData.support = {
          permissions: ['read', 'write'],
          role: 'support',
          accessLevel: 'limited',
          ...userData.support
        };
        break;

      default:
        // For unknown user types, create a generic structure
        baseData[userType] = {
          ...userData[userType]
        };
        break;
    }

    return baseData;
  }

  /**
   * Get users by type
   * @param {string} userType - User type to filter by
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of users
   */
  async getUsersByType(userType, options = {}) {
    try {
      if (!this.isValidUserType(userType)) {
        throw new Error(`INVALID_USER_TYPE: ${userType}`);
      }

      let query = this.db.collection('users')
        .where('userType', '==', userType)
        .where('isActive', '==', true);

      // Apply additional filters
      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.orderBy) {
        query = query.orderBy(options.orderBy.field, options.orderBy.direction || 'desc');
      }

      const snapshot = await query.get();
      const users = [];

      snapshot.forEach(doc => {
        users.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return users;
    } catch (error) {
      console.error('Error getting users by type:', error);
      throw error;
    }
  }

  /**
   * Update user type specific data
   * @param {string} userId - User ID
   * @param {string} userType - User type
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated user data
   */
  async updateUserTypeData(userId, userType, updateData) {
    try {
      if (!this.isValidUserType(userType)) {
        throw new Error(`INVALID_USER_TYPE: ${userType}`);
      }

      const userRef = this.db.collection('users').doc(userId);
      
      const updatePayload = {
        [userType]: updateData,
        updatedAt: new Date()
      };

      await userRef.update(updatePayload);

      const updatedDoc = await userRef.get();
      return updatedDoc.data();
    } catch (error) {
      console.error('Error updating user type data:', error);
      throw error;
    }
  }

  /**
   * Validate user session
   * @param {string} uid - User ID
   * @returns {Promise<Object>} User data
   */
  async validateSession(uid) {
    try {
      const userDoc = await this.db.collection('users').doc(uid).get();

      if (!userDoc.exists) {
        throw new Error('USER_NOT_FOUND');
      }

      const userData = userDoc.data();

      if (!userData.isActive) {
        throw new Error('USER_INACTIVE');
      }

      return {
        id: userData.id,
        name: userData.name,
        phone: userData.phone,
        userType: userData.userType,
        isVerified: userData.isVerified,
        isActive: userData.isActive
      };

    } catch (error) {
      console.error('Error validating session:', error);
      throw error;
    }
  }

  /**
   * Update user profile
   * @param {string} uid - User ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated user data
   */
  async updateProfile(uid, updateData) {
    try {
      const userRef = this.db.collection('users').doc(uid);
      
      const updatePayload = {
        ...updateData,
        updatedAt: new Date()
      };

      await userRef.update(updatePayload);

      const updatedDoc = await userRef.get();
      return updatedDoc.data();

    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  }

  /**
   * Logout user
   * @param {string} uid - User ID
   * @returns {Promise<void>}
   */
  async logout(uid) {
    try {
      // Delete user session
      await this.db.collection('userSessions').doc(uid).delete();
      
      // In a more complex system, you might want to:
      // - Track logout events
      // - Invalidate refresh tokens
      // - Update user status
      
    } catch (error) {
      console.error('Error during logout:', error);
      throw error;
    }
  }

  /**
   * Generate random 6-digit OTP
   * @returns {string} 6-digit OTP
   */
  generateRandomOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Hash OTP for secure storage
   * @param {string} otp - OTP to hash
   * @returns {string} Hashed OTP
   */
  hashOTP(otp) {
    return crypto.createHash('sha256').update(otp).digest('hex');
  }

  /**
   * Verify hashed OTP
   * @param {string} otp - OTP to verify
   * @param {string} hashedOTP - Stored hashed OTP
   * @returns {boolean} Whether OTP is valid
   */
  verifyHashedOTP(otp, hashedOTP) {
    return this.hashOTP(otp) === hashedOTP;
  }

  /**
   * Generate JWT token for user session
   * @param {Object} payload - Token payload
   * @returns {string} JWT token
   */
  generateJWTToken(payload) {
    return this.jwtService.generateAccessToken(payload);
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token to verify
   * @returns {Object} Decoded token payload
   */
  verifyJWTToken(token) {
    return this.jwtService.verifyToken(token);
  }

  /**
   * Clean up expired OTP sessions
   * @returns {Promise<number>} Number of sessions cleaned up
   */
  async cleanupExpiredSessions() {
    try {
      const now = new Date();
      const expiredSessions = await this.db
        .collection('otpSessions')
        .where('expiresAt', '<', now)
        .get();

      const batch = this.db.batch();
      expiredSessions.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      return expiredSessions.size;

    } catch (error) {
      console.error('Error cleaning up expired sessions:', error);
      throw error;
    }
  }

  /**
   * Check if user exists by phone number
   * @param {string} phoneNumber - Phone number to check
   * @returns {Promise<boolean>} True if user exists
   */
  async userExists(phoneNumber) {
    try {
      const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
      const userQuery = await this.db.collection('users')
        .where('phone', '==', normalizedPhone)
        .limit(1)
        .get();
      
      return !userQuery.empty;
    } catch (error) {
      console.error('Error checking if user exists:', error);
      throw error;
    }
  }

  /**
   * Get user by phone number
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<Object|null>} User data or null
   */
  async getUserByPhone(phoneNumber) {
    try {
      const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
      const userQuery = await this.db.collection('users')
        .where('phone', '==', normalizedPhone)
        .limit(1)
        .get();
      
      if (userQuery.empty) {
        return null;
      }
      
      const userDoc = userQuery.docs[0];
      return {
        id: userDoc.id,
        ...userDoc.data()
      };
    } catch (error) {
      console.error('Error getting user by phone:', error);
      throw error;
    }
  }

  /**
   * Get user by ID
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} User data or null
   */
  async getUserById(userId) {
    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
      
      if (!userDoc.exists) {
        return null;
      }
      
      return {
        id: userDoc.id,
        ...userDoc.data()
      };
    } catch (error) {
      console.error('Error getting user by ID:', error);
      throw error;
    }
  }

  /**
   * Update user
   * @param {string} userId - User ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated user data
   */
  async updateUser(userId, updateData) {
    try {
      const userRef = this.db.collection('users').doc(userId);
      
      const updatePayload = {
        ...updateData,
        updatedAt: new Date()
      };

      await userRef.update(updatePayload);

      const updatedDoc = await userRef.get();
      return updatedDoc.data();
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  /**
   * Log authentication attempt
   * @param {Object} attemptData - Authentication attempt data
   * @returns {Promise<void>}
   */
  async logAuthAttempt(attemptData) {
    try {
      await this.db.collection('auth_attempts').add({
        ...attemptData,
        createdAt: new Date()
      });
    } catch (error) {
      console.error('Error logging auth attempt:', error);
      // Don't throw error for logging failures
    }
  }

  /**
   * Normalize phone number to standard format
   * @param {string} phoneNumber - Raw phone number
   * @returns {string} Normalized phone number
   */
  normalizePhoneNumber(phoneNumber) {
    // Remove all non-digit characters
    let normalized = phoneNumber.replace(/\D/g, '');
    
    // Ensure it starts with country code if not present
    if (normalized.length === 10) {
      normalized = '91' + normalized; // Add India country code
    }
    
    // Ensure it starts with +
    if (!normalized.startsWith('+')) {
      normalized = '+' + normalized;
    }
    
    return normalized;
  }
}

// Create singleton instance
const authService = new AuthService();

module.exports = authService;
