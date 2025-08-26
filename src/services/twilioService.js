const twilio = require('twilio');
const { env } = require('../config');
const redis = require('./redis');

class TwilioService {
  constructor() {
    this.client = null;
    this.verifyServiceSid = null;
    this.isInitialized = false;
    this.redisClient = null;
  }

  /**
   * Initialize Twilio service
   */
  async initialize() {
    try {
      // Get Twilio configuration from environment
      const twilioConfig = env.getTwilioConfig();
      
      // Check if Twilio is enabled and credentials are available
      if (!env.isTwilioEnabled() || !twilioConfig.accountSid || !twilioConfig.authToken || !twilioConfig.verifyServiceSid) {
        console.warn('⚠️ Twilio not enabled or credentials not configured, using mock service');
        this.isInitialized = true;
        return;
      }

      // Initialize Twilio client
      this.client = twilio(twilioConfig.accountSid, twilioConfig.authToken);
      this.verifyServiceSid = twilioConfig.verifyServiceSid;

      // Initialize Redis for session storage
      await this.initializeRedis();

      this.isInitialized = true;
      console.log('✅ Twilio service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Twilio service:', error);
      // Fallback to mock service
      this.isInitialized = true;
      console.log('🔄 Falling back to mock Twilio service');
    }
  }

  /**
   * Initialize Redis connection
   */
  async initializeRedis() {
    try {
      if (env.isRedisEnabled()) {
        this.redisClient = redis;
        console.log('✅ Redis connected for Twilio session storage');
      } else {
        console.warn('⚠️ Redis not enabled, using in-memory storage');
      }
    } catch (error) {
      console.warn('⚠️ Redis connection failed, using in-memory storage:', error.message);
    }
  }

