const axios = require('axios');
const mockOTPService = require('./mockOTPService');
const { env } = require('../config');

class Msg91Service {
  constructor() {
    this.authKey = null;
    this.senderId = null;
    this.apiUrl = null;
    this.isInitialized = false;
    this.lastError = null;
    this.errorCount = 0;
    this.mockMode = false;
  }

  /**
   * Initialize MSG91 service
   */
  async initialize() {
    try {
      // Get MSG91 configuration from environment
      const msg91Config = env.getMsg91Config();
      
      // Also check direct environment variables as fallback
      const directAuthKey = process.env.MSG91_AUTH_KEY;
      const directSenderId = process.env.MSG91_SENDER_ID;
      const directApiUrl = process.env.MSG91_API_URL;
      const directEnabled = process.env.MSG91_ENABLED === 'true';
      const directMockMode = process.env.MSG91_MOCK_MODE === 'true';
      
      console.log('🔧 MSG91 Config:', {
        enabled: env.isMsg91Enabled(),
        directEnabled: directEnabled,
        hasAuthKey: !!msg91Config.authKey,
        hasSenderId: !!msg91Config.senderId,
        hasApiUrl: !!msg91Config.apiUrl,
        mockMode: msg91Config.mockMode || directMockMode,
        nodeEnv: process.env.NODE_ENV
      });
      
      // Use direct environment variables if config is not working
      const finalAuthKey = msg91Config.authKey || directAuthKey;
      const finalSenderId = msg91Config.senderId || directSenderId;
      const finalApiUrl = msg91Config.apiUrl || directApiUrl;
      const finalEnabled = env.isMsg91Enabled() || directEnabled;
      const finalMockMode = msg91Config.mockMode || directMockMode;
      
      console.log('🔧 Final MSG91 Config:', {
        enabled: finalEnabled,
        hasAuthKey: !!finalAuthKey,
        hasSenderId: !!finalSenderId,
        hasApiUrl: !!finalApiUrl,
        mockMode: finalMockMode,
        nodeEnv: process.env.NODE_ENV
      });
      
      // Check if MSG91 is enabled and credentials are available
      if (!finalEnabled || !finalAuthKey || !finalSenderId || !finalApiUrl) {
        throw new Error('MSG91 credentials not configured. Please set MSG91_AUTH_KEY, MSG91_SENDER_ID, and MSG91_API_URL environment variables.');
      }

      // Set configuration
      this.authKey = finalAuthKey;
      this.senderId = finalSenderId;
      this.apiUrl = finalApiUrl;
      this.mockMode = finalMockMode;

      // Test MSG91 connection (optional - MSG91 doesn't have a specific test endpoint)
      if (!this.mockMode) {
        try {
          // We'll test the connection when we send the first OTP
          console.log('✅ MSG91 service configured successfully');
          this.errorCount = 0; // Reset error count on successful connection
        } catch (testError) {
          console.error('❌ MSG91 configuration test failed:', testError.message);
          throw new Error(`MSG91 configuration test failed: ${testError.message}`);
        }
      } else {
        console.log('✅ MSG91 service configured in mock mode');
      }

      this.isInitialized = true;
      this.lastError = null;
      console.log('✅ MSG91 service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize MSG91 service:', error);
      this.isInitialized = false;
      this.lastError = `MSG91 initialization failed: ${error.message}`;
      throw new Error(`MSG91 initialization failed: ${error.message}`);
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
   * Format phone number for MSG91
   */
  formatPhoneNumber(phoneNumber) {
    // Remove any existing +91 prefix
    let cleanPhone = phoneNumber.replace(/^\+91/, '');
    
    // Remove spaces and special characters
    cleanPhone = cleanPhone.replace(/\s+/g, '').replace(/[^\d]/g, '');
    
    // Add 91 prefix (MSG91 format)
    return `91${cleanPhone}`;
  }

  /**
   * Generate OTP code
   */
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Send mock OTP for testing
   */
  async sendMockOTP(phoneNumber, formattedPhone) {
    console.log('🧪 MOCK MODE: Simulating OTP send');
    
    // Generate OTP
    const otpCode = this.generateOTP();
    
    // Log OTP to console for testing
    console.log(`🔑 MOCK OTP for ${phoneNumber}: ${otpCode}`);
    console.log(`📱 Use this OTP to login: ${otpCode}`);
    console.log(`📱 Phone: ${phoneNumber} (formatted: ${formattedPhone})`);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      success: true,
      sid: `mock_${Date.now()}`,
      to: phoneNumber,
      status: 'sent',
      channel: 'sms',
      message: 'OTP sent successfully (MOCK MODE)',
      expiresIn: '5 minutes',
      mockOTP: otpCode
    };
  }

  /**
   * Send OTP via MSG91
   */
  async sendOTP(phoneNumber, options = {}) {
    try {
      // Check if mock service is enabled
      if (mockOTPService.isMockModeEnabled()) {
        console.log('🧪 Using Mock OTP Service for testing');
        return await mockOTPService.sendOTP(phoneNumber, options);
      }

      if (!this.isInitialized) {
        throw new Error('MSG91 service not initialized');
      }

      // Validate phone number
      if (!this.validatePhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      // Check if mock mode is enabled
      if (this.mockMode) {
        return this.sendMockOTP(phoneNumber, formattedPhone);
      }
      
      console.log(`🔐 Sending OTP to ${formattedPhone} via MSG91`);
      
      // Generate OTP
      const otpCode = this.generateOTP();

      // Get template ID from config
      const templateId = process.env.MSG91_TEMPLATE_ID;
      
      if (!templateId) {
        throw new Error('MSG91_TEMPLATE_ID environment variable is required');
      }
      
      // Prepare MSG91 API request
      const requestData = {
        template_id: templateId,
        mobile: formattedPhone,
        otp: otpCode
      };

      console.log('📤 MSG91 API Request:', {
        mobile: formattedPhone,
        sender: this.senderId,
        otp_length: 6,
        otp_expiry: 5
      });

      // Send OTP via MSG91 API
      const response = await axios.post(this.apiUrl, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'authkey': this.authKey
        },
        timeout: 10000 // 10 second timeout
      });

      console.log('📥 MSG91 API Response:', response.data);

      // Check response status
      if (response.data && response.data.type === 'success') {
        console.log(`✅ OTP sent successfully to ${formattedPhone}`);
        
        return {
          success: true,
          sid: response.data.request_id || `msg91_${Date.now()}`,
          to: phoneNumber,
          status: 'sent',
          channel: 'sms',
          message: 'OTP sent successfully',
          expiresIn: '5 minutes'
        };
      } else {
        throw new Error(response.data.message || 'Failed to send OTP');
      }

    } catch (error) {
      console.error('❌ Error sending OTP:', error);
      this.errorCount++;
      this.lastError = error.message;
      throw new Error(`Failed to send OTP: ${error.message}`);
    }
  }

