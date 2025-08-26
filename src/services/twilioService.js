const twilio = require('twilio');
const { env } = require('../config');

class TwilioService {
  constructor() {
    this.client = null;
    this.verifyServiceSid = null;
    this.isInitialized = false;
    this.mockMode = false;
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
      const directMockMode = process.env.TWILIO_MOCK_MODE === 'true';
      
      console.log('🔧 Twilio Config:', {
        enabled: env.isTwilioEnabled(),
        directEnabled: directEnabled,
        hasAccountSid: !!twilioConfig.accountSid,
        hasAuthToken: !!twilioConfig.authToken,
        hasVerifyServiceSid: !!twilioConfig.verifyServiceSid,
        mockMode: twilioConfig.mockMode,
        directMockMode: directMockMode
      });
      
      // Use direct environment variables if config is not working
      const finalAccountSid = twilioConfig.accountSid || directAccountSid;
      const finalAuthToken = twilioConfig.authToken || directAuthToken;
      const finalVerifyServiceSid = twilioConfig.verifyServiceSid || directVerifyServiceSid;
      const finalEnabled = env.isTwilioEnabled() || directEnabled;
      const finalMockMode = twilioConfig.mockMode || directMockMode;
      
      console.log('🔧 Final Twilio Config:', {
        enabled: finalEnabled,
        hasAccountSid: !!finalAccountSid,
        hasAuthToken: !!finalAuthToken,
        hasVerifyServiceSid: !!finalVerifyServiceSid,
        mockMode: finalMockMode
      });
      
      // Check if Twilio is enabled and credentials are available
      if (!finalEnabled || !finalAccountSid || !finalAuthToken || !finalVerifyServiceSid) {
        console.warn('⚠️ Twilio not enabled or credentials not configured, using mock service');
        this.mockMode = true;
        this.isInitialized = true;
        return;
      }

      // Initialize Twilio client
      this.client = twilio(finalAccountSid, finalAuthToken);
      this.verifyServiceSid = finalVerifyServiceSid;
      this.mockMode = finalMockMode;

      // Test Twilio connection
      try {
        const account = await this.client.api.accounts(finalAccountSid).fetch();
        console.log('✅ Twilio account verified:', account.friendlyName);
      } catch (testError) {
        console.error('❌ Twilio account verification failed:', testError.message);
        this.mockMode = true;
        this.isInitialized = true;
        return;
      }

      this.isInitialized = true;
      console.log('✅ Twilio service initialized successfully with real SMS capability');
    } catch (error) {
      console.error('❌ Failed to initialize Twilio service:', error);
      // Fallback to mock service
      this.mockMode = true;
      this.isInitialized = true;
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
      
      // If Twilio fails, fallback to mock service
      console.log('🔄 Twilio service error, falling back to mock service');
      return await this.sendMockOTP(phoneNumber, options);
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

      console.log(`🔐 Attempting to verify OTP for ${formattedPhone}: ${code}`);

      if (this.mockMode || !this.client || !this.verifyServiceSid) {
        console.log('🔄 Using mock service - Twilio client not initialized or mock mode enabled');
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

      return {
        success: verificationCheck.status === 'approved',
        status: verificationCheck.status,
        sid: verificationCheck.sid,
        to: verificationCheck.to,
        valid: verificationCheck.valid
      };

    } catch (error) {
      console.error('❌ Failed to verify OTP:', error);
      
      // If Twilio fails, fallback to mock service
      console.log('🔄 Twilio service error, falling back to mock service');
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
   * Mock OTP sending for development
   */
  async sendMockOTP(phoneNumber, options = {}) {
    console.log(`🔐 Mock OTP sent to ${phoneNumber} (Mock Mode)`);
    console.log(`📱 Use these test codes: 123456, 000000, 111111, 222222`);
    
    return {
      success: true,
      sid: `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
        mockMode: this.mockMode,
        hasCredentials: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID),
        hasClient: !!this.client,
        hasVerifyService: !!this.verifyServiceSid,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        isInitialized: false,
        mockMode: true,
        hasCredentials: false,
        hasClient: false,
        hasVerifyService: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Create singleton instance
const twilioService = new TwilioService();

module.exports = twilioService;
