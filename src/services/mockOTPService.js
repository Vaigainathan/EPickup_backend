const crypto = require('crypto');

/**
 * Mock OTP Service for Testing
 * 
 * This service provides a complete mock OTP system that:
 * - Generates OTPs and logs them to console
 * - Stores OTPs in memory for verification
 * - Works exactly like MSG91 but without sending real SMS
 * - Supports unlimited test users and phone numbers
 * - Maintains full JWT token issuance and Firestore integration
 */

class MockOTPService {
  constructor() {
    this.otpStore = new Map(); // Store OTPs temporarily
    this.sessionStore = new Map(); // Store OTP sessions
    this.isEnabled = process.env.MSG91_MOCK_MODE === 'true' || process.env.NODE_ENV === 'development';
    
    console.log(`🧪 Mock OTP Service initialized - Enabled: ${this.isEnabled}`);
  }

  /**
   * Check if mock mode is enabled
   */
  isMockModeEnabled() {
    return this.isEnabled;
  }

  /**
   * Generate a 6-digit OTP
   */
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Generate a unique session ID
   */
  generateSessionId() {
    return `mock_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
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
   * Format phone number for consistency
   */
  formatPhoneNumber(phoneNumber) {
    // Remove any existing +91 prefix
    let cleanPhone = phoneNumber.replace(/^\+91/, '');
    
    // Remove spaces and special characters
    cleanPhone = cleanPhone.replace(/\s+/g, '').replace(/[^\d]/g, '');
    
    // Add +91 prefix for consistency
    return `+91${cleanPhone}`;
  }

  /**
   * Send mock OTP
   */
  async sendOTP(phoneNumber, options = {}) {
    try {
      console.log(`\n🧪 ===== MOCK OTP SERVICE =====`);
      console.log(`📱 Sending Mock OTP to: ${phoneNumber}`);
      
      // Validate phone number
      if (!this.validatePhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      // Generate OTP and session
      const otpCode = this.generateOTP();
      const sessionId = this.generateSessionId();
      const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes
      
      // Store OTP for verification
      this.otpStore.set(formattedPhone, {
        otp: otpCode,
        sessionId,
        expiresAt,
        attempts: 0,
        maxAttempts: 3,
        createdAt: Date.now()
      });

      // Store session info
      this.sessionStore.set(sessionId, {
        phoneNumber: formattedPhone,
        otp: otpCode,
        expiresAt,
        createdAt: Date.now(),
        metadata: options.metadata || {}
      });

      // Log OTP to console for testing
      console.log(`🔑 MOCK OTP: ${otpCode}`);
      console.log(`📱 Phone: ${formattedPhone}`);
      console.log(`🆔 Session ID: ${sessionId}`);
      console.log(`⏰ Expires: ${new Date(expiresAt).toLocaleString()}`);
      console.log(`🧪 ==============================\n`);

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      return {
        success: true,
        sid: sessionId,
        to: formattedPhone,
        status: 'sent',
        channel: 'sms',
        message: 'OTP sent successfully (MOCK MODE)',
        expiresIn: '5 minutes',
        mockOTP: otpCode,
        mockMode: true
      };

    } catch (error) {
      console.error('❌ Mock OTP send error:', error);
      throw error;
    }
  }

  /**
   * Verify mock OTP
   */
  async verifyOTP(phoneNumber, otp, sessionId = null) {
    try {
      console.log(`\n🧪 ===== MOCK OTP VERIFICATION =====`);
      console.log(`📱 Verifying OTP for: ${phoneNumber}`);
      console.log(`🔑 OTP provided: ${otp}`);
      
      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      // Get stored OTP data
      const otpData = this.otpStore.get(formattedPhone);
      
      if (!otpData) {
        console.log(`❌ No OTP found for ${formattedPhone}`);
        return {
          success: false,
          status: 'denied',
          sid: sessionId || 'unknown',
          to: formattedPhone,
          valid: false,
          message: 'OTP not found or expired',
          mockMode: true
        };
      }

      // Check if OTP has expired
      if (Date.now() > otpData.expiresAt) {
        console.log(`❌ OTP expired for ${formattedPhone}`);
        this.otpStore.delete(formattedPhone);
        return {
          success: false,
          status: 'denied',
          sid: sessionId || 'unknown',
          to: formattedPhone,
          valid: false,
          message: 'OTP has expired',
          mockMode: true
        };
      }

      // Check attempt limit
      if (otpData.attempts >= otpData.maxAttempts) {
        console.log(`❌ Max attempts exceeded for ${formattedPhone}`);
        this.otpStore.delete(formattedPhone);
        return {
          success: false,
          status: 'denied',
          sid: sessionId || 'unknown',
          to: formattedPhone,
          valid: false,
          message: 'Maximum verification attempts exceeded',
          mockMode: true
        };
      }

      // Increment attempt count
      otpData.attempts++;

      // Verify OTP
      const isValid = otpData.otp === otp.toString();
      
      if (isValid) {
        console.log(`✅ OTP verified successfully for ${formattedPhone}`);
        // Clean up stored OTP
        this.otpStore.delete(formattedPhone);
        
        return {
          success: true,
          status: 'approved',
          sid: otpData.sessionId,
          to: formattedPhone,
          valid: true,
          message: 'OTP verified successfully (MOCK MODE)',
          mockMode: true
        };
      } else {
        console.log(`❌ Invalid OTP for ${formattedPhone} (attempt ${otpData.attempts}/${otpData.maxAttempts})`);
        
        // Update stored data
        this.otpStore.set(formattedPhone, otpData);
        
        return {
          success: false,
          status: 'denied',
          sid: otpData.sessionId,
          to: formattedPhone,
          valid: false,
          message: `Invalid OTP code (attempt ${otpData.attempts}/${otpData.maxAttempts})`,
          mockMode: true
        };
      }

    } catch (error) {
      console.error('❌ Mock OTP verification error:', error);
      return {
        success: false,
        status: 'denied',
        sid: sessionId || 'unknown',
        to: phoneNumber,
        valid: false,
        message: 'OTP verification failed',
        mockMode: true
      };
    }
  }

  /**
   * Resend mock OTP
   */
  async resendOTP(phoneNumber, options = {}) {
    try {
      console.log(`\n🧪 ===== MOCK OTP RESEND =====`);
      console.log(`📱 Resending Mock OTP to: ${phoneNumber}`);
      
      // Clean up any existing OTP for this number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      this.otpStore.delete(formattedPhone);
      
      // Send new OTP
      return await this.sendOTP(phoneNumber, options);
      
    } catch (error) {
      console.error('❌ Mock OTP resend error:', error);
      throw error;
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      mockMode: true,
      activeOTPs: this.otpStore.size,
      activeSessions: this.sessionStore.size,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Clean up expired OTPs
   */
  cleanupExpiredOTPs() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [phone, data] of this.otpStore.entries()) {
      if (now > data.expiresAt) {
        this.otpStore.delete(phone);
        cleaned++;
      }
    }
    
    for (const [sessionId, data] of this.sessionStore.entries()) {
      if (now > data.expiresAt) {
        this.sessionStore.delete(sessionId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} expired OTPs/sessions`);
    }
    
    return cleaned;
  }

  /**
   * Get all active OTPs (for debugging)
   */
  getActiveOTPs() {
    const activeOTPs = [];
    for (const [phone, data] of this.otpStore.entries()) {
      activeOTPs.push({
        phone,
        otp: data.otp,
        expiresAt: new Date(data.expiresAt).toLocaleString(),
        attempts: data.attempts,
        maxAttempts: data.maxAttempts
      });
    }
    return activeOTPs;
  }
}

// Create singleton instance
const mockOTPService = new MockOTPService();

// Clean up expired OTPs every 5 minutes
setInterval(() => {
  mockOTPService.cleanupExpiredOTPs();
}, 5 * 60 * 1000);

module.exports = mockOTPService;
