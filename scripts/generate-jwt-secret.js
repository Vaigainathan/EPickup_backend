#!/usr/bin/env node

/**
 * JWT Secret Generator
 * Generates cryptographically secure JWT secrets for production use
 */

const crypto = require('crypto');

/**
 * Generate a secure JWT secret
 * @param {number} length - Length of the secret in bytes (default: 64)
 * @returns {string} Base64 encoded secret
 */
function generateJWTSecret(length = 64) {
  // Generate cryptographically secure random bytes
  const randomBytes = crypto.randomBytes(length);
  
  // Convert to base64 for better readability and storage
  const secret = randomBytes.toString('base64');
  
  return secret;
}

/**
 * Generate a hex-encoded JWT secret
 * @param {number} length - Length of the secret in bytes (default: 32)
 * @returns {string} Hex encoded secret
 */
function generateJWTSecretHex(length = 32) {
  const randomBytes = crypto.randomBytes(length);
  return randomBytes.toString('hex');
}

/**
 * Generate a URL-safe JWT secret
 * @param {number} length - Length of the secret in bytes (default: 48)
 * @returns {string} URL-safe base64 encoded secret
 */
function generateJWTSecretURLSafe(length = 48) {
  const randomBytes = crypto.randomBytes(length);
  return randomBytes.toString('base64url');
}

// Main execution
if (require.main === module) {
  console.log('🔐 JWT Secret Generator');
  console.log('======================\n');
  
  // Generate different types of secrets
  const base64Secret = generateJWTSecret(64);
  const hexSecret = generateJWTSecretHex(32);
  const urlSafeSecret = generateJWTSecretURLSafe(48);
  
  console.log('📋 Generated JWT Secrets:');
  console.log('-------------------------');
  console.log(`Base64 (64 bytes): ${base64Secret}`);
  console.log(`Hex (32 bytes):    ${hexSecret}`);
  console.log(`URL-Safe (48 bytes): ${urlSafeSecret}`);
  
  console.log('\n📝 Usage Instructions:');
  console.log('----------------------');
  console.log('1. Copy one of the secrets above');
  console.log('2. Add it to your Render environment variables as JWT_SECRET');
  console.log('3. Keep this secret secure and never commit it to version control');
  console.log('4. Use different secrets for different environments (dev/staging/prod)');
  
  console.log('\n⚠️  Security Notes:');
  console.log('------------------');
  console.log('• The Base64 secret is recommended for production');
  console.log('• Store this secret securely (password manager, environment variables)');
  console.log('• Never log or expose this secret in your application');
  console.log('• Rotate this secret periodically (every 6-12 months)');
  
  console.log('\n🔄 Token Refresh System:');
  console.log('------------------------');
  console.log('• Access tokens expire in 24h (configurable)');
  console.log('• Refresh tokens expire in 30d (configurable)');
  console.log('• Use /api/auth/refresh endpoint to get new tokens');
  console.log('• Tokens are automatically refreshed by your frontend apps');
}

module.exports = {
  generateJWTSecret,
  generateJWTSecretHex,
  generateJWTSecretURLSafe
};
