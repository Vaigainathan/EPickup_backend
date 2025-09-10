const twilio = require('twilio');
const { env } = require('../config');

class TwilioService {
  constructor() {
    this.client = null;
    this.verifyServiceSid = null;
    this.isInitialized = false;
    this.lastError = null;
    this.errorCount = 0;
  }

  /**
   * Initialize Twilio service
   */
  async initialize() {
    try {
      // Get Twilio configuration from environment
      const twilioConfig = env.getTwilioConfig();
      
      // Also check direct environment variables as fallback
      const directAccountSid = process.env.TWILIO_ACCOUNT_SID;
      const directAuthToken = process.env.TWILIO_AUTH_TOKEN;
      const directVerifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
      const directEnabled = process.env.TWILIO_ENABLED === 'true';
      console.log('🔧 Twilio Config:', {
        enabled: env.isTwilioEnabled(),
        directEnabled: directEnabled,
        hasAccountSid: !!twilioConfig.accountSid,
        hasAuthToken: !!twilioConfig.authToken,
        hasVerifyServiceSid: !!twilioConfig.verifyServiceSid,
        nodeEnv: process.env.NODE_ENV
      });
      
      // Use direct environment variables if config is not working
      const finalAccountSid = twilioConfig.accountSid || directAccountSid;
      const finalAuthToken = twilioConfig.authToken || directAuthToken;
      const finalVerifyServiceSid = twilioConfig.verifyServiceSid || directVerifyServiceSid;
      const finalEnabled = env.isTwilioEnabled() || directEnabled;
      
      console.log('🔧 Final Twilio Config:', {
        enabled: finalEnabled,
        hasAccountSid: !!finalAccountSid,
        hasAuthToken: !!finalAuthToken,
        hasVerifyServiceSid: !!finalVerifyServiceSid,
        nodeEnv: process.env.NODE_ENV
      });
      
      // Check if Twilio is enabled and credentials are available
      if (!finalEnabled || !finalAccountSid || !finalAuthToken || !finalVerifyServiceSid) {
        throw new Error('Twilio credentials not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID environment variables.');
      }

      // Initialize Twilio client
      this.client = twilio(finalAccountSid, finalAuthToken);
      this.verifyServiceSid = finalVerifyServiceSid;

      // Test Twilio connection
      try {
        const account = await this.client.api.accounts(finalAccountSid).fetch();
        console.log('✅ Twilio account verified:', account.friendlyName);
        this.errorCount = 0; // Reset error count on successful connection
      } catch (testError) {
        console.error('❌ Twilio account verification failed:', testError.message);
        throw new Error(`Twilio account verification failed: ${testError.message}`);
      }

      this.isInitialized = true;
      this.lastError = null;
      console.log('✅ Twilio service initialized successfully with real SMS capability');
    } catch (error) {
      console.error('❌ Failed to initialize Twilio service:', error);
      // Fallback to mock service
      this.mockMode = true;
      this.isInitialized = true;
      this.lastError = `Twilio initialization failed: ${error.message}`;
      console.log('🔄 Falling back to mock Twilio service');
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

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      console.log(`📱 Attempting to send OTP to ${formattedPhone}`);

      if (this.mockMode || !this.client || !this.verifyServiceSid) {
        console.log('🔄 Using mock service - Twilio client not initialized or mock mode enabled');
        console.log(`🔧 Mock mode: ${this.mockMode}, Has client: ${!!this.client}, Has verify service: ${!!this.verifyServiceSid}`);
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

      console.log(`✅ Real SMS OTP sent to ${formattedPhone} via ${verification.channel}`);
      console.log(`📊 Verification SID: ${verification.sid}, Status: ${verification.status}`);
      
      this.errorCount = 0; // Reset error count on success

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
      this.errorCount++;
      this.lastError = `Send OTP failed: ${error.message}`;
      
      // If Twilio fails, fallback to mock service
      console.log('🔄 Twilio service error, falling back to mock service');
      console.log(`🔧 Error count: ${this.errorCount}, Last error: ${this.lastError}`);
      return await this.sendMockOTP(phoneNumber, options);
    }
  }

  /**
   * Verify OTP code
   */
  async verifyOTP(phoneNumber, code) {
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

      console.log(`🔐 Attempting to verify OTP for ${formattedPhone}: ${code}`);

      if (this.mockMode || !this.client || !this.verifyServiceSid) {
        console.log('🔄 Using mock service - Twilio client not initialized or mock mode enabled');
        console.log(`🔧 Mock mode: ${this.mockMode}, Has client: ${!!this.client}, Has verify service: ${!!this.verifyServiceSid}`);
        // Use mock service
        return await this.verifyMockOTP(phoneNumber, code);
      }

      // Verify OTP via Twilio
      const verificationCheck = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verificationChecks.create({
          to: formattedPhone,
          code: code
        });

      console.log(`✅ Real SMS OTP verification result for ${formattedPhone}: ${verificationCheck.status}`);
      console.log(`📊 Verification SID: ${verificationCheck.sid}, Valid: ${verificationCheck.valid}`);
      
      this.errorCount = 0; // Reset error count on success

      return {
        success: verificationCheck.status === 'approved',
        status: verificationCheck.status,
        sid: verificationCheck.sid,
        to: verificationCheck.to,
        valid: verificationCheck.valid
      };

    } catch (error) {
      console.error('❌ Failed to verify OTP:', error);
      this.errorCount++;
      this.lastError = `Verify OTP failed: ${error.message}`;
      
      // If Twilio fails, fallback to mock service
      console.log('🔄 Twilio service error, falling back to mock service');
      console.log(`🔧 Error count: ${this.errorCount}, Last error: ${this.lastError}`);
      return await this.verifyMockOTP(phoneNumber, code);
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

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      console.log(`📱 Attempting to resend OTP to ${formattedPhone}`);

      if (this.mockMode || !this.client || !this.verifyServiceSid) {
        console.log('🔄 Using mock service - Twilio client not initialized or mock mode enabled');
        // Use mock service
        return await this.sendMockOTP(phoneNumber, { ...options, isResend: true });
      }

      // Resend OTP via Twilio
      const verification = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verifications.create({
          to: formattedPhone,
          channel: options.channel || 'sms',
          ...options
        });

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
      
      // If Twilio fails, fallback to mock service
      console.log('🔄 Twilio service error, falling back to mock service');
      return await this.sendMockOTP(phoneNumber, { ...options, isResend: true });
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
   * Send OTP via Twilio Verify service
   */
  async sendOTP(phoneNumber, options = {}) {
    try {
      if (!this.client) {
        throw new Error('Twilio client not initialized');
      }

      const { channel = 'sms', locale = 'en' } = options;
      
      console.log(`🔐 Sending OTP to ${phoneNumber} via ${channel}`);
      
      const verification = await this.client.verify.v2
        .services(this.serviceSid)
        .verifications
        .create({
          to: phoneNumber,
          channel: channel,
          locale: locale
        });

      console.log(`✅ OTP sent successfully to ${phoneNumber}`);
      
      return {
        success: true,
        sid: verification.sid,
        to: phoneNumber,
        status: verification.status,
        channel: verification.channel,
        message: 'OTP sent successfully'
      };

    } catch (error) {
      console.error('❌ Error sending OTP:', error);
      throw new Error(`Failed to send OTP: ${error.message}`);
    }
  }

  /**
   * Verify OTP via Twilio Verify service
   */
  async verifyOTP(phoneNumber, code) {
    try {
      if (!this.client) {
        throw new Error('Twilio client not initialized');
      }

      console.log(`🔐 Verifying OTP for ${phoneNumber}`);
      
      const verificationCheck = await this.client.verify.v2
        .services(this.serviceSid)
        .verificationChecks
        .create({
          to: phoneNumber,
          code: code
        });

      const isValid = verificationCheck.status === 'approved';
      
      if (isValid) {
        console.log(`✅ OTP verification successful for ${phoneNumber}`);
      } else {
        console.log(`❌ OTP verification failed for ${phoneNumber}`);
      }

      return {
        success: isValid,
        status: verificationCheck.status,
        sid: verificationCheck.sid,
        to: phoneNumber,
        valid: isValid,
        message: isValid ? 'OTP verified successfully' : 'Invalid OTP code'
      };

    } catch (error) {
      console.error('❌ Error verifying OTP:', error);
      throw new Error(`Failed to verify OTP: ${error.message}`);
    }
  }

  /**
   * Get service health status
   */
  async getHealthStatus() {
    try {
      return {
        isInitialized: this.isInitialized,
        hasCredentials: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID),
        hasClient: !!this.client,
        hasVerifyService: !!this.verifyServiceSid,
        errorCount: this.errorCount,
        lastError: this.lastError,
        nodeEnv: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        isInitialized: false,
        hasCredentials: false,
        hasClient: false,
        hasVerifyService: false,
        errorCount: this.errorCount,
        lastError: this.lastError || error.message,
        nodeEnv: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Create singleton instance
const twilioService = new TwilioService();

module.exports = twilioService;