  /**
   * Send OTP to phone number
   */
  async sendOTP(phoneNumber, options = {}) {
    try {
      // Validate phone number
      if (!this.validatePhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      // Check rate limiting
      const rateLimitKey = `twilio_rate_limit:${phoneNumber}`;
      const isRateLimited = await this.checkRateLimit(rateLimitKey, 5, 300); // 5 attempts per 5 minutes
      if (isRateLimited) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      if (!this.client || !this.verifyServiceSid) {
        // Use mock service
        return await this.sendMockOTP(phoneNumber, options);
      }

      // Send OTP via Twilio
      const verification = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verifications.create({
          to: formattedPhone,
          channel: options.channel || 'sms',
          ...options
        });

      // Store verification session
      await this.storeVerificationSession(phoneNumber, verification.sid, options);

      console.log(`✅ OTP sent to ${formattedPhone} via ${verification.channel}`);

      return {
        success: true,
        sid: verification.sid,
        status: verification.status,
        channel: verification.channel,
        to: verification.to,
        expiresIn: '10 minutes'
      };

    } catch (error) {
      console.error('❌ Failed to send OTP:', error);
      throw error;
    }
  }

  /**
   * Verify OTP code
   */
  async verifyOTP(phoneNumber, code, verificationSid = null) {
    try {
      // Validate phone number
      if (!this.validatePhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      // Validate OTP code
      if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
        throw new Error('Invalid OTP code format');
      }

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      if (!this.client || !this.verifyServiceSid) {
        // Use mock service
        return await this.verifyMockOTP(phoneNumber, code);
      }

      // Get verification SID from session if not provided
      if (!verificationSid) {
        const session = await this.getVerificationSession(phoneNumber);
        if (!session) {
          throw new Error('No active verification session found');
        }
        verificationSid = session.verificationSid;
      }

      // Verify OTP via Twilio
      const verificationCheck = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verificationChecks.create({
          to: formattedPhone,
          code: code,
          verificationSid: verificationSid
        });

      console.log(`✅ OTP verification result for ${formattedPhone}: ${verificationCheck.status}`);

      // Clear verification session
      await this.clearVerificationSession(phoneNumber);

      return {
        success: verificationCheck.status === 'approved',
        status: verificationCheck.status,
        sid: verificationCheck.sid,
        to: verificationCheck.to,
        valid: verificationCheck.valid
      };

    } catch (error) {
      console.error('❌ Failed to verify OTP:', error);
      throw error;
    }
  }

  /**
   * Resend OTP
   */
  async resendOTP(phoneNumber, options = {}) {
    try {
      // Validate phone number
      if (!this.validatePhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      // Check rate limiting
      const rateLimitKey = `twilio_resend_rate_limit:${phoneNumber}`;
      const isRateLimited = await this.checkRateLimit(rateLimitKey, 3, 300); // 3 resends per 5 minutes
      if (isRateLimited) {
        throw new Error('Resend rate limit exceeded. Please try again later.');
      }

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      if (!this.client || !this.verifyServiceSid) {
        // Use mock service
        return await this.sendMockOTP(phoneNumber, { ...options, isResend: true });
      }

      // Get existing verification session
      const session = await this.getVerificationSession(phoneNumber);
      if (!session) {
        throw new Error('No active verification session found');
      }

      // Resend OTP via Twilio
      const verification = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verifications.create({
          to: formattedPhone,
          channel: options.channel || 'sms',
          ...options
        });

      // Update verification session
      await this.storeVerificationSession(phoneNumber, verification.sid, options);

      console.log(`✅ OTP resent to ${formattedPhone} via ${verification.channel}`);

      return {
        success: true,
        sid: verification.sid,
        status: verification.status,
        channel: verification.channel,
        to: verification.to,
        expiresIn: '10 minutes'
      };

    } catch (error) {
      console.error('❌ Failed to resend OTP:', error);
      throw error;
    }
  }

  /**
   * Validate phone number format
   */
  validatePhoneNumber(phoneNumber) {
    if (!phoneNumber) return false;

    // Remove any existing +91 prefix to avoid duplication
    let cleanPhone = phoneNumber.replace(/^\+91/, '');
    
    // Remove spaces and special characters
    cleanPhone = cleanPhone.replace(/\s+/g, '').replace(/[^\d]/g, '');
    
    // Check if it's a valid Indian mobile number (10 digits starting with 6-9)
    const phoneRegex = /^[6-9]\d{9}$/;
    return phoneRegex.test(cleanPhone);
  }

  /**
   * Format phone number for Twilio
   */
  formatPhoneNumber(phoneNumber) {
    // Remove any existing +91 prefix
    let cleanPhone = phoneNumber.replace(/^\+91/, '');
    
    // Remove spaces and special characters
    cleanPhone = cleanPhone.replace(/\s+/g, '').replace(/[^\d]/g, '');
    
    // Add +91 prefix
    return `+91${cleanPhone}`;
  }

  /**
   * Check rate limiting
   */
  async checkRateLimit(key, maxAttempts, windowSeconds) {
    try {
      if (!this.redisClient) {
        // In-memory rate limiting (not recommended for production)
        return false;
      }

      const current = await this.redisClient.get(key);
      const attempts = current ? parseInt(current) : 0;

      if (attempts >= maxAttempts) {
        return true; // Rate limited
      }

      // Increment attempts
      await this.redisClient.set(key, attempts + 1, windowSeconds);
      return false; // Not rate limited

    } catch (error) {
      console.warn('Rate limiting check failed:', error.message);
      return false; // Allow request if rate limiting fails
    }
  }

  /**
   * Store verification session
   */
  async storeVerificationSession(phoneNumber, verificationSid, options = {}) {
    try {
      const sessionData = {
        verificationSid,
        phoneNumber,
        options,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
      };

      const key = `twilio_session:${phoneNumber}`;
      
      if (this.redisClient) {
        await this.redisClient.set(key, JSON.stringify(sessionData), 600); // 10 minutes
      } else {
        // In-memory storage (not recommended for production)
        this.sessions = this.sessions || {};
        this.sessions[key] = sessionData;
      }

    } catch (error) {
      console.warn('Failed to store verification session:', error.message);
    }
  }

  /**
   * Get verification session
   */
  async getVerificationSession(phoneNumber) {
    try {
      const key = `twilio_session:${phoneNumber}`;
      
      if (this.redisClient) {
        const sessionData = await this.redisClient.get(key);
        return sessionData ? JSON.parse(sessionData) : null;
      } else {
        // In-memory storage
        this.sessions = this.sessions || {};
        const sessionData = this.sessions[key];
        
        if (sessionData && new Date(sessionData.expiresAt) > new Date()) {
          return sessionData;
        } else {
          delete this.sessions[key];
          return null;
        }
      }

    } catch (error) {
      console.warn('Failed to get verification session:', error.message);
      return null;
    }
  }

  /**
   * Clear verification session
   */
  async clearVerificationSession(phoneNumber) {
    try {
      const key = `twilio_session:${phoneNumber}`;
      
      if (this.redisClient) {
        await this.redisClient.del(key);
      } else {
        // In-memory storage
        this.sessions = this.sessions || {};
        delete this.sessions[key];
      }

    } catch (error) {
      console.warn('Failed to clear verification session:', error.message);
    }
  }

  /**
   * Mock OTP sending for development
   */
  async sendMockOTP(phoneNumber, options = {}) {
    console.log(`🔐 Mock OTP sent to ${phoneNumber} (Mock Mode)`);
    
    // Store mock session
    const mockSid = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await this.storeVerificationSession(phoneNumber, mockSid, options);

    return {
      success: true,
      sid: mockSid,
      status: 'pending',
      channel: options.channel || 'sms',
      to: phoneNumber,
      expiresIn: '10 minutes'
    };
  }

  /**
   * Mock OTP verification for development
   */
  async verifyMockOTP(phoneNumber, code) {
    console.log(`🔐 Mock OTP verification for ${phoneNumber}: ${code} (Mock Mode)`);
    
    // Mock verification logic - accept common test codes
    const isValidCode = code === '123456' || code === '000000' || code === '111111' || code === '222222';
    
    // Clear session
    await this.clearVerificationSession(phoneNumber);

    return {
      success: isValidCode,
      status: isValidCode ? 'approved' : 'denied',
      sid: `mock_${Date.now()}`,
      to: phoneNumber,
      valid: isValidCode
    };
  }

  /**
   * Get service health status
   */
  async getHealthStatus() {
    try {
      return {
        isInitialized: this.isInitialized,
        hasCredentials: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID),
        hasRedis: !!this.redisClient,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        isInitialized: false,
        hasCredentials: false,
        hasRedis: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Create singleton instance
const twilioService = new TwilioService();

module.exports = twilioService;
