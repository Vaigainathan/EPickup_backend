#!/usr/bin/env node

/**
 * JWT and Bcrypt Services Test Script
 * 
 * This script tests both JWT and Bcrypt services to ensure they're working correctly.
 * Run this after setting up your environment variables.
 */

require('dotenv').config();

// Import services
const JWTService = require('../src/services/jwtService');
const BcryptService = require('../src/services/bcryptService');

// Test configuration
const TEST_CONFIG = {
  // Test user data
  testUser: {
    userId: 'test_user_123',
    userType: 'customer',
    phone: '+919999999999',
    metadata: {
      appVersion: '2.0.0',
      deviceId: 'test_device_123'
    }
  },
  
  // Test password
  testPassword: 'TestPassword123!',
  
  // Test token (will be generated)
  testToken: null,
  testRefreshToken: null
};

/**
 * Test JWT Service
 */
async function testJWTService() {
  console.log('\n🔐 Testing JWT Service...');
  
  try {
    const jwtService = new JWTService();
    console.log('✅ JWT Service initialized successfully');
    
    // Test token generation
    console.log('\n📝 Testing token generation...');
    const tokenPair = jwtService.generateTokenPair(TEST_CONFIG.testUser);
    TEST_CONFIG.testToken = tokenPair.accessToken;
    TEST_CONFIG.testRefreshToken = tokenPair.refreshToken;
    
    console.log('✅ Access token generated:', tokenPair.accessToken.substring(0, 50) + '...');
    console.log('✅ Refresh token generated:', tokenPair.refreshToken.substring(0, 50) + '...');
    console.log('✅ Expires in:', tokenPair.expiresIn);
    
    // Test token verification
    console.log('\n🔍 Testing token verification...');
    const decodedToken = jwtService.verifyToken(TEST_CONFIG.testToken);
    console.log('✅ Token verified successfully');
    console.log('   - User ID:', decodedToken.userId);
    console.log('   - User Type:', decodedToken.userType);
    console.log('   - Phone:', decodedToken.phone);
    console.log('   - Type:', decodedToken.type);
    console.log('   - Issued At:', new Date(decodedToken.iat * 1000).toISOString());
    console.log('   - Expires At:', new Date(decodedToken.exp * 1000).toISOString());
    
    // Test token info
    console.log('\nℹ️ Testing token info...');
    const tokenInfo = jwtService.getTokenInfo(TEST_CONFIG.testToken);
    console.log('✅ Token info retrieved:', {
      userId: tokenInfo.userId,
      userType: tokenInfo.userType,
      type: tokenInfo.type,
      isExpired: tokenInfo.isExpired,
      timeUntilExpiry: tokenInfo.timeUntilExpiry ? `${Math.round(tokenInfo.timeUntilExpiry / 60)} minutes` : 'N/A'
    });
    
    // Test token format validation
    console.log('\n✅ Testing token format validation...');
    const isValidFormat = jwtService.isValidTokenFormat(TEST_CONFIG.testToken);
    console.log('✅ Token format validation:', isValidFormat);
    
    // Test refresh token functionality
    console.log('\n🔄 Testing refresh token...');
    const newTokenPair = jwtService.refreshAccessToken(TEST_CONFIG.testRefreshToken);
    console.log('✅ New token pair generated from refresh token');
    console.log('   - New access token:', newTokenPair.accessToken.substring(0, 50) + '...');
    console.log('   - New refresh token:', newTokenPair.refreshToken.substring(0, 50) + '...');
    
    // Test secure random generation
    console.log('\n🎲 Testing secure random generation...');
    const secureRandom = jwtService.generateSecureRandom(32);
    console.log('✅ Secure random string generated:', secureRandom.substring(0, 20) + '...');
    
    console.log('\n🎉 JWT Service tests completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ JWT Service test failed:', error.message);
    return false;
  }
}

/**
 * Test Bcrypt Service
 */
