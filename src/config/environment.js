const path = require('path');
const fs = require('fs');

/**
 * Environment Configuration Manager
 * Centralized configuration for all environment variables with validation
 */
class EnvironmentConfig {
  constructor() {
    this.config = {};
    this.loadEnvironment();
    this.validateConfiguration();
  }

  /**
   * Load environment variables from .env file and process.env
   */
  loadEnvironment() {
    // Load .env file if it exists
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
    }

    // Server Configuration
    this.config.server = {
      port: parseInt(process.env.PORT) || 3000,
      nodeEnv: process.env.NODE_ENV || 'development',
      debug: process.env.DEBUG === 'true',
      mockServices: process.env.MOCK_SERVICES === 'true'
    };

    // Firebase Configuration
    this.config.firebase = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      clientId: process.env.FIREBASE_CLIENT_ID,
      authUri: process.env.FIREBASE_AUTH_URI,
      tokenUri: process.env.FIREBASE_TOKEN_URI,
      authProviderX509CertUrl: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
      clientX509CertUrl: process.env.FIREBASE_CLIENT_X509_CERT_URL,
      serviceAccountPath: process.env.FCM_SERVICE_ACCOUNT_PATH || './firebase-service-account.json',
      functionsRegion: process.env.FIREBASE_FUNCTIONS_REGION || 'us-central1',
      functionsTimeout: parseInt(process.env.FIREBASE_FUNCTIONS_TIMEOUT) || 540
    };

    // JWT Configuration
    this.config.jwt = {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    };

    // Payment Gateway Configuration
    this.config.payment = {
      phonepe: {
        merchantId: process.env.PHONEPE_MERCHANT_ID,
        saltKey: process.env.PHONEPE_SALT_KEY,
        saltIndex: process.env.PHONEPE_SALT_INDEX,
        baseUrl: process.env.PHONEPE_BASE_URL,
        redirectUrl: process.env.PHONEPE_REDIRECT_URL
      },
      razorpay: {
        keyId: process.env.RAZORPAY_KEY_ID,
        keySecret: process.env.RAZORPAY_KEY_SECRET
      }
    };

    // Google Maps Configuration
    this.config.googleMaps = {
      apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
      baseUrl: 'https://maps.googleapis.com/maps/api',
      defaultRadius: 50000, // 50km
      defaultLanguage: 'en',
      defaultRegion: 'in',
      // Backend specific restrictions
      restrictions: {
        allowedApis: ['places', 'geocoding', 'directions', 'distancematrix', 'maps-sdk-android', 'maps-sdk-ios'],
        rateLimits: {
          requestsPerMinute: 100,
          requestsPerDay: 10000,
        },
      },
    };

    // Twilio Configuration
    this.config.twilio = {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER,
      enabled: process.env.TWILIO_ENABLED === 'true',
      mockMode: process.env.TWILIO_MOCK_MODE === 'true'
    };

    // reCAPTCHA Configuration
    this.config.recaptcha = {
      siteKey: process.env.RECAPTCHA_SITE_KEY,
      secretKey: process.env.RECAPTCHA_SECRET_KEY,
      enterpriseSiteKey: process.env.RECAPTCHA_ENTERPRISE_SITE_KEY,
      enterpriseSecretKey: process.env.RECAPTCHA_ENTERPRISE_SECRET_KEY,
      enabled: process.env.RECAPTCHA_ENABLED === 'true'
    };

    // Notification Service Configuration
    this.config.notifications = {
      pushEnabled: process.env.PUSH_NOTIFICATION_ENABLED === 'true',
      fcmUseV1Api: process.env.FCM_USE_V1_API === 'true',
      fcmEnabled: process.env.FCM_ENABLED === 'true',
      fcmRetryAttempts: parseInt(process.env.FCM_RETRY_ATTEMPTS) || 3,
      fcmBatchSize: parseInt(process.env.FCM_BATCH_SIZE) || 500,
      fcmPriority: process.env.FCM_PRIORITY || 'high',
      fcmMaxTokenAge: parseInt(process.env.FCM_MAX_TOKEN_AGE) || 30,
      fcmTokenValidationInterval: parseInt(process.env.FCM_TOKEN_VALIDATION_INTERVAL) || 24,
      fcmEnableTokenRefresh: process.env.FCM_ENABLE_TOKEN_REFRESH === 'true',
      fcmEnableTopicOptimization: process.env.FCM_ENABLE_TOPIC_OPTIMIZATION === 'true',
      smsEnableOnlyCritical: process.env.SMS_ENABLE_ONLY_CRITICAL === 'true',
      enhancedNotificationsEnabled: process.env.ENHANCED_NOTIFICATIONS_ENABLED === 'true',
      quietHoursEnabled: process.env.QUIET_HOURS_ENABLED === 'true',
      frequencyLimitsEnabled: process.env.FREQUENCY_LIMITS_ENABLED === 'true',
      scheduledNotificationsEnabled: process.env.SCHEDULED_NOTIFICATIONS_ENABLED === 'true',
      maxNotificationsPerDay: parseInt(process.env.MAX_NOTIFICATIONS_PER_DAY) || 50,
      maxNotificationsPerHour: parseInt(process.env.MAX_NOTIFICATIONS_PER_HOUR) || 10,
      notificationCooldownMinutes: parseInt(process.env.NOTIFICATION_COOLDOWN_MINUTES) || 5
    };

    // Email Configuration
    this.config.email = {
      service: process.env.EMAIL_SERVICE || 'gmail',
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASSWORD,
      fromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@epickup.com',
      frontendUrl: process.env.FRONTEND_URL || 'https://epickup.com'
    };

    // File Storage Configuration
    this.config.storage = {
      bucket: process.env.STORAGE_BUCKET,
      region: process.env.STORAGE_REGION,
      maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880, // 5MB
      allowedTypes: process.env.ALLOWED_FILE_TYPES?.split(',') || ['image/jpeg', 'image/png', 'image/webp']
    };

    // Security Configuration
    this.config.security = {
      bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12,
      sessionSecret: process.env.SESSION_SECRET,
      passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH) || 8,
      maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
      lockoutDuration: parseInt(process.env.LOCKOUT_DURATION) || 15, // minutes
      sessionExpiryHours: parseInt(process.env.SESSION_EXPIRY_HOURS) || 168 // 7 days
    };

    // Redis Configuration
    this.config.redis = {
      url: process.env.REDIS_URL,
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      username: process.env.REDIS_USERNAME || 'default',
      db: parseInt(process.env.REDIS_DB) || 0,
      enabled: process.env.REDIS_ENABLED === 'true'
    };

    // Database Configuration
    this.config.database = {
      url: process.env.DATABASE_URL
    };

    // CORS Configuration
    this.config.cors = {
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://epickup-app.web.app',
        'https://epickup-app.firebaseapp.com'
      ]
    };

    // URL Configuration
    this.config.urls = {
      backend: process.env.BACKEND_URL || 'http://localhost:3000',
      frontend: process.env.FRONTEND_URL || 'https://epickup-app.web.app'
    };

    // File Upload Configuration
    this.config.fileUpload = {
      maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760,
      uploadPath: process.env.UPLOAD_PATH || './uploads',
      thumbnailSize: parseInt(process.env.THUMBNAIL_SIZE) || 300,
      imageQuality: parseInt(process.env.IMAGE_QUALITY) || 85
    };

    // Rate Limiting Configuration
    this.config.rateLimit = {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
    };

    // Logging Configuration
    this.config.logging = {
      level: process.env.LOG_LEVEL || 'info',
      filePath: process.env.LOG_FILE_PATH || './logs'
    };

    // Security Configuration
    this.config.security = {
      bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12,
      sessionSecret: process.env.SESSION_SECRET
    };

    // Monitoring Configuration
    this.config.monitoring = {
      sentryDsn: process.env.SENTRY_DSN,
      newRelicLicenseKey: process.env.NEW_RELIC_LICENSE_KEY
    };

    // Development Configuration
    this.config.development = {
      testPhoneNumbers: process.env.TEST_PHONE_NUMBERS?.split(',') || ['9999999999', '8888888888', '7777777777']
    };

    // Service Area Configuration
    this.config.serviceArea = {
      CENTER: {
        LATITUDE: 12.4950,
        LONGITUDE: 78.5678,
        NAME: 'Tirupattur Town'
      },
      RADIUS: {
        MIN_METERS: 23000, // 23 km
        MAX_METERS: 27000, // 27 km
        DEFAULT_METERS: 25000 // 25 km
      },
      VALIDATION: {
        ENABLED: true,
        STRICT_MODE: true, // Reject bookings outside range
        WARNING_THRESHOLD: 26000 // Warn when approaching boundary
      }
    };
  }

  /**
   * Validate critical configuration values
   */
  validateConfiguration() {
    const errors = [];

    // Firebase validation
    if (!this.config.firebase.projectId) {
      errors.push('FIREBASE_PROJECT_ID is required');
    }
    if (!this.config.firebase.privateKey) {
      errors.push('FIREBASE_PRIVATE_KEY is required');
    }
    if (!this.config.firebase.clientEmail) {
      errors.push('FIREBASE_CLIENT_EMAIL is required');
    }

    // JWT validation
    if (!this.config.jwt.secret) {
      errors.push('JWT_SECRET is required');
    }

    // Google Maps validation
    if (!this.config.googleMaps.apiKey) {
      errors.push('GOOGLE_MAPS_API_KEY is required');
    }

    // Redis validation (optional but recommended)
    if (this.config.redis.enabled && !this.config.redis.url) {
      errors.push('REDIS_URL is required when Redis is enabled');
    }

    if (errors.length > 0) {
      console.error('❌ Configuration validation failed:');
      errors.forEach(error => console.error(`   - ${error}`));
      throw new Error('Invalid configuration. Please check your environment variables.');
    }

    console.log('✅ Environment configuration validated successfully');
  }

  /**
   * Get configuration by category
   */
  get(category) {
    return this.config[category];
  }

  /**
   * Get all configuration
   */
  getAll() {
    return this.config;
  }

  /**
   * Check if running in development mode
   */
  isDevelopment() {
    return this.config.server.nodeEnv === 'development';
  }

  /**
   * Check if running in production mode
   */
  isProduction() {
    return this.config.server.nodeEnv === 'production';
  }

  /**
   * Check if debug mode is enabled
   */
  isDebugEnabled() {
    return this.config.server.debug;
  }

  /**
   * Check if Redis is enabled
   */
  isRedisEnabled() {
    return this.config.redis.enabled;
  }

  /**
   * Check if push notifications are enabled
   */
  arePushNotificationsEnabled() {
    return this.config.notifications.pushEnabled;
  }

  /**
   * Check if FCM v1 API is enabled
   */
  isFCMV1Enabled() {
    return this.config.notifications.fcmUseV1Api;
  }

  /**
   * Get Firebase service account path
   */
  getFirebaseServiceAccountPath() {
    return this.config.firebase.serviceAccountPath;
  }

  /**
   * Get Redis connection URL
   */
  getRedisUrl() {
    return this.config.redis.url;
  }

  /**
   * Get reCAPTCHA secret key
   */
  getRecaptchaSecret() {
    return this.config.recaptcha.secretKey;
  }

  /**
   * Check if reCAPTCHA is enabled
   */
  isRecaptchaEnabled() {
    return this.config.recaptcha.enabled;
  }

  /**
   * Get JWT secret
   */
  getJWTSecret() {
    return this.config.jwt.secret;
  }

  /**
   * Get server port
   */
  getServerPort() {
    return this.config.server.port;
  }

  /**
   * Get allowed origins for CORS
   */
  getAllowedOrigins() {
    return this.config.cors.allowedOrigins;
  }

  /**
   * Get file upload configuration
   */
  getFileUploadConfig() {
    return this.config.fileUpload;
  }

  /**
   * Get rate limiting configuration
   */
  getRateLimitConfig() {
    return this.config.rateLimit;
  }

  /**
   * Get notification configuration
   */
  getNotificationConfig() {
    return this.config.notifications;
  }

  /**
   * Get payment configuration
   */
  getPaymentConfig() {
    return this.config.payment;
  }

  /**
   * Get security configuration
   */
  getSecurityConfig() {
    return this.config.security;
  }

  /**
   * Get monitoring configuration
   */
  getMonitoringConfig() {
    return this.config.monitoring;
  }

  /**
   * Get development configuration
   */
  getDevelopmentConfig() {
    return this.config.development;
  }

  /**
   * Get service area configuration
   */
  getServiceAreaConfig() {
    return this.config.serviceArea;
  }

  /**
   * Get service area center
   */
  getServiceAreaCenter() {
    return this.config.serviceArea.CENTER;
  }

  /**
   * Get service area radius
   */
  getServiceAreaRadius() {
    return this.config.serviceArea.RADIUS;
  }

  /**
   * Get reCAPTCHA configuration
   */
  getRecaptchaConfig() {
    return this.config.recaptcha;
  }

  /**
   * Get reCAPTCHA site key
   */
  getRecaptchaSiteKey() {
    return this.config.recaptcha.siteKey;
  }

  /**
   * Get reCAPTCHA secret key
   */
  getRecaptchaSecretKey() {
    return this.config.recaptcha.secretKey;
  }

  /**
   * Get reCAPTCHA Enterprise site key
   */
  getRecaptchaEnterpriseSiteKey() {
    return this.config.recaptcha.enterpriseSiteKey;
  }

  /**
   * Get reCAPTCHA Enterprise secret key
   */
  getRecaptchaEnterpriseSecretKey() {
    return this.config.recaptcha.enterpriseSecretKey;
  }

  /**
   * Get Twilio configuration
   */
  getTwilioConfig() {
    return this.config.twilio;
  }

  /**
   * Check if Twilio is enabled
   */
  isTwilioEnabled() {
    // Force enable in production if credentials are available
    if (this.isProduction() && this.config.twilio.accountSid && this.config.twilio.authToken && this.config.twilio.verifyServiceSid) {
      console.log('🚀 Production environment detected - forcing Twilio enabled');
      return true;
    }
    return this.config.twilio.enabled && !this.config.twilio.mockMode;
  }

  /**
   * Get Firebase configuration
   */
  getFirebaseConfig() {
    return this.config.firebase;
  }

  /**
   * Get Google Maps configuration
   */
  getGoogleMapsConfig() {
    return this.config.googleMaps;
  }

  /**
   * Check if service area validation is enabled
   */
  isServiceAreaValidationEnabled() {
    return this.config.serviceArea.VALIDATION.ENABLED;
  }

  /**
   * Check if service area strict mode is enabled
   */
  isServiceAreaStrictMode() {
    return this.config.serviceArea.VALIDATION.STRICT_MODE;
  }

  /**
   * Reload configuration (useful for hot reloading in development)
   */
  reload() {
    this.config = {};
    this.loadEnvironment();
    this.validateConfiguration();
    console.log('🔄 Environment configuration reloaded');
  }

  /**
   * Export configuration for external use
   */
  export() {
    return JSON.stringify(this.config, null, 2);
  }
}

// Create singleton instance
const environmentConfig = new EnvironmentConfig();

module.exports = environmentConfig;
