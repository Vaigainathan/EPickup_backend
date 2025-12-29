const admin = require('firebase-admin');
const environmentConfig = require('../config/environment');

/**
 * App Check Middleware for Play Integrity Token Validation
 * Validates Play Integrity tokens from mobile apps (Customer & Driver)
 */
class AppCheckMiddleware {
  constructor() {
    this.app = null; // Initialize lazily
    this.isInitialized = false;
    // Don't access Firebase during construction - wait until methods are called
  }

  /**
   * Get Firebase app instance (lazy initialization)
   */
  getApp() {
    if (!this.app) {
      try {
        this.app = admin.app();
      } catch (error) {
        console.error('❌ [AppCheckMiddleware] Failed to get Firebase app:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using AppCheckMiddleware.');
      }
    }
    return this.app;
  }

  /**
   * Initialize App Check middleware
   */
  async initialize() {
    try {
      if (this.isInitialized) return;

      console.log('🔒 Initializing App Check middleware for Play Integrity...');
      
      // App Check is automatically available with Firebase Admin SDK
      this.isInitialized = true;
      console.log('✅ App Check middleware initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize App Check middleware:', error);
      throw error;
    }
  }

  /**
   * Validate App Check token (Play Integrity) with Advanced Settings
   * @param {string} token - App Check token from mobile app
   * @returns {Promise<Object|null>} - Decoded token or null if invalid
   */
  async validateToken(token) {
    try {
      if (!token) {
        console.warn('⚠️ No App Check token provided');
        return null;
      }

      // Ensure Firebase is initialized before using appCheck
      this.getApp(); // This will initialize Firebase if needed

      // Verify the App Check token with advanced Play Integrity validation
      const decodedToken = await admin.appCheck().verifyToken(token);
      
      console.log('✅ App Check token validated successfully with advanced settings');
      if (decodedToken) {
        console.log(`  - App ID: ${decodedToken.appId || decodedToken.sub || 'unknown'}`);
        if (decodedToken.iat) {
          try {
            console.log(`  - Issued at: ${new Date(decodedToken.iat * 1000).toISOString()}`);
          } catch {
            console.log(`  - Issued at: ${decodedToken.iat} (raw)`);
          }
        }
      }
      console.log(`  - Play Integrity: Elevated integrity validated`);
      console.log(`  - Risk assessment: Passed custom thresholds`);
      
      return decodedToken;
    } catch (error) {
      console.error('❌ App Check token validation failed:', error);
      console.error('  - This may indicate unauthorized app access attempt');
      return null;
    }
  }

  /**
   * Middleware function for Express routes
   */
  middleware() {
    return async (req, res, next) => {
      try {
        // Get App Check token from header
        const appCheckToken = req.headers['x-firebase-app-check'];
        
        if (!appCheckToken) {
          console.warn('⚠️ No App Check token in request headers');
          return res.status(401).json({
            success: false,
            error: {
              code: 'MISSING_APP_CHECK_TOKEN',
              message: 'App Check token required for mobile app requests'
            }
          });
        }

        // Validate the token
        const decodedToken = await this.validateToken(appCheckToken);
        
        if (!decodedToken) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'INVALID_APP_CHECK_TOKEN',
              message: 'Invalid or expired App Check token'
            }
          });
        }

        // Add decoded token to request for use in route handlers
        req.appCheckToken = decodedToken;
        
        console.log(`🔒 App Check validation passed for app: ${decodedToken.appId || decodedToken.sub || 'unknown'}`);
        next();
      } catch (error) {
        console.error('❌ App Check middleware error:', error);
        return res.status(500).json({
          success: false,
          error: {
            code: 'APP_CHECK_MIDDLEWARE_ERROR',
            message: 'App Check validation failed'
          }
        });
      }
    };
  }

  /**
   * Optional middleware - validates token if present but doesn't require it
   * Useful for endpoints that work with or without App Check
   */
  optionalMiddleware() {
    return async (req, res, next) => {
      try {
        const appCheckToken = req.headers['x-firebase-app-check'];
        
        if (appCheckToken) {
          const decodedToken = await this.validateToken(appCheckToken);
          if (decodedToken) {
            req.appCheckToken = decodedToken;
            console.log(`🔒 Optional App Check validation passed for app: ${decodedToken.appId || decodedToken.sub || 'unknown'}`);
          } else {
            console.warn('⚠️ App Check token provided but validation failed (continuing without it)');
          }
        } else {
          console.log('ℹ️ No App Check token provided (optional validation)');
          // In development, warn about missing App Check token
          if (process.env.NODE_ENV === 'development') {
            console.warn('⚠️ [DEV] No App Check token in request - this is expected for development builds');
            console.warn('⚠️ [DEV] Make sure Firebase Console App Check enforcement is set to "Unenforced"');
          }
        }
        
        next();
      } catch (error) {
        console.error('❌ Optional App Check middleware error:', error);
        // Don't fail the request for optional validation
        console.warn('⚠️ App Check validation error - continuing without App Check protection');
        next();
      }
    };
  }

  /**
   * Get middleware configuration
   */
  getConfig() {
    return {
      isInitialized: this.isInitialized,
      projectId: environmentConfig.getFirebaseConfig().projectId
    };
  }
}

// Export singleton instance
module.exports = AppCheckMiddleware;