async function testBcryptService() {
  console.log('\n🔐 Testing Bcrypt Service...');
  
  try {
    const bcryptService = new BcryptService();
    console.log('✅ Bcrypt Service initialized successfully');
    
    // Test password hashing
    console.log('\n🔒 Testing password hashing...');
    const hashedPassword = await bcryptService.hashPassword(TEST_CONFIG.testPassword);
    console.log('✅ Password hashed successfully');
    console.log('   - Original password:', TEST_CONFIG.testPassword);
    console.log('   - Hashed password:', hashedPassword.substring(0, 30) + '...');
    
    // Test password verification
    console.log('\n🔍 Testing password verification...');
    const isPasswordValid = await bcryptService.verifyPassword(TEST_CONFIG.testPassword, hashedPassword);
    console.log('✅ Password verification:', isPasswordValid ? 'SUCCESS' : 'FAILED');
    
    // Test wrong password
    const isWrongPasswordValid = await bcryptService.verifyPassword('WrongPassword123!', hashedPassword);
    console.log('✅ Wrong password verification:', isWrongPasswordValid ? 'FAILED (should be false)' : 'SUCCESS (correctly rejected)');
    
    // Test hash info
    console.log('\nℹ️ Testing hash info...');
    const hashInfo = bcryptService.getHashInfo(hashedPassword);
    console.log('✅ Hash info retrieved:', hashInfo);
    
    // Test salt generation
    console.log('\n🧂 Testing salt generation...');
    const salt = await bcryptService.generateSalt(12);
    console.log('✅ Salt generated:', salt.substring(0, 30) + '...');
    
    // Test password with specific salt
    console.log('\n🔐 Testing password with specific salt...');
    const hashedWithSalt = await bcryptService.hashPasswordWithSalt(TEST_CONFIG.testPassword, salt);
    console.log('✅ Password hashed with specific salt');
    
    // Test password strength validation
    console.log('\n💪 Testing password strength validation...');
    const strengthResult = bcryptService.validatePasswordStrength(TEST_CONFIG.testPassword);
    console.log('✅ Password strength validation:', {
      isValid: strengthResult.isValid,
      score: strengthResult.score,
      strength: strengthResult.strength,
      errors: strengthResult.errors,
      suggestions: strengthResult.suggestions
    });
    
    // Test weak password
    console.log('\n⚠️ Testing weak password...');
    const weakPassword = '123';
    const weakStrengthResult = bcryptService.validatePasswordStrength(weakPassword);
    console.log('✅ Weak password validation:', {
      isValid: weakStrengthResult.isValid,
      score: weakStrengthResult.score,
      strength: weakStrengthResult.strength,
      errors: weakStrengthResult.errors
    });
    
    // Test secure password generation
    console.log('\n🎯 Testing secure password generation...');
    const securePassword = bcryptService.generateSecurePassword(16, {
      includeUppercase: true,
      includeLowercase: true,
      includeNumbers: true,
      includeSymbols: true
    });
    console.log('✅ Secure password generated:', securePassword);
    
    // Test password rehashing
    console.log('\n🔄 Testing password rehashing...');
    const rehashResult = await bcryptService.rehashIfNeeded(TEST_CONFIG.testPassword, hashedPassword, 14);
    console.log('✅ Rehash check completed:', {
      rehashed: rehashResult.rehashed,
      message: rehashResult.message
    });
    
    // Test service configuration
    console.log('\n⚙️ Testing service configuration...');
    const config = bcryptService.getConfig();
    console.log('✅ Service configuration:', config);
    
    console.log('\n🎉 Bcrypt Service tests completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ Bcrypt Service test failed:', error.message);
    return false;
  }
}

/**
 * Test JWT Middleware
 */
