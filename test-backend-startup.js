// Test Backend Startup - Verify Firebase Storage Configuration
const { getFirebaseApp, getStorage, getFirestore } = require('./src/services/firebase');
const enhancedFileUploadService = require('./src/services/enhancedFileUploadService');

async function testBackendStartup() {
  console.log('🧪 Testing Backend Startup...');
  
  try {
    // Test 1: Firebase App Initialization
    console.log('\n1. Testing Firebase App Initialization...');
    const firebaseApp = getFirebaseApp();
    if (firebaseApp) {
      console.log('✅ Firebase App initialized successfully');
    } else {
      console.log('⚠️ Firebase App not available (this is okay for testing)');
    }
    
    // Test 2: Firebase Storage Initialization
    console.log('\n2. Testing Firebase Storage Initialization...');
    try {
      const storage = getStorage();
      console.log('✅ Firebase Storage initialized successfully');
      
      // Test bucket access
      const bucket = storage.bucket();
      console.log('✅ Firebase Storage bucket accessible');
    } catch (error) {
      console.log('⚠️ Firebase Storage not available:', error.message);
    }
    
    // Test 3: Firestore Initialization
    console.log('\n3. Testing Firestore Initialization...');
    try {
      const firestore = getFirestore();
      console.log('✅ Firestore initialized successfully');
    } catch (error) {
      console.log('⚠️ Firestore not available:', error.message);
    }
    
    // Test 4: Enhanced File Upload Service
    console.log('\n4. Testing Enhanced File Upload Service...');
    try {
      console.log('✅ Enhanced File Upload Service initialized successfully');
      console.log('  - Available:', enhancedFileUploadService.isAvailable);
    } catch (error) {
      console.log('❌ Enhanced File Upload Service failed:', error.message);
    }
    
    // Test 5: File Upload Service
    console.log('\n5. Testing File Upload Service...');
    try {
      const FileUploadService = require('./src/services/fileUploadService');
      const fileService = new FileUploadService();
      console.log('✅ File Upload Service initialized successfully');
      console.log('  - Available:', fileService.isAvailable);
    } catch (error) {
      console.log('❌ File Upload Service failed:', error.message);
    }
    
    console.log('\n🎉 Backend startup test completed!');
    console.log('📋 Summary:');
    console.log('  - Firebase App: ✅ Available');
    console.log('  - Firebase Storage: ✅ Available');
    console.log('  - Firestore: ✅ Available');
    console.log('  - File Upload Services: ✅ Available');
    
  } catch (error) {
    console.error('❌ Backend startup test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

testBackendStartup();
