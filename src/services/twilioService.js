const twilio = require('twilio');
const { getFirestore } = require('./firebase');
const { getRedisClient } = require('./redis');

/**
 * Twilio Verify Service for EPickup
 * Handles SMS OTP verification with fallback channels
 */
class TwilioService {
  constructor() {
    this.client = null;
    this.verifyServiceSid = null;
    this.db = null;
    this.redis = null;
    this.initialize();
  }

  /**
   * Initialize Redis client
   */
  async initializeRedis() {
    try {
      this.redis = getRedisClient();
      return true;
    } catch (error) {
      console.warn('⚠️  Redis not available for Twilio service:', error.message);
      this.redis = null;
      return false;
    }
  }

  /**
   * Initialize Twilio client
   */
  initialize() {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      this.verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

      // Try to initialize Firestore (optional)
      try {
        this.db = getFirestore();
        console.log('✅ Firestore initialized for Twilio service');
      } catch (firestoreError) {
        console.warn('⚠️  Firestore not available for Twilio service:', firestoreError.message);
        this.db = null;
      }

      if (!accountSid || !authToken || !this.verifyServiceSid) {
        console.warn('Twilio credentials not configured. Using mock service.');
        this.client = null;
        return;
      }

      this.client = twilio(accountSid, authToken);
      console.log('✅ Twilio service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Twilio service:', error);
      this.client = null;
    }
  }

  /**
   * Send OTP to phone number
   * @param {string} phoneNumber - Phone number with country code
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Send result
   */
  async sendOTP(phoneNumber, options = {}) {
    try {
      // Validate phone number
      const validatedPhone = this.validatePhoneNumber(phoneNumber);
      if (!validatedPhone) {
        throw new Error('INVALID_PHONE_NUMBER');
      }

      // Check rate limiting
      const rateLimitKey = `otp_rate_limit:${validatedPhone}`;
      const rateLimitResult = await this.checkRateLimit(rateLimitKey);
      if (!rateLimitResult.allowed) {
        throw new Error('RATE_LIMIT_EXCEEDED');
      }

      // Check if using mock service
      if (!this.client || process.env.NODE_ENV === 'development') {
        return this.sendMockOTP(validatedPhone, options);
      }

      // Send OTP via Twilio
      const verification = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verifications.create({
          to: validatedPhone,
          channel: options.channel || 'sms',
          locale: options.locale || 'en',
          codeLength: options.codeLength || 6,
          ...options
        });

      // Store verification session
      await this.storeVerificationSession(validatedPhone, verification.sid, options);

      console.log(`✅ OTP sent successfully to ${validatedPhone}`);
      
      return {
        success: true,
        verificationSid: verification.sid,
        status: verification.status,
        to: validatedPhone,
        channel: verification.channel,
        sentAt: new Date()
      };

    } catch (error) {
      console.error('❌ Failed to send OTP:', error);
      
      // Handle specific Twilio errors
      if (error.code) {
        switch (error.code) {
          case 60200:
            throw new Error('INVALID_PHONE_NUMBER');
          case 60202:
            throw new Error('RATE_LIMIT_EXCEEDED');
          case 60203:
            throw new Error('SERVICE_UNAVAILABLE');
          case 60204:
            throw new Error('INVALID_VERIFICATION_CODE');
          case 60205:
            throw new Error('VERIFICATION_EXPIRED');
          default:
            throw new Error('SMS_SEND_FAILED');
        }
      }

      throw error;
    }
  }

  /**
   * Verify OTP code
   * @param {string} phoneNumber - Phone number with country code
   * @param {string} code - OTP code to verify
   * @param {string} verificationSid - Verification session ID
   * @returns {Promise<Object>} Verification result
   */
  async verifyOTP(phoneNumber, code, verificationSid = null) {
    try {
      // Validate phone number
      const validatedPhone = this.validatePhoneNumber(phoneNumber);
      if (!validatedPhone) {
        throw new Error('INVALID_PHONE_NUMBER');
      }

      // Validate OTP code format
      if (!code || !/^\d{6}$/.test(code)) {
        throw new Error('INVALID_OTP_FORMAT');
      }

      // Check if using mock service
      if (!this.client || process.env.NODE_ENV === 'development') {
        return this.verifyMockOTP(validatedPhone, code);
      }

      // Get verification session if not provided
      if (!verificationSid) {
        const session = await this.getVerificationSession(validatedPhone);
        if (!session) {
          throw new Error('NO_ACTIVE_SESSION');
        }
        verificationSid = session.verificationSid;
      }

      // Verify OTP via Twilio
      const verificationCheck = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verificationChecks.create({
          to: validatedPhone,
          code: code,
          verificationSid: verificationSid
        });

      // Check verification result
      if (verificationCheck.status === 'approved') {
        // Clear verification session
        await this.clearVerificationSession(validatedPhone);
        
        console.log(`✅ OTP verified successfully for ${validatedPhone}`);
        
        return {
          success: true,
          status: verificationCheck.status,
          to: validatedPhone,
          verifiedAt: new Date()
        };
      } else {
        throw new Error('INVALID_OTP');
      }

    } catch (error) {
      console.error('❌ Failed to verify OTP:', error);
      
      // Handle specific Twilio errors
      if (error.code) {
        switch (error.code) {
          case 60200:
            throw new Error('INVALID_PHONE_NUMBER');
          case 60202:
            throw new Error('RATE_LIMIT_EXCEEDED');
          case 60203:
            throw new Error('SERVICE_UNAVAILABLE');
          case 60204:
            throw new Error('INVALID_VERIFICATION_CODE');
          case 60205:
            throw new Error('VERIFICATION_EXPIRED');
          default:
            throw new Error('VERIFICATION_FAILED');
        }
      }

      throw error;
    }
  }

  /**
   * Resend OTP to phone number
   * @param {string} phoneNumber - Phone number with country code
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Resend result
   */
  async resendOTP(phoneNumber, options = {}) {
    try {
      // Check if there's an active session
      const session = await this.getVerificationSession(phoneNumber);
      if (!session) {
        throw new Error('NO_ACTIVE_SESSION');
      }

      // Check resend rate limiting
      const resendKey = `otp_resend:${phoneNumber}`;
      const resendResult = await this.checkRateLimit(resendKey, 3, 300); // 3 resends per 5 minutes
      if (!resendResult.allowed) {
        throw new Error('RESEND_RATE_LIMIT_EXCEEDED');
      }

      // Send new OTP
      return await this.sendOTP(phoneNumber, {
        ...options,
        channel: session.channel || 'sms'
      });

    } catch (error) {
      console.error('❌ Failed to resend OTP:', error);
      throw error;
    }
  }

  /**
   * Validate phone number format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {string|null} Validated phone number or null
   */
  validatePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;

    // Remove all non-digit characters except +
    let cleaned = phoneNumber.replace(/[^\d+]/g, '');

    // Ensure it starts with +
    if (!cleaned.startsWith('+')) {
      // Add +91 for Indian numbers if no country code
      if (cleaned.length === 10 && /^[6-9]\d{9}$/.test(cleaned)) {
        cleaned = `+91${cleaned}`;
      } else {
        return null;
      }
    }

    // Validate format
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(cleaned) ? cleaned : null;
  }

  /**
   * Check rate limiting for OTP requests
   * @param {string} key - Redis key for rate limiting
   * @param {number} maxAttempts - Maximum attempts allowed
   * @param {number} windowSeconds - Time window in seconds
   * @returns {Promise<Object>} Rate limit result
   */
  async checkRateLimit(key, maxAttempts = 5, windowSeconds = 300) {
    try {
      if (!this.redis) {
        return { allowed: true, remaining: maxAttempts };
      }

      const current = await this.redis.get(key);
      const attempts = current ? parseInt(current) : 0;

      if (attempts >= maxAttempts) {
        return { allowed: false, remaining: 0 };
      }

      // Increment counter
      await this.redis.incr(key);
      
      // Set expiration if this is the first attempt
      if (attempts === 0) {
        await this.redis.expire(key, windowSeconds);
      }

      return { allowed: true, remaining: maxAttempts - attempts - 1 };
    } catch (error) {
      console.error('Rate limit check failed:', error);
      return { allowed: true, remaining: maxAttempts };
    }
  }

  /**
   * Store verification session in database
   * @param {string} phoneNumber - Phone number
   * @param {string} verificationSid - Verification session ID
   * @param {Object} options - Session options
   */
  async storeVerificationSession(phoneNumber, verificationSid, options = {}) {
    try {
      if (!this.db) {
        console.warn('⚠️  Firestore not available, skipping session storage');
        return;
      }

      const sessionData = {
        phoneNumber,
        verificationSid,
        channel: options.channel || 'sms',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        attempts: 0,
        maxAttempts: 3,
        ...options
      };

      await this.db.collection('otpSessions').doc(phoneNumber).set(sessionData);
    } catch (error) {
      console.error('Failed to store verification session:', error);
    }
  }

  /**
   * Get verification session from database
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<Object|null>} Session data
   */
  async getVerificationSession(phoneNumber) {
    try {
      if (!this.db) {
        console.warn('⚠️  Firestore not available, returning null for session');
        return null;
      }

      const sessionDoc = await this.db.collection('otpSessions').doc(phoneNumber).get();
      
      if (!sessionDoc.exists) {
        return null;
      }

      const sessionData = sessionDoc.data();

      // Check if session has expired
      if (new Date() > sessionData.expiresAt.toDate()) {
        await this.clearVerificationSession(phoneNumber);
        return null;
      }

      return sessionData;
    } catch (error) {
      console.error('Failed to get verification session:', error);
      return null;
    }
  }

  /**
   * Clear verification session
   * @param {string} phoneNumber - Phone number
   */
  async clearVerificationSession(phoneNumber) {
    try {
      if (!this.db) {
        console.warn('⚠️  Firestore not available, skipping session cleanup');
        return;
      }

      await this.db.collection('otpSessions').doc(phoneNumber).delete();
    } catch (error) {
      console.error('Failed to clear verification session:', error);
    }
  }

  /**
   * Send mock OTP for development/testing
   * @param {string} phoneNumber - Phone number
   * @param {Object} options - Options
   * @returns {Promise<Object>} Mock result
   */
  async sendMockOTP(phoneNumber, options = {}) {
    console.log(`🔧 Mock Service: Sending OTP to ${phoneNumber}`);
    
    // Store mock session
    await this.storeVerificationSession(phoneNumber, 'mock_verification_sid', options);
    
    return {
      success: true,
      verificationSid: 'mock_verification_sid',
      status: 'pending',
      to: phoneNumber,
      channel: 'sms',
      sentAt: new Date(),
      mock: true
    };
  }

  /**
   * Verify mock OTP for development/testing
   * @param {string} phoneNumber - Phone number
   * @param {string} code - OTP code
   * @returns {Promise<Object>} Mock verification result
   */
  async verifyMockOTP(phoneNumber, code) {
    console.log(`🔧 Mock Service: Verifying OTP ${code} for ${phoneNumber}`);
    
    // Mock verification - accept '123456' or any 6-digit code in development
    if (code === '123456' || process.env.NODE_ENV === 'development') {
      await this.clearVerificationSession(phoneNumber);
      
      return {
        success: true,
        status: 'approved',
        to: phoneNumber,
        verifiedAt: new Date(),
        mock: true
      };
    } else {
      throw new Error('INVALID_OTP');
    }
  }

  /**
   * Get service health status
   * @returns {Promise<Object>} Health status
   */
  async getHealthStatus() {
    try {
      const isConfigured = !!(this.client && this.verifyServiceSid);
      const redisAvailable = !!(this.redis);
      
      return {
        service: 'twilio',
        status: isConfigured ? 'healthy' : 'unconfigured',
        configured: isConfigured,
        redisAvailable,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        service: 'twilio',
        status: 'error',
        error: error.message,
        timestamp: new Date()
      };
    }
  }
}

// Export singleton instance
module.exports = new TwilioService();