  /**
   * Verify MSG91 Widget Token
   */
  async verifyWidgetToken(widgetToken) {
    try {
      if (!this.isInitialized) {
        throw new Error('MSG91 service not initialized');
      }

      console.log('🔐 Verifying MSG91 widget token...');
      
      // Call MSG91 widget token verification endpoint
      const verifyUrl = 'https://control.msg91.com/api/v5/widget/verifyAccessToken';
      const requestData = {
        authkey: this.authKey,
        'access-token': widgetToken
      };

      console.log('📤 MSG91 Widget Token Verify Request:', {
        authkey: this.authKey.substring(0, 10) + '...',
        'access-token': widgetToken.substring(0, 20) + '...'
      });

      const response = await axios.post(verifyUrl, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      console.log('📥 MSG91 Widget Token Verify Response:', response.data);

      // Check response status
      const isValid = response.data && response.data.type === 'success';
      
      if (isValid) {
        console.log('✅ MSG91 widget token verification successful');
        return {
          success: true,
          status: 'approved',
          sid: `widget_verify_${Date.now()}`,
          valid: true,
          message: 'Widget token verified successfully',
          data: response.data
        };
      } else {
        console.log('❌ MSG91 widget token verification failed');
        return {
          success: false,
          status: 'denied',
          sid: `widget_verify_${Date.now()}`,
          valid: false,
          message: response.data?.message || 'Invalid widget token'
        };
      }

    } catch (error) {
      console.error('❌ MSG91 widget token verification error:', error);
      
      // Handle different types of errors
      if (error.response) {
        // Server responded with error status
        const errorMessage = error.response.data?.message || 'Widget token verification failed';
        return {
          success: false,
          status: 'denied',
          sid: `widget_verify_${Date.now()}`,
          valid: false,
          message: errorMessage
        };
      } else if (error.request) {
        // Network error
        return {
          success: false,
          status: 'denied',
          sid: `widget_verify_${Date.now()}`,
          valid: false,
          message: 'Network error during widget token verification'
        };
      } else {
        // Other error
        return {
          success: false,
          status: 'denied',
          sid: `widget_verify_${Date.now()}`,
          valid: false,
          message: error.message || 'Widget token verification failed'
        };
      }
    }
  }

  /**
   * Verify OTP via MSG91
   */
  async verifyOTP(phoneNumber, code, sessionId = null) {
    try {
      // Check if mock service is enabled
      if (mockOTPService.isMockModeEnabled()) {
        console.log('🧪 Using Mock OTP Service for verification');
        return await mockOTPService.verifyOTP(phoneNumber, code, sessionId);
      }

      if (!this.isInitialized) {
        throw new Error('MSG91 service not initialized');
      }

      // Validate phone number
      if (!this.validatePhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      console.log(`🔐 Verifying OTP for ${formattedPhone}`);
      
      // If in mock mode, accept any 6-digit code for testing
      if (this.mockMode) {
        const isValid = /^\d{6}$/.test(code);
        console.log(`📱 Mock OTP verification for ${formattedPhone}: ${isValid ? 'valid' : 'invalid'}`);
        console.log(`📱 Code provided: ${code}`);
        
        return {
          success: isValid,
          status: isValid ? 'approved' : 'denied',
          sid: `mock_verify_${Date.now()}`,
          to: phoneNumber,
          valid: isValid,
          message: isValid ? 'OTP verified successfully (MOCK MODE)' : 'Invalid OTP code',
          mockMode: true
        };
      }

      // Prepare MSG91 verification request
      const verifyUrl = this.apiUrl.replace('/otp', '/otp/verify');
      const requestData = {
        authkey: this.authKey,
        mobile: formattedPhone,
        otp: code
      };

      console.log('📤 MSG91 Verify Request:', {
        mobile: formattedPhone,
        otp: code
      });

      // Verify OTP via MSG91 API
      const response = await axios.post(verifyUrl, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      console.log('📥 MSG91 Verify Response:', response.data);

      // Check response status
      const isValid = response.data && response.data.type === 'success';
      
      if (isValid) {
        console.log(`✅ OTP verification successful for ${formattedPhone}`);
      } else {
        console.log(`❌ OTP verification failed for ${formattedPhone}`);
      }

      return {
        success: isValid,
        status: isValid ? 'approved' : 'denied',
        sid: response.data.request_id || `msg91_verify_${Date.now()}`,
        to: phoneNumber,
        valid: isValid,
        message: isValid ? 'OTP verified successfully' : 'Invalid OTP code'
      };

    } catch (error) {
      console.error('❌ Error verifying OTP:', error);
      this.errorCount++;
      this.lastError = error.message;
      throw new Error(`Failed to verify OTP: ${error.message}`);
    }
  }

  /**
   * Resend OTP
   */
  async resendOTP(phoneNumber, options = {}) {
    try {
      // Check if mock service is enabled
      if (mockOTPService.isMockModeEnabled()) {
        console.log('🧪 Using Mock OTP Service for resend');
        return await mockOTPService.resendOTP(phoneNumber, options);
      }

      // Validate phone number
      if (!this.validatePhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      console.log(`📱 Attempting to resend OTP to ${formattedPhone}`);

      if (!this.isInitialized) {
        throw new Error('MSG91 service not initialized');
      }

      // For MSG91, resending is the same as sending a new OTP
      const result = await this.sendOTP(phoneNumber, options);

      console.log(`✅ OTP resent to ${formattedPhone}`);

      return {
        success: true,
        sid: result.sid,
        status: result.status,
        channel: result.channel,
        to: result.to,
        expiresIn: result.expiresIn || '5 minutes'
      };

    } catch (error) {
      console.error('❌ Failed to resend OTP:', error);
      this.errorCount++;
      this.lastError = error.message;
      throw new Error(`Failed to resend OTP: ${error.message}`);
    }
  }

  /**
   * Get service health status
   */
  async getHealthStatus() {
    try {
      return {
        isInitialized: this.isInitialized,
        hasCredentials: !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER_ID && process.env.MSG91_API_URL),
        hasAuthKey: !!this.authKey,
        hasSenderId: !!this.senderId,
        hasApiUrl: !!this.apiUrl,
        mockMode: this.mockMode,
        errorCount: this.errorCount,
        lastError: this.lastError,
        nodeEnv: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        isInitialized: false,
        hasCredentials: false,
        hasAuthKey: false,
        hasSenderId: false,
        hasApiUrl: false,
        mockMode: this.mockMode,
        errorCount: this.errorCount,
        lastError: this.lastError || error.message,
        nodeEnv: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Create singleton instance
const msg91Service = new Msg91Service();

module.exports = msg91Service;
