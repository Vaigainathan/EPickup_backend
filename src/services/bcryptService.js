const bcrypt = require('bcryptjs');

class BcryptService {
  constructor() {
    this.saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    this.maxSaltRounds = 16; // Maximum allowed salt rounds for security
    
    // Validate salt rounds
    if (this.saltRounds < 10 || this.saltRounds > this.maxSaltRounds) {
      console.warn(`BCRYPT_SALT_ROUNDS should be between 10 and ${this.maxSaltRounds}. Using default: 12`);
      this.saltRounds = 12;
    }
  }

  /**
   * Hash a password
   * @param {string} password - Plain text password
   * @param {number} saltRounds - Optional custom salt rounds
   * @returns {Promise<string>} Hashed password
   */
  async hashPassword(password, saltRounds = null) {
    try {
      if (!password || typeof password !== 'string') {
        throw new Error('Password must be a non-empty string');
      }

      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
      }

      const rounds = saltRounds || this.saltRounds;
      
      // Validate custom salt rounds
      if (rounds < 10 || rounds > this.maxSaltRounds) {
        throw new Error(`Salt rounds must be between 10 and ${this.maxSaltRounds}`);
      }

      const hashedPassword = await bcrypt.hash(password, rounds);
      
      return hashedPassword;
    } catch (error) {
      throw new Error(`Failed to hash password: ${error.message}`);
    }
  }

  /**
   * Verify a password against a hash
   * @param {string} password - Plain text password
   * @param {string} hash - Hashed password to compare against
   * @returns {Promise<boolean>} True if password matches
   */
  async verifyPassword(password, hash) {
    try {
      if (!password || !hash) {
        throw new Error('Password and hash are required');
      }

      if (typeof password !== 'string' || typeof hash !== 'string') {
        throw new Error('Password and hash must be strings');
      }

      const isValid = await bcrypt.compare(password, hash);
      return isValid;
    } catch (error) {
      throw new Error(`Failed to verify password: ${error.message}`);
    }
  }

  /**
   * Generate a salt
   * @param {number} saltRounds - Number of salt rounds
   * @returns {Promise<string>} Generated salt
   */
  async generateSalt(saltRounds = null) {
    try {
      const rounds = saltRounds || this.saltRounds;
      
      if (rounds < 10 || rounds > this.maxSaltRounds) {
        throw new Error(`Salt rounds must be between 10 and ${this.maxSaltRounds}`);
      }

      const salt = await bcrypt.genSalt(rounds);
      return salt;
    } catch (error) {
      throw new Error(`Failed to generate salt: ${error.message}`);
    }
  }

  /**
   * Hash a password with a specific salt
   * @param {string} password - Plain text password
   * @param {string} salt - Specific salt to use
   * @returns {Promise<string>} Hashed password
   */
  async hashPasswordWithSalt(password, salt) {
    try {
      if (!password || !salt) {
        throw new Error('Password and salt are required');
      }

      if (typeof password !== 'string' || typeof salt !== 'string') {
        throw new Error('Password and salt must be strings');
      }

      const hashedPassword = await bcrypt.hash(password, salt);
      return hashedPassword;
    } catch (error) {
      throw new Error(`Failed to hash password with salt: ${error.message}`);
    }
  }

  /**
   * Get hash information
   * @param {string} hash - Hashed password
   * @returns {Object} Hash information
   */
  getHashInfo(hash) {
    try {
      if (!hash || typeof hash !== 'string') {
        throw new Error('Hash is required and must be a string');
      }

      // Extract salt rounds from hash
      const saltRounds = bcrypt.getRounds(hash);
      
      return {
        saltRounds,
        hashLength: hash.length,
        isValidFormat: hash.startsWith('$2b$') || hash.startsWith('$2a$'),
        algorithm: hash.startsWith('$2b$') ? 'bcrypt' : 'bcrypt-legacy'
      };
    } catch (error) {
      throw new Error(`Failed to get hash info: ${error.message}`);
    }
  }

  /**
   * Check if a hash needs to be rehashed (e.g., if salt rounds increased)
   * @param {string} hash - Hashed password
   * @param {number} targetRounds - Target salt rounds
   * @returns {boolean} True if rehashing is needed
   */
  needsRehash(hash, targetRounds = null) {
    try {
      const target = targetRounds || this.saltRounds;
      const currentRounds = bcrypt.getRounds(hash);
      
      return currentRounds < target;
    } catch (error) {
      // If we can't determine rounds, assume rehashing is needed
      return true;
    }
  }

  /**
   * Rehash a password if needed
   * @param {string} password - Plain text password
   * @param {string} hash - Current hash
   * @param {number} targetRounds - Target salt rounds
   * @returns {Promise<Object>} Object with new hash and whether rehashing occurred
   */
  async rehashIfNeeded(password, hash, targetRounds = null) {
    try {
      const target = targetRounds || this.saltRounds;
      
      if (!this.needsRehash(hash, target)) {
        return {
          hash: hash,
          rehashed: false,
          message: 'Password does not need rehashing'
        };
      }

      const newHash = await this.hashPassword(password, target);
      
      return {
        hash: newHash,
        rehashed: true,
        message: `Password rehashed from ${bcrypt.getRounds(hash)} to ${target} rounds`
      };
    } catch (error) {
      throw new Error(`Failed to rehash password: ${error.message}`);
    }
  }

  /**
   * Validate password strength
   * @param {string} password - Password to validate
   * @returns {Object} Validation result with score and suggestions
   */
  validatePasswordStrength(password) {
    if (!password || typeof password !== 'string') {
      return {
        isValid: false,
        score: 0,
        errors: ['Password is required'],
        suggestions: []
      };
    }

    const errors = [];
    const suggestions = [];
    let score = 0;

    // Length check
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    } else if (password.length >= 12) {
      score += 2;
    } else {
      score += 1;
    }

    // Character variety checks
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    // Common patterns to avoid
    if (/(.)\1{2,}/.test(password)) {
      errors.push('Password should not contain repeated characters');
      score -= 1;
    }

    if (/123|abc|qwe/i.test(password)) {
      errors.push('Password should not contain common sequences');
      score -= 1;
    }

    // Suggestions
    if (password.length < 12) {
      suggestions.push('Consider using a longer password (12+ characters)');
    }
    
    if (!/[^A-Za-z0-9]/.test(password)) {
      suggestions.push('Add special characters to increase security');
    }

    if (!/[0-9]/.test(password)) {
      suggestions.push('Include numbers in your password');
    }

    const isValid = score >= 3 && errors.length === 0;

    return {
      isValid,
      score: Math.max(0, score),
      errors,
      suggestions,
      strength: this.getStrengthLevel(score)
    };
  }

  /**
   * Get password strength level
   * @param {number} score - Password score
   * @returns {string} Strength level
   */
  getStrengthLevel(score) {
    if (score >= 5) return 'very-strong';
    if (score >= 4) return 'strong';
    if (score >= 3) return 'moderate';
    if (score >= 2) return 'weak';
    return 'very-weak';
  }

  /**
   * Generate a secure random password
   * @param {number} length - Password length
   * @param {Object} options - Generation options
   * @returns {string} Generated password
   */
  generateSecurePassword(length = 16, options = {}) {
    const {
      includeUppercase = true,
      includeLowercase = true,
      includeNumbers = true,
      includeSymbols = true,
      excludeSimilar = true
    } = options;

    let charset = '';
    let password = '';

    if (includeUppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (includeLowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
    if (includeNumbers) charset += '0123456789';
    if (includeSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    // Remove similar characters if requested
    if (excludeSimilar) {
      charset = charset.replace(/[0O1Il]/g, '');
    }

    if (charset.length === 0) {
      throw new Error('At least one character type must be selected');
    }

    // Generate password
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      password += charset[randomIndex];
    }

    return password;
  }

  /**
   * Get service configuration
   * @returns {Object} Service configuration
   */
  getConfig() {
    return {
      saltRounds: this.saltRounds,
      maxSaltRounds: this.maxSaltRounds,
      algorithm: 'bcrypt',
      version: '2.4.3'
    };
  }
}

module.exports = BcryptService;
