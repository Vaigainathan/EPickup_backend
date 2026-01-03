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
   * Get merchant ID (for Pay Page flow - legacy)
   * @returns {string} Merchant ID
   */
  getMerchantId() {
    return this.config.merchantId;
  }

  /**
   * Get salt key (for Pay Page flow - legacy)
   * @returns {string} Salt key
   */
  getSaltKey() {
    return this.config.saltKey;
  }

  /**
   * Get salt index (for Pay Page flow - legacy)
   * @returns {string} Salt index
   */
  getSaltIndex() {
    return this.config.saltIndex;
  }

  /**
   * Get OAuth base URL for SDK flow
   * @returns {string} OAuth base URL
   */
  getOAuthBaseUrl() {
    const baseUrl = this.config.baseUrl || 'https://api-preprod.phonepe.com/apis/pg-sandbox';
    return baseUrl
      .replace('/pg-sandbox', '/identity-manager')
      .replace('/pg', '/identity-manager')
      .replace('/apis/pg-sandbox', '/identity-manager')
      .replace('/apis/pg', '/identity-manager');
  }

  /**
   * Check if SDK flow is available (has Client ID/Secret)
   * @returns {boolean} True if SDK credentials are available
   */
  isSDKFlowAvailable() {
    return !!(this.config.clientId && this.config.clientSecret);
  }

  /**
   * Check if Pay Page flow is available (has Merchant ID/Salt Key)
   * @returns {boolean} True if Pay Page credentials are available
   */
  isPayPageFlowAvailable() {
    return !!(this.config.merchantId && this.config.saltKey && this.config.saltKey.length > 20);
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
