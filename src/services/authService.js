const { getFirestore } = require('./firebase');
const twilioService = require('./twilioService');
const crypto = require('crypto');

/**
 * Authentication Service
 * Handles OTP generation, verification, session management, and user authentication
 */
class AuthService {
  constructor() {
    this.db = getFirestore();
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
      // Check if user exists in Firestore
      const userQuery = await this.db.collection('users').where('phone', '==', phoneNumber).limit(1).get();
      const existingUser = userQuery.empty ? null : userQuery.docs[0].data();
      let user;
      let isNewUser = false;

      if (existingUser) {
        // User exists, return existing user data
        user = existingUser;
      } else {
        // Create new user
        if (!userData.name) {
          throw new Error('NAME_REQUIRED');
        }

        const userType = userData.userType || 'customer';

        // Create user ID (using phone number hash or timestamp)
        const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create user document in Firestore
        const newUserData = {
          id: userId,
          phone: phoneNumber,
          name: userData.name,
          userType: userType,
          isVerified: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Add user type specific data
        if (userType === 'customer') {
          newUserData.customer = {
            wallet: {
              balance: 0,
              currency: 'INR'
            },
            savedAddresses: [],
            preferences: {
              vehicleType: '2_wheeler',
              maxWeight: 10,
              paymentMethod: 'cash'
            }
          };
        } else if (userType === 'driver') {
          newUserData.driver = {
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
            }
          };
        }

        await this.db.collection('users').doc(userId).set(newUserData);
        user = newUserData;
        isNewUser = true;
      }

      return { user, isNewUser };

    } catch (error) {
      console.error('Error getting or creating user:', error);
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
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'your-secret-key';
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

    return jwt.sign(payload, secret, { expiresIn });
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token to verify
   * @returns {Object} Decoded token payload
   */
  verifyJWTToken(token) {
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'your-secret-key';

    try {
      return jwt.verify(token, secret);
    } catch (error) {
      throw new Error('INVALID_TOKEN');
    }
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
}

// Create singleton instance
const authService = new AuthService();

module.exports = authService;