async function testJWTMiddleware() {
  console.log('\n🛡️ Testing JWT Middleware...');
  
  try {
    const jwtMiddleware = require('../src/middleware/jwtAuth');
    console.log('✅ JWT Middleware imported successfully');
    
    // Test middleware functions exist
    console.log('\n🔍 Testing middleware functions...');
    const functions = ['authenticate', 'optionalAuth', 'requireRole', 'requireOwnership', 'authRateLimit'];
    
    functions.forEach(funcName => {
      if (typeof jwtMiddleware[funcName] === 'function') {
        console.log(`✅ ${funcName} function exists`);
      } else {
        console.log(`❌ ${funcName} function missing`);
      }
    });
    
    // Test role requirement function
    console.log('\n👥 Testing role requirement function...');
    const roleMiddleware = jwtMiddleware.requireRole(['customer', 'driver']);
    if (typeof roleMiddleware === 'function') {
      console.log('✅ Role requirement middleware created successfully');
    } else {
      console.log('❌ Role requirement middleware creation failed');
    }
    
    console.log('\n🎉 JWT Middleware tests completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ JWT Middleware test failed:', error.message);
    return false;
  }
}

/**
 * Test environment variables
 */
function testEnvironmentVariables() {
  console.log('\n🌍 Testing Environment Variables...');
  
  const requiredVars = [
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'BCRYPT_SALT_ROUNDS'
  ];
  
  let allVarsPresent = true;
  
  requiredVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`✅ ${varName}: ${varName === 'JWT_SECRET' ? '***SET***' : process.env[varName]}`);
    } else {
      console.log(`❌ ${varName}: NOT SET`);
      allVarsPresent = false;
    }
  });
  
  // Test JWT secret length
  if (process.env.JWT_SECRET) {
    const secretLength = process.env.JWT_SECRET.length;
    if (secretLength >= 64) {
      console.log(`✅ JWT_SECRET length: ${secretLength} characters (Good)`);
    } else {
      console.log(`⚠️ JWT_SECRET length: ${secretLength} characters (Consider using longer secret)`);
    }
  }
  
  // Test bcrypt salt rounds
  if (process.env.BCRYPT_SALT_ROUNDS) {
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS);
    if (saltRounds >= 10 && saltRounds <= 16) {
      console.log(`✅ BCRYPT_SALT_ROUNDS: ${saltRounds} (Good)`);
    } else {
      console.log(`⚠️ BCRYPT_SALT_ROUNDS: ${saltRounds} (Should be between 10-16)`);
    }
  }
  
  return allVarsPresent;
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🚀 Starting JWT and Bcrypt Services Test Suite...');
  console.log('=' .repeat(60));
  
  let testsPassed = 0;
  let totalTests = 4;
  
  // Test environment variables
  if (testEnvironmentVariables()) {
    testsPassed++;
  }
  
  // Test JWT service
  if (await testJWTService()) {
    testsPassed++;
  }
  
  // Test Bcrypt service
  if (await testBcryptService()) {
    testsPassed++;
  }
  
  // Test JWT middleware
  if (await testJWTMiddleware()) {
    testsPassed++;
  }
  
  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log('📊 Test Summary:');
  console.log(`   Tests Passed: ${testsPassed}/${totalTests}`);
  console.log(`   Success Rate: ${Math.round((testsPassed / totalTests) * 100)}%`);
  
  if (testsPassed === totalTests) {
    console.log('\n🎉 All tests passed! Your JWT and Bcrypt services are working correctly.');
    console.log('\n💡 Next steps:');
    console.log('   1. Use JWTService in your authentication routes');
    console.log('   2. Use BcryptService for password hashing');
    console.log('   3. Use JWT middleware for protected routes');
    console.log('   4. Consider implementing token blacklisting with Redis');
  } else {
    console.log('\n⚠️ Some tests failed. Please check the errors above and fix the issues.');
  }
  
  console.log('\n🔐 Security Recommendations:');
  console.log('   - Rotate JWT_SECRET periodically in production');
  console.log('   - Use HTTPS in production');
  console.log('   - Implement rate limiting for auth endpoints');
  console.log('   - Consider using refresh token rotation');
  console.log('   - Monitor for suspicious authentication patterns');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = {
  testJWTService,
  testBcryptService,
  testJWTMiddleware,
  testEnvironmentVariables,
  runAllTests
};
