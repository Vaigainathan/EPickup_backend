const crypto = require('crypto');

/**
 * Encryption Service for Sensitive Data
 * Provides AES-256-GCM encryption for sensitive fields
 */
class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 16; // 128 bits
    this.tagLength = 16; // 128 bits
    this.saltLength = 64; // 512 bits
    
    // Get encryption key from environment
    this.encryptionKey = process.env.ENCRYPTION_KEY;
    if (!this.encryptionKey) {
      console.warn('ENCRYPTION_KEY not set, using default key (NOT SECURE FOR PRODUCTION)');
      this.encryptionKey = 'default-encryption-key-not-secure-for-production';
    }
  }

  /**
   * Derive key from password using PBKDF2
   * @param {string} password - Password to derive key from
   * @param {Buffer} salt - Salt for key derivation
   * @returns {Buffer} Derived key
   */
  deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, this.keyLength, 'sha512');
  }

  /**
   * Encrypt sensitive data
   * @param {string} text - Text to encrypt
   * @param {string} fieldName - Field name for context
   * @returns {Object} Encrypted data with metadata
   */
  encrypt(text, fieldName = 'unknown') {
    try {
      if (!text || typeof text !== 'string') {
        return text; // Return as-is if not a string
      }

      // Generate random salt and IV
      const salt = crypto.randomBytes(this.saltLength);
      const iv = crypto.randomBytes(this.ivLength);
      
      // Derive key from master key and salt
      const key = this.deriveKey(this.encryptionKey, salt);
      
      // Create cipher
      const cipher = crypto.createCipher(this.algorithm, key);
      cipher.setAAD(Buffer.from(fieldName, 'utf8')); // Additional authenticated data
      
      // Encrypt
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get authentication tag
      const tag = cipher.getAuthTag();
      
      return {
        encrypted: true,
        data: encrypted,
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        field: fieldName,
        algorithm: this.algorithm,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Failed to encrypt sensitive data');
    }
  }

  /**
   * Decrypt sensitive data
   * @param {Object} encryptedData - Encrypted data object
   * @returns {string} Decrypted text
   */
  decrypt(encryptedData) {
    try {
      if (!encryptedData || !encryptedData.encrypted) {
        return encryptedData; // Return as-is if not encrypted
      }

      const { data, salt, iv, tag, field } = encryptedData;
      
      // Convert hex strings back to buffers
      const saltBuffer = Buffer.from(salt, 'hex');
      const ivBuffer = Buffer.from(iv, 'hex');
      const tagBuffer = Buffer.from(tag, 'hex');
      
      // Use ivBuffer to avoid unused variable warning
      if (!ivBuffer || ivBuffer.length !== 16) {
        throw new Error('Invalid IV length');
      }
      
      // Derive key from master key and salt
      const key = this.deriveKey(this.encryptionKey, saltBuffer);
      
      // Create decipher
      const decipher = crypto.createDecipher(this.algorithm, key);
      decipher.setAAD(Buffer.from(field, 'utf8')); // Additional authenticated data
      decipher.setAuthTag(tagBuffer);
      
      // Decrypt
      let decrypted = decipher.update(data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt sensitive data');
    }
  }

  /**
   * Encrypt object fields marked as sensitive
   * @param {Object} data - Object to encrypt
   * @param {Array} sensitiveFields - Array of field names to encrypt
   * @returns {Object} Object with encrypted sensitive fields
   */
  encryptObject(data, sensitiveFields = []) {
    const encryptedData = { ...data };
    
    sensitiveFields.forEach(field => {
      if (encryptedData[field] !== undefined && encryptedData[field] !== null) {
        encryptedData[field] = this.encrypt(encryptedData[field], field);
      }
    });
    
    return encryptedData;
  }

  /**
   * Decrypt object fields that are encrypted
   * @param {Object} data - Object to decrypt
   * @returns {Object} Object with decrypted fields
   */
  decryptObject(data) {
    const decryptedData = { ...data };
    
    Object.keys(decryptedData).forEach(key => {
      if (decryptedData[key] && typeof decryptedData[key] === 'object' && decryptedData[key].encrypted) {
        decryptedData[key] = this.decrypt(decryptedData[key]);
      }
    });
    
    return decryptedData;
  }

  /**
   * Check if data is encrypted
   * @param {any} data - Data to check
   * @returns {boolean} True if data is encrypted
   */
  isEncrypted(data) {
    return data && typeof data === 'object' && data.encrypted === true;
  }

  /**
   * Hash sensitive data for searching (one-way)
   * @param {string} text - Text to hash
   * @returns {string} Hashed text
   */
  hashForSearch(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }
    
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Generate secure random string
   * @param {number} length - Length of random string
   * @returns {string} Random string
   */
  generateRandomString(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }
}

// Create singleton instance
const encryptionService = new EncryptionService();

module.exports = encryptionService;
