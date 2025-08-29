const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
require('dotenv').config();

/**
 * Configuration Validation Script
 * Validates that all required environment variables are properly configured
 */

// Required environment variables for the application
const REQUIRED_ENV_VARS = {
  // Server Configuration
  PORT: 'Server port number',
  NODE_ENV: 'Node environment (development/production)',
  
  // Firebase Configuration
  FIREBASE_PROJECT_ID: 'Firebase project ID',
  FIREBASE_PRIVATE_KEY: 'Firebase private key',
  FIREBASE_CLIENT_EMAIL: 'Firebase client email',
  
  // JWT Configuration
  JWT_SECRET: 'JWT secret key',
  
  // Payment Gateway
  PHONEPE_MERCHANT_ID: 'PhonePe merchant ID',
  PHONEPE_SALT_KEY: 'PhonePe salt key',
  PHONEPE_SALT_INDEX: 'PhonePe salt index',
  PHONEPE_BASE_URL: 'PhonePe API base URL',
  
  // Google Maps
  GOOGLE_MAPS_API_KEY: 'Google Maps API key',
  
  // Twilio Configuration
  TWILIO_ACCOUNT_SID: 'Twilio account SID',
  TWILIO_AUTH_TOKEN: 'Twilio auth token',
  TWILIO_VERIFY_SERVICE_SID: 'Twilio verify service SID',
  
  // Redis Configuration
  REDIS_URL: 'Redis connection URL',
  
  // Backend URL
  BACKEND_URL: 'Backend service URL',
};

// Optional environment variables (with defaults)
const OPTIONAL_ENV_VARS = {
  JWT_EXPIRES_IN: '7d',
  RATE_LIMIT_WINDOW_MS: '900000',
  RATE_LIMIT_MAX_REQUESTS: '100',
  LOG_LEVEL: 'info',
  BCRYPT_SALT_ROUNDS: '12',
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'success' ? '✅' : '📋';
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function validateEnvironmentVariables() {
  log('🔍 Validating environment configuration...');
  
  const missingVars = [];
  const invalidVars = [];
  const warnings = [];
  
  // Check required environment variables
  for (const [varName, description] of Object.entries(REQUIRED_ENV_VARS)) {
    const value = process.env[varName];
    
    if (!value) {
      missingVars.push({ name: varName, description });
    } else if (value.trim() === '') {
      invalidVars.push({ name: varName, description, issue: 'Empty value' });
    } else if (value === 'your_database_url' || value === 'your_api_key') {
      invalidVars.push({ name: varName, description, issue: 'Placeholder value not replaced' });
    }
  }
  
  // Check optional environment variables
  for (const [varName, defaultValue] of Object.entries(OPTIONAL_ENV_VARS)) {
    const value = process.env[varName];
    
    if (!value) {
      warnings.push({ name: varName, message: `Using default value: ${defaultValue}` });
    }
  }
  
  // Validate specific configurations
  validateSpecificConfigs(warnings);
  
  // Report results
  if (missingVars.length > 0) {
    log('❌ Missing required environment variables:', 'error');
    missingVars.forEach(({ name, description }) => {
      log(`   - ${name}: ${description}`, 'error');
    });
  }
  
  if (invalidVars.length > 0) {
    log('❌ Invalid environment variables:', 'error');
    invalidVars.forEach(({ name, description, issue }) => {
      log(`   - ${name}: ${description} (${issue})`, 'error');
    });
  }
  
  if (warnings.length > 0) {
    log('⚠️  Configuration warnings:', 'warning');
    warnings.forEach(({ name, message }) => {
      log(`   - ${name}: ${message}`, 'warning');
    });
  }
  
  if (missingVars.length === 0 && invalidVars.length === 0) {
    log('✅ All required environment variables are properly configured!', 'success');
    return true;
  } else {
    log('❌ Configuration validation failed. Please fix the issues above.', 'error');
    return false;
  }
}

function validateSpecificConfigs(warnings) {
  // Validate Firebase configuration
  const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (firebasePrivateKey && !firebasePrivateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    warnings.push({ 
      name: 'FIREBASE_PRIVATE_KEY', 
      message: 'Private key format may be incorrect (should be PEM format)' 
    });
  }
  
  // Validate phone number format
  const phoneNumber = process.env.TWILIO_ACCOUNT_SID;
  if (phoneNumber && phoneNumber.length < 10) {
    warnings.push({ 
      name: 'TWILIO_ACCOUNT_SID', 
      message: 'Account SID format may be incorrect' 
    });
  }
  
  // Validate URL formats
  const backendUrl = process.env.BACKEND_URL;
  if (backendUrl && !backendUrl.startsWith('http')) {
    warnings.push({ 
      name: 'BACKEND_URL', 
      message: 'URL should start with http:// or https://' 
    });
  }
  
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && !redisUrl.startsWith('redis://')) {
    warnings.push({ 
      name: 'REDIS_URL', 
      message: 'Redis URL should start with redis://' 
    });
  }
}

function checkFileExists() {
  log('📁 Checking for required files...');
  
  const requiredFiles = [
    '.env',
    'firebase-service-account.json',
    'firestore.rules',
    'firestore.indexes.json'
  ];
  
  const missingFiles = [];
  
  for (const file of requiredFiles) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(file);
    }
  }
  
  if (missingFiles.length > 0) {
    log('❌ Missing required files:', 'error');
    missingFiles.forEach(file => {
      log(`   - ${file}`, 'error');
    });
    return false;
  } else {
    log('✅ All required files are present!', 'success');
    return true;
  }
}

function validateNodeVersion() {
  log('🔧 Checking Node.js version...');
  
  const nodeVersion = process.version;
  const requiredVersion = '18.0.0';
  
  if (nodeVersion < requiredVersion) {
    log(`❌ Node.js version ${requiredVersion} or higher is required. Current version: ${nodeVersion}`, 'error');
    return false;
  } else {
    log(`✅ Node.js version ${nodeVersion} is compatible!`, 'success');
    return true;
  }
}

// Main validation function
function main() {
  log('🚀 Starting configuration validation...');
  
  const results = {
    nodeVersion: validateNodeVersion(),
    files: checkFileExists(),
    envVars: validateEnvironmentVariables()
  };
  
  const allValid = Object.values(results).every(result => result === true);
  
  if (allValid) {
    log('🎉 Configuration validation completed successfully!', 'success');
    process.exit(0);
  } else {
    log('💥 Configuration validation failed. Please fix the issues above.', 'error');
    process.exit(1);
  }
}

// Run validation if this script is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  validateEnvironmentVariables,
  checkFileExists,
  validateNodeVersion,
  main
};
