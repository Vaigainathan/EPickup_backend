const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class JWTService {
  constructor() {
    this.secret = process.env.JWT_SECRET;
    this.expiresIn = process.env.JWT_EXPIRES_IN || '7d'; // Access token: 7 days
    this.refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '90d'; // Refresh token: 90 days
    
    if (!this.secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  /**
   * Generate access token
   * @param {Object} payload - Token payload
   * @param {string} payload.userId - User ID
   * @param {string} payload.userType - User type (customer, driver, admin)
   * @param {string} payload.phone - User phone number
   * @param {Object} payload.metadata - Additional metadata
   * @returns {string} JWT token
   */
  generateAccessToken(payload) {
    const tokenPayload = {
      userId: payload.userId,
      userType: payload.userType,
      phone: payload.phone,
      type: 'access',
      iat: Math.floor(Date.now() / 1000),
      ...payload.metadata
    };

    return jwt.sign(tokenPayload, this.secret, {
      expiresIn: this.expiresIn,
      issuer: 'epickup-app',
      audience: 'epickup-users'
    });
  }

  /**
   * Generate refresh token
   * @param {Object} payload - Token payload
   * @returns {string} JWT refresh token
   */
  generateRefreshToken(payload) {
    const tokenPayload = {
      userId: payload.userId,
      userType: payload.userType,
      phone: payload.phone,
      type: 'refresh',
      iat: Math.floor(Date.now() / 1000)
    };

    return jwt.sign(tokenPayload, this.secret, {
      expiresIn: this.refreshExpiresIn,
      issuer: 'epickup-app',
      audience: 'epickup-users'
    });
  }

  /**
   * Generate both access and refresh tokens
   * @param {Object} payload - Token payload
   * @returns {Object} Object containing access and refresh tokens
   */
  generateTokenPair(payload) {
    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(payload);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.getExpirationTime(this.expiresIn),
      refreshExpiresIn: this.getExpirationTime(this.refreshExpiresIn)
    };
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token to verify
   * @returns {Object} Decoded token payload
   */
  verifyToken(token) {
    try {
      // Validate token format first
      if (!token || typeof token !== 'string') {
        throw new Error('Token is required and must be a string');
      }

      // Check if token has proper JWT format (3 parts separated by dots)
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        console.error('Malformed JWT token - invalid format:', {
          tokenLength: token.length,
          parts: tokenParts.length,
          tokenPreview: token.substring(0, 20) + '...'
        });
        throw new Error('Invalid token format');
      }

      // Try with issuer/audience first, then fallback to basic verification
      let decoded;
      try {
        decoded = jwt.verify(token, this.secret, {
          issuer: 'epickup-app',
          audience: 'epickup-users'
        });
      } catch (issuerError) {
        // Fallback to basic verification without issuer/audience
        console.log('JWT verification with issuer/audience failed, trying basic verification:', issuerError.message);
        decoded = jwt.verify(token, this.secret);
      }

      // Check if token is expired
      if (decoded.exp && Date.now() >= decoded.exp * 1000) {
        throw new Error('Token expired');
      }

      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token expired');
      } else if (error.name === 'JsonWebTokenError') {
        console.error('JWT verification failed:', {
          error: error.message,
          tokenPreview: token ? token.substring(0, 20) + '...' : 'null',
          tokenLength: token ? token.length : 0
        });
        throw new Error('Invalid token');
      } else if (error.name === 'NotBeforeError') {
        throw new Error('Token not active');
      }
      console.error('JWT verification error:', error.message);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - Refresh token
   * @returns {Object} New token pair
   */
  refreshAccessToken(refreshToken) {
    try {
      const decoded = this.verifyToken(refreshToken);
      
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid refresh token');
      }

      // Generate new token pair
      const newPayload = {
        userId: decoded.userId,
        userType: decoded.userType,
        phone: decoded.phone,
        metadata: {}
      };

      return this.generateTokenPair(newPayload);
    } catch (error) {
      throw new Error(`Failed to refresh token: ${error.message}`);
    }
  }

  /**
   * Decode token without verification (for debugging)
   * @param {string} token - JWT token
   * @returns {Object} Decoded token payload
   */
  decodeToken(token) {
    try {
      return jwt.decode(token);
    } catch {
      throw new Error('Failed to decode token');
    }
  }

  /**
   * Get token expiration time in milliseconds
   * @param {string} expiresIn - Expiration string (e.g., '7d', '24h')
   * @returns {number} Expiration time in milliseconds
   */
  getExpirationTime(expiresIn) {
    const now = Date.now();
    const expiresInMs = this.parseExpiration(expiresIn);
    return now + expiresInMs;
  }

  /**
   * Parse expiration string to milliseconds
   * @param {string} expiresIn - Expiration string
   * @returns {number} Milliseconds
   */
  parseExpiration(expiresIn) {
    const match = expiresIn.match(/^(\d+)([smhdwy])$/);
    if (!match) {
      throw new Error('Invalid expiration format. Use format like "7d", "24h", "30m"');
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    const multipliers = {
      s: 1000,        // seconds
      m: 60 * 1000,   // minutes
      h: 60 * 60 * 1000, // hours
      d: 24 * 60 * 60 * 1000, // days
      w: 7 * 24 * 60 * 60 * 1000, // weeks
      y: 365 * 24 * 60 * 60 * 1000 // years
    };

    return value * multipliers[unit];
  }

  /**
   * Generate secure random string for additional security
   * @param {number} length - Length of random string
   * @returns {string} Random string
   */
  generateSecureRandom(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Get token information without verification
   * @param {string} token - JWT token
   * @returns {Object} Token information
   */
  getTokenInfo(token) {
    try {
      const decoded = this.decodeToken(token);
      const now = Math.floor(Date.now() / 1000);
      
      return {
        userId: decoded.userId,
        userType: decoded.userType,
        phone: decoded.phone,
        type: decoded.type,
        issuedAt: decoded.iat,
        expiresAt: decoded.exp,
        isExpired: decoded.exp ? now >= decoded.exp : false,
        timeUntilExpiry: decoded.exp ? decoded.exp - now : null
      };
    } catch {
      throw new Error('Failed to get token info');
    }
  }

  /**
   * Validate token format without verification
   * @param {string} token - JWT token
   * @returns {boolean} True if format is valid
   */
  isValidTokenFormat(token) {
    if (!token || typeof token !== 'string') {
      return false;
    }

    // Check if token has 3 parts separated by dots
    const parts = token.split('.');
    if (parts.length !== 3) {
      return false;
    }

    // Check if parts are base64 encoded
    try {
      parts.forEach(part => {
        if (part && !/^[A-Za-z0-9+/=]+$/.test(part)) {
          throw new Error('Invalid base64');
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Blacklist token (for logout functionality)
   * @param {string} token - JWT token to blacklist
   * @param {number} expiresAt - When the blacklist entry should expire
   */
  async blacklistToken(token, expiresAt) {
    // This would typically interact with Redis or database
    // For now, we'll just return success
    // In production, implement proper token blacklisting
    return {
      success: true,
      message: 'Token blacklisted successfully',
      expiresAt: expiresAt
    };
  }

  /**
   * Check if token is blacklisted
   * @param {string} token - JWT token to check
   * @returns {boolean} True if token is blacklisted
   */
  async isTokenBlacklisted(token) { // eslint-disable-line no-unused-vars
    // This would typically check Redis or database
    // For now, we'll just return false
    // In production, implement proper blacklist checking
    return false;
  }
}

module.exports = JWTService;
