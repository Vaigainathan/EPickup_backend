#!/usr/bin/env node

/**
 * Test Firebase Middleware
 * This will help us debug the middleware issues
 */

console.log('🔍 Testing Firebase Middleware...\n');

try {
  // Test 1: Import the middleware
  console.log('📝 Step 1: Importing Firebase middleware...');
  const { firebaseIdTokenAuth, requireRole, requirePermission } = require('./src/middleware/firebaseIdTokenAuth');
  console.log('✅ Firebase middleware imported successfully');
  
  // Test 2: Check if functions are available
  console.log('\n📝 Step 2: Checking middleware functions...');
  console.log(`📋 firebaseIdTokenAuth: ${typeof firebaseIdTokenAuth}`);
  console.log(`📋 requireRole: ${typeof requireRole}`);
  console.log(`📋 requirePermission: ${typeof requirePermission}`);
  
  // Test 3: Test requireRole function
  console.log('\n📝 Step 3: Testing requireRole function...');
  const roleMiddleware = requireRole(['super_admin']);
  console.log(`📋 Role middleware: ${typeof roleMiddleware}`);
  
  // Test 4: Test requirePermission function
  console.log('\n📝 Step 4: Testing requirePermission function...');
  const permissionMiddleware = requirePermission('manage_users');
  console.log(`📋 Permission middleware: ${typeof permissionMiddleware}`);
  
  console.log('\n✅ Firebase middleware test completed successfully!');
  
} catch (error) {
  console.error('\n❌ Firebase middleware test failed:', error.message);
  console.error('📋 Full error:', error);
  
  if (error.message.includes('Cannot find module')) {
    console.log('\n💡 Possible solutions:');
    console.log('1. Check if the middleware file exists');
    console.log('2. Check if there are syntax errors in the middleware');
    console.log('3. Check if Firebase Admin SDK is properly installed');
  }
}
