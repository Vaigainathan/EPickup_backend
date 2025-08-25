const { RecaptchaEnterpriseServiceClient } = require('@google-cloud/recaptcha-enterprise');
const environmentConfig = require('../config/environment');

/**
 * reCAPTCHA Enterprise Service for EPickup Backend
 * Handles server-side validation of reCAPTCHA tokens
 */
class RecaptchaEnterpriseService {
  constructor() {
    this.projectID = environmentConfig.getFirebaseConfig().projectId || 'epickup-app';
    this.client = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the reCAPTCHA Enterprise client
   */
  async initialize() {
    try {
      if (this.isInitialized) {
        return this.client;
      }

      console.log('🔒 Initializing reCAPTCHA Enterprise client...');
      this.client = new RecaptchaEnterpriseServiceClient();
      this.isInitialized = true;
      console.log('✅ reCAPTCHA Enterprise client initialized successfully');
      return this.client;
    } catch (error) {
      console.error('❌ Failed to initialize reCAPTCHA Enterprise client:', error);
      throw error;
    }
  }

  /**
   * Create an assessment to analyze the risk of a UI action
   * @param {Object} params - Assessment parameters
   * @param {string} params.token - The generated token from client
   * @param {string} params.recaptchaAction - Action name corresponding to the token
   * @param {string} params.recaptchaKey - The reCAPTCHA site key
   * @returns {Promise<number|null>} - Risk score (0.0 to 1.0) or null if validation failed
   */
  async createAssessment({
    token,
    recaptchaAction = 'submit',
    recaptchaKey = environmentConfig.getRecaptchaSiteKey()
  }) {
    try {
      if (!token) {
        console.warn('⚠️ No reCAPTCHA token provided for assessment');
        return null;
      }

      if (!recaptchaKey) {
        console.warn('⚠️ No reCAPTCHA site key configured');
        return null;
      }

      // Initialize client if not already done
      await this.initialize();

      const projectPath = this.client.projectPath(this.projectID);

      // Build the assessment request
      const request = {
        assessment: {
          event: {
            token: token,
            siteKey: recaptchaKey,
          },
        },
        parent: projectPath,
      };

      console.log(`🔍 Creating reCAPTCHA assessment for action: ${recaptchaAction}`);

      const [response] = await this.client.createAssessment(request);

      // Check if the token is valid
      if (!response.tokenProperties.valid) {
        console.log(`❌ reCAPTCHA token validation failed: ${response.tokenProperties.invalidReason}`);
        return null;
      }

      // Check if the expected action was executed
      if (response.tokenProperties.action === recaptchaAction) {
        const score = response.riskAnalysis.score;
        console.log(`✅ reCAPTCHA assessment successful - Score: ${score}`);
        
        // Log risk analysis reasons if any
        if (response.riskAnalysis.reasons && response.riskAnalysis.reasons.length > 0) {
          console.log('📊 Risk analysis reasons:');
          response.riskAnalysis.reasons.forEach((reason) => {
            console.log(`  - ${reason}`);
          });
        }

        return score;
      } else {
        console.log(`❌ Action mismatch - Expected: ${recaptchaAction}, Got: ${response.tokenProperties.action}`);
        return null;
      }
    } catch (error) {
      console.error('❌ reCAPTCHA assessment error:', error);
      return null;
    }
  }

  /**
   * Validate reCAPTCHA token with a minimum score threshold
   * @param {string} token - reCAPTCHA token
   * @param {string} action - Expected action
   * @param {number} minScore - Minimum acceptable score (default: 0.5)
   * @returns {Promise<boolean>} - Whether validation passed
   */
  async validateToken(token, action = 'submit', minScore = 0.5) {
    try {
      const score = await this.createAssessment({
        token,
        recaptchaAction: action
      });

      if (score === null) {
        console.log('❌ reCAPTCHA validation failed - no score returned');
        return false;
      }

      const isValid = score >= minScore;
      console.log(`🔍 reCAPTCHA validation - Score: ${score}, Threshold: ${minScore}, Valid: ${isValid}`);
      
      return isValid;
    } catch (error) {
      console.error('❌ reCAPTCHA validation error:', error);
      return false;
    }
  }

  /**
   * Validate token for specific actions with appropriate thresholds
   */
  async validateForLogin(token) {
    return this.validateToken(token, 'login', 0.5);
  }

  async validateForSignup(token) {
    return this.validateToken(token, 'signup', 0.6);
  }

  async validateForSearch(token) {
    return this.validateToken(token, 'search', 0.3);
  }

  async validateForBooking(token) {
    return this.validateToken(token, 'booking', 0.5);
  }

  async validateForPayment(token) {
    return this.validateToken(token, 'payment', 0.7);
  }

  /**
   * Get service configuration
   */
  getConfig() {
    return {
      projectID: this.projectID,
      isInitialized: this.isInitialized,
      recaptchaKey: environmentConfig.getRecaptchaSiteKey()
    };
  }

  /**
   * Close the client connection
   */
  async close() {
    if (this.client) {
      await this.client.close();
      this.isInitialized = false;
      console.log('🔒 reCAPTCHA Enterprise client closed');
    }
  }
}

// Export singleton instance
const recaptchaEnterpriseService = new RecaptchaEnterpriseService();
module.exports = recaptchaEnterpriseService;
