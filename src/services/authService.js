const { getFirestore, getAuth, createUser, getUserByPhone, createCustomToken, verifyIdToken } = require('./firebase');
const crypto = require('crypto');

/**
 * Authentication Service
 * Handles OTP generation, verification, session management, and user authentication
 */
class AuthService {
  constructor() {
    this.db = getFirestore();
    this.auth = getAuth();
  }

  /**
   * Generate OTP for phone number
   * @param {string} phoneNumber - Phone number to send OTP to
   * @param {boolean} isSignup - Whether this is for signup or login
   * @param {string} recaptchaToken - reCAPTCHA token for verification
   * @returns {Promise<Object>} OTP session data
   */
  async generateOTP(phoneNumber, isSignup = false, recaptchaToken = null) {
    try {
      // Check if user already exists
      const existingUser = await getUserByPhone(phoneNumber);
      
      if (isSignup && existingUser) {
        throw new Error('USER_EXISTS');
      }

      if (!isSignup && !existingUser) {
        throw new Error('USER_NOT_FOUND');
      }

      // Generate OTP (in production, this would be sent via SMS)
      const otp = this.generateRandomOTP();
      
      // Store OTP session
      const sessionData = {
        phoneNumber,
        otp: this.hashOTP(otp), // Store hashed OTP
        isSignup,
        recaptchaToken,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        status: 'pending',
        resendCount: 0,
        attempts: 0,
        maxAttempts: 3
      };

      await this.db.collection('otpSessions').doc(phoneNumber).set(sessionData);

      // In production, send OTP via SMS here
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔐 Development OTP for ${phoneNumber}: ${otp}`);
      }

      return {
        success: true,
        sessionId: phoneNumber,
        expiresIn: '10 minutes',
        resendCount: 0,
        maxResends: 3,
        debugOTP: process.env.NODE_ENV === 'development' ? otp : undefined
      };

    } catch (error) {
      console.error('Error generating OTP:', error);
      throw error;
    }
  }

  /**
   * Verify OTP and authenticate user
   * @param {string} phoneNumber - Phone number
   * @param {string} otp - OTP to verify
   * @param {string} firebaseIdToken - Firebase ID token (optional)
   * @param {Object} userData - User data for new signups
   * @returns {Promise<Object>} Authentication result
   */
  async verifyOTP(phoneNumber, otp, firebaseIdToken = null, userData = {}) {
    try {
      // Get OTP session
      const sessionRef = this.db.collection('otpSessions').doc(phoneNumber);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        throw new Error('NO_ACTIVE_SESSION');
      }

      const sessionData = sessionDoc.data();

      // Check if session has expired
      if (new Date() > sessionData.expiresAt.toDate()) {
        await sessionRef.delete();
        throw new Error('SESSION_EXPIRED');
      }

      // Check attempt limit
      if (sessionData.attempts >= sessionData.maxAttempts) {
        await sessionRef.delete();
        throw new Error('MAX_ATTEMPTS_EXCEEDED');
      }

      // Update attempt count
      await sessionRef.update({
        attempts: sessionData.attempts + 1
      });

      // Verify OTP
      let isValidOTP = false;
      
      if (process.env.NODE_ENV === 'development' && otp === '123456') {
        isValidOTP = true;
      } else if (firebaseIdToken) {
        try {
          const decodedToken = await verifyIdToken(firebaseIdToken);
          if (decodedToken.phone_number === phoneNumber) {
            isValidOTP = true;
          }
        } catch (error) {
          console.error('Firebase token verification failed:', error);
        }
      } else {
        // Verify against stored hashed OTP
        isValidOTP = this.verifyHashedOTP(otp, sessionData.otp);
      }

      if (!isValidOTP) {
        throw new Error('INVALID_OTP');
      }

      // Get or create user
      const { user, isNewUser } = await this.getOrCreateUser(phoneNumber, userData);

      // Create custom token
      const customToken = await createCustomToken(user.id, {
        userType: user.userType,
        phone: user.phone
      });

      // Clean up OTP session
      await sessionRef.delete();

      return {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          userType: user.userType,
          isVerified: user.isVerified
        },
        token: customToken,
        isNewUser
      };

    } catch (error) {
      console.error('Error verifying OTP:', error);
      throw error;
    }
  }

  /**
   * Resend OTP to phone number
   * @param {string} phoneNumber - Phone number
   * @param {string} recaptchaToken - reCAPTCHA token
   * @returns {Promise<Object>} Resend result
   */
  async resendOTP(phoneNumber, recaptchaToken = null) {
    try {
      // Get existing session
      const sessionRef = this.db.collection('otpSessions').doc(phoneNumber);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        throw new Error('NO_ACTIVE_SESSION');
      }

      const sessionData = sessionDoc.data();

      // Check if session has expired
      if (new Date() > sessionData.expiresAt.toDate()) {
        await sessionRef.delete();
        throw new Error('SESSION_EXPIRED');
      }

      // Check resend limit
      if (sessionData.resendCount >= 3) {
        throw new Error('RESEND_LIMIT_EXCEEDED');
      }

      // Generate new OTP
      const newOTP = this.generateRandomOTP();

      // Update session
      await sessionRef.update({
        otp: this.hashOTP(newOTP),
        recaptchaToken,
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        resendCount: sessionData.resendCount + 1
      });

      // In production, send new OTP via SMS here
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔐 Development OTP (resend) for ${phoneNumber}: ${newOTP}`);
      }

      return {
        success: true,
        sessionId: phoneNumber,
        expiresIn: '10 minutes',
        resendCount: sessionData.resendCount + 1,
        maxResends: 3,
        debugOTP: process.env.NODE_ENV === 'development' ? newOTP : undefined
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
      const existingUser = await getUserByPhone(phoneNumber);
      let user;
      let isNewUser = false;

      if (existingUser) {
        // User exists, get from Firestore
        const userDoc = await this.db.collection('users').doc(existingUser.uid).get();
        
        if (userDoc.exists) {
          user = userDoc.data();
          user.id = existingUser.uid;
        } else {
          // User exists in Auth but not in Firestore, create Firestore document
          user = {
            id: existingUser.uid,
            phone: phoneNumber,
            name: existingUser.displayName || 'User',
            userType: 'customer',
            isVerified: true,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          
          await this.db.collection('users').doc(existingUser.uid).set(user);
        }
      } else {
        // Create new user
        if (!userData.name) {
          throw new Error('NAME_REQUIRED');
        }

        const userType = userData.userType || 'customer';

        // Create user in Firebase Auth
        let userRecord;
        try {
          userRecord = await createUser(phoneNumber, {
            displayName: userData.name,
            phoneNumber: phoneNumber
          });
        } catch (error) {
          if (error.code === 'auth/phone-number-already-exists') {
            userRecord = await getUserByPhone(phoneNumber);
          } else {
            throw error;
          }
        }

        // Create user document in Firestore
        const newUserData = {
          id: userRecord.uid,
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

        await this.db.collection('users').doc(userRecord.uid).set(newUserData);
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
