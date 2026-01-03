const environmentConfig = require('../config/environment');

/**
 * Centralized PhonePe Configuration Service
 * Provides consistent PhonePe configuration across all services
 */
class PhonePeConfigService {
  constructor() {
    this.config = environmentConfig.config.payment.phonepe;
    this.urls = environmentConfig.config.urls;
  }

  /**
   * Get PhonePe configuration
   * @returns {Object} PhonePe configuration
   */
  getConfig() {
    return {
      merchantId: this.config.merchantId,
      saltKey: this.config.saltKey,
      saltIndex: this.config.saltIndex,
      baseUrl: this.config.baseUrl,
      redirectUrl: this.config.redirectUrl,
      callbackUrl: this.config.callbackUrl,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      clientVersion: this.config.clientVersion,
      testMode: this.config.testMode
    };
  }

  /**
   * Check if PhonePe is in test mode
   * @returns {boolean} True if test mode
   */
  isTestMode() {
    return this.config.testMode === true;
  }

  /**
   * Get client credentials
   * @returns {Object} Client credentials
   */
  getClientCredentials() {
    return {
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      clientVersion: this.config.clientVersion
    };
  }

  /**
   * Get callback URL for PhonePe
   * @returns {string} Callback URL
   */
  getCallbackUrl() {
    return `${this.urls.backend}/api/payments/phonepe/callback`;
  }

  /**
   * Get redirect URL for PhonePe
   * @returns {string} Redirect URL
   */
  getRedirectUrl() {
    return this.config.redirectUrl;
  }

  /**
   * Get base URL for PhonePe API
   * @returns {string} Base URL
   */
  getBaseUrl() {
    return this.config.baseUrl;
  }

  /**
   * Get merchant ID
   * @returns {string} Merchant ID
   */
  getMerchantId() {
    return this.config.merchantId;
  }

  /**
   * Get salt key
   * @returns {string} Salt key
   */
  getSaltKey() {
    return this.config.saltKey;
  }

  /**
   * Get salt index
   * @returns {string} Salt index
   */
  getSaltIndex() {
    return this.config.saltIndex;
  }

  /**
   * Log configuration (for debugging)
   */
  logConfig() {
    const mode = this.isTestMode() ? 'TEST MODE' : 'PRODUCTION MODE';
    console.log(`🔧 PhonePe Configuration (${mode}):`, {
      merchantId: this.config.merchantId,
      baseUrl: this.config.baseUrl,
      saltIndex: this.config.saltIndex,
      redirectUrl: this.config.redirectUrl,
      callbackUrl: this.getCallbackUrl(),
      clientId: this.config.clientId ? `${this.config.clientId.substring(0, 10)}...` : 'Not set',
      testMode: this.isTestMode()
    });
  }
}

module.exports = new PhonePeConfigService();
