const admin = require('firebase-admin');
const FileUploadService = require('../src/services/fileUploadService');
const path = require('path');
const fs = require('fs');

// Initialize Firebase Admin (if not already initialized)
if (!admin.apps.length) {
  const serviceAccount = require('../firebase-service-account.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'epickup-app.appspot.com'
  });
}

const fileUploadService = new FileUploadService();

// Test data
const testDriverId = 'test_driver_001';
const testAdminId = 'test_admin_001';

// Mock file objects for testing
const createMockFile = (filename, mimetype, size, buffer) => ({
  fieldname: 'document',
  originalname: filename,
  encoding: '7bit',
  mimetype: mimetype,
  size: size,
  buffer: buffer || Buffer.from('mock file content'),
  destination: '',
  filename: filename,
  path: ''
});

// Test functions
async function testFileValidation() {
  console.log('\n🧪 Testing File Validation...');
  
  try {
    // Test valid file
    const validFile = createMockFile('test.jpg', 'image/jpeg', 1024 * 1024);
    const validation = fileUploadService.validateFile(validFile, 'driving_license');
    
    console.log('✅ Valid file validation:', validation.isValid);
    if (validation.warnings.length > 0) {
      console.log('⚠️  Warnings:', validation.warnings);
    }
    
    // Test invalid file type
    const invalidTypeFile = createMockFile('test.txt', 'text/plain', 1024);
    const invalidTypeValidation = fileUploadService.validateFile(invalidTypeFile, 'driving_license');
    
    console.log('❌ Invalid file type validation:', !invalidTypeValidation.isValid);
    console.log('   Errors:', invalidTypeValidation.errors);
    
    // Test oversized file
    const oversizedFile = createMockFile('large.jpg', 'image/jpeg', 10 * 1024 * 1024);
    const oversizedValidation = fileUploadService.validateFile(oversizedFile, 'driving_license');
    
    console.log('❌ Oversized file validation:', !oversizedValidation.isValid);
    console.log('   Errors:', oversizedValidation.errors);
    
    // Test empty file
    const emptyFile = createMockFile('empty.jpg', 'image/jpeg', 0);
    const emptyValidation = fileUploadService.validateFile(emptyFile, 'driving_license');
    
    console.log('❌ Empty file validation:', !emptyValidation.isValid);
    console.log('   Errors:', emptyValidation.errors);
    
    return true;
  } catch (error) {
    console.error('❌ File validation test failed:', error.message);
    return false;
  }
}

async function testImageProcessing() {
  console.log('\n🖼️  Testing Image Processing...');
  
  try {
    // Create a mock image buffer (simulating a real image)
    const mockImageBuffer = Buffer.from('mock image data for testing');
    const mockFile = createMockFile('test_image.jpg', 'image/jpeg', mockImageBuffer.length, mockImageBuffer);
    
    const docConfig = fileUploadService.documentTypes.driving_license;
    
    // Test image processing
    const result = await fileUploadService.processImage(mockFile, docConfig);
    
    console.log('✅ Image processing completed');
    console.log('   Original size:', mockFile.size);
    console.log('   Processed size:', result.file.size);
    console.log('   Thumbnail created:', !!result.thumbnailPath);
    
    return true;
  } catch (error) {
    console.error('❌ Image processing test failed:', error.message);
    return false;
  }
}

async function testDocumentUpload() {
  console.log('\n📤 Testing Document Upload...');
  
  try {
    const mockFile = createMockFile('driving_license.jpg', 'image/jpeg', 1024 * 1024);
    
    const result = await fileUploadService.uploadDocument(
      mockFile,
      'driving_license',
      testDriverId,
      {
        originalName: 'driving_license.jpg',
        uploadedBy: testDriverId,
        ipAddress: '127.0.0.1',
        userAgent: 'Test Agent'
      }
    );
    
    console.log('✅ Document upload completed');
    console.log('   Document ID:', result.data.documentId);
    console.log('   Status:', result.data.status);
    console.log('   Upload URL:', result.data.uploadUrl);
    
    return result.data.documentId;
  } catch (error) {
    console.error('❌ Document upload test failed:', error.message);
    return null;
  }
}

async function testGetDriverDocuments(documentId) {
  console.log('\n📋 Testing Get Driver Documents...');
  
  try {
    // Get all documents for driver
    const allDocuments = await fileUploadService.getDriverDocuments(testDriverId);
    console.log('✅ Retrieved all documents:', allDocuments.length);
    
    // Get specific document type
    const drivingLicenseDocs = await fileUploadService.getDriverDocuments(testDriverId, 'driving_license');
    console.log('✅ Retrieved driving license documents:', drivingLicenseDocs.length);
    
    // Verify document exists
    const documentExists = allDocuments.some(doc => doc.id === documentId);
    console.log('✅ Uploaded document found:', documentExists);
    
    return true;
  } catch (error) {
    console.error('❌ Get driver documents test failed:', error.message);
    return false;
  }
}

async function testDocumentVerification(documentId) {
  console.log('\n✅ Testing Document Verification...');
  
  try {
    // Test document approval
    const approvalResult = await fileUploadService.verifyDocument(
      documentId,
      testAdminId,
      'approved',
      'Document looks good and meets all requirements',
      null
    );
    
    console.log('✅ Document approval completed');
    console.log('   Status:', approvalResult.data.status);
    console.log('   Verified by:', approvalResult.data.verifiedBy);
    
    // Test document rejection
    const rejectionResult = await fileUploadService.verifyDocument(
      documentId,
      testAdminId,
      'rejected',
      'Document is unclear and needs to be re-uploaded',
      'Image quality is too low to verify details'
    );
    
    console.log('✅ Document rejection completed');
    console.log('   Status:', rejectionResult.data.status);
    console.log('   Rejection reason:', rejectionResult.data.rejectionReason);
    
    return true;
  } catch (error) {
    console.error('❌ Document verification test failed:', error.message);
    return false;
  }
}

async function testDocumentStatistics() {
  console.log('\n📊 Testing Document Statistics...');
  
  try {
    const stats = await fileUploadService.getDocumentStatistics();
    
    console.log('✅ Document statistics retrieved');
    console.log('   Total documents:', stats.total);
    console.log('   By status:', stats.byStatus);
    console.log('   By document type:', stats.byDocumentType);
    console.log('   By verification status:', stats.byVerificationStatus);
    console.log('   Average size:', (stats.averageSize / 1024 / 1024).toFixed(2) + ' MB');
    
    return true;
  } catch (error) {
    console.error('❌ Document statistics test failed:', error.message);
    return false;
  }
}

async function testVerificationQueue() {
  console.log('\n⏳ Testing Verification Queue...');
  
  try {
    const queue = await fileUploadService.getVerificationQueue({}, 10, 0);
    
    console.log('✅ Verification queue retrieved');
    console.log('   Total pending:', queue.pagination.total);
    console.log('   Documents in current page:', queue.documents.length);
    console.log('   Has more pages:', queue.pagination.hasMore);
    
    return true;
  } catch (error) {
    console.error('❌ Verification queue test failed:', error.message);
    return false;
  }
}

async function testSignedUrlGeneration(documentId) {
  console.log('\n🔗 Testing Signed URL Generation...');
  
  try {
    // First get the document to get file path
    const documents = await fileUploadService.getDriverDocuments(testDriverId);
    const document = documents.find(doc => doc.id === documentId);
    
    if (!document) {
      console.log('⚠️  No document found for signed URL test');
      return false;
    }
    
    const signedUrl = await fileUploadService.generateSignedUrl(
      document.uploadDetails.filePath,
      3600 // 1 hour
    );
    
    console.log('✅ Signed URL generated');
    console.log('   URL length:', signedUrl.length);
    console.log('   Expires in: 1 hour');
    
    return true;
  } catch (error) {
    console.error('❌ Signed URL generation test failed:', error.message);
    return false;
  }
}

async function testDocumentCleanup() {
  console.log('\n🧹 Testing Document Cleanup...');
  
  try {
    const result = await fileUploadService.cleanupExpiredDocuments(1); // 1 day
    
    console.log('✅ Document cleanup completed');
    console.log('   Deleted count:', result.data.deletedCount);
    console.log('   Total found:', result.data.totalFound);
    
    return true;
  } catch (error) {
    console.error('❌ Document cleanup test failed:', error.message);
    return false;
  }
}

async function testDocumentDeletion(documentId) {
  console.log('\n🗑️  Testing Document Deletion...');
  
  try {
    const result = await fileUploadService.deleteDocument(documentId, testAdminId);
    
    console.log('✅ Document deletion completed');
    console.log('   Deleted document ID:', result.data.documentId);
    console.log('   Deleted by:', result.data.deletedBy);
    
    return true;
  } catch (error) {
    console.error('❌ Document deletion test failed:', error.message);
    return false;
  }
}

async function testDriverVerificationStatus() {
  console.log('\n👤 Testing Driver Verification Status...');
  
  try {
    // Check if driver verification status was updated
    const driverRef = admin.firestore().collection('users').doc(testDriverId);
    const driverDoc = await driverRef.get();
    
    if (driverDoc.exists) {
      const driverData = driverDoc.data();
      console.log('✅ Driver verification status check completed');
      console.log('   Current status:', driverData.driver?.verificationStatus || 'unknown');
      console.log('   Verified at:', driverData.driver?.verifiedAt || 'not verified');
    } else {
      console.log('⚠️  Driver document not found');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Driver verification status test failed:', error.message);
    return false;
  }
}

async function createTestData() {
  console.log('\n🔧 Creating Test Data...');
  
  try {
    // Create test driver user
    const driverRef = admin.firestore().collection('users').doc(testDriverId);
    await driverRef.set({
      id: testDriverId,
      name: 'Test Driver',
      phone: '+919999999999',
      userType: 'driver',
      driver: {
        verificationStatus: 'pending',
        documents: {
          driving_license: { status: 'pending' },
          aadhaar_card: { status: 'pending' },
          bike_insurance: { status: 'pending' },
          rc_book: { status: 'pending' },
          profile_photo: { status: 'pending' }
        }
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    // Create test admin user
    const adminRef = admin.firestore().collection('users').doc(testAdminId);
    await adminRef.set({
      id: testAdminId,
      name: 'Test Admin',
      phone: '+918888888888',
      userType: 'admin',
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    console.log('✅ Test data created successfully');
    return true;
  } catch (error) {
    console.error('❌ Test data creation failed:', error.message);
    return false;
  }
}

async function cleanupTestData() {
  console.log('\n🧹 Cleaning Up Test Data...');
  
  try {
    // Delete test driver
    const driverRef = admin.firestore().collection('users').doc(testDriverId);
    await driverRef.delete();
    
    // Delete test admin
    const adminRef = admin.firestore().collection('users').doc(testAdminId);
    await adminRef.delete();
    
    // Delete test documents
    const documents = await fileUploadService.getDriverDocuments(testDriverId);
    for (const doc of documents) {
      try {
        await fileUploadService.deleteDocument(doc.id, testAdminId);
      } catch (error) {
        console.log('⚠️  Could not delete document:', doc.id);
      }
    }
    
    console.log('✅ Test data cleaned up successfully');
    return true;
  } catch (error) {
    console.error('❌ Test data cleanup failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting File Upload Service Tests...\n');
  
  const results = {
    fileValidation: false,
    imageProcessing: false,
    documentUpload: false,
    getDocuments: false,
    verification: false,
    statistics: false,
    verificationQueue: false,
    signedUrl: false,
    cleanup: false,
    deletion: false,
    driverStatus: false
  };
  
  try {
    // Create test data
    const testDataCreated = await createTestData();
    if (!testDataCreated) {
      console.log('❌ Cannot proceed without test data');
      return;
    }
    
    // Run tests
    results.fileValidation = await testFileValidation();
    results.imageProcessing = await testImageProcessing();
    
    const documentId = await testDocumentUpload();
    if (documentId) {
      results.documentUpload = true;
      
      results.getDocuments = await testGetDriverDocuments(documentId);
      results.verification = await testDocumentVerification(documentId);
      results.signedUrl = await testSignedUrlGeneration(documentId);
      results.deletion = await testDocumentDeletion(documentId);
    }
    
    results.statistics = await testDocumentStatistics();
    results.verificationQueue = await testVerificationQueue();
    results.cleanup = await testDocumentCleanup();
    results.driverStatus = await testDriverVerificationStatus();
    
  } catch (error) {
    console.error('❌ Test execution failed:', error.message);
  } finally {
    // Cleanup
    await cleanupTestData();
    
    // Print results
    console.log('\n📊 Test Results Summary:');
    console.log('========================');
    
    Object.entries(results).forEach(([test, passed]) => {
      const status = passed ? '✅ PASS' : '❌ FAIL';
      const testName = test.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      console.log(`${status} ${testName}`);
    });
    
    const passedTests = Object.values(results).filter(Boolean).length;
    const totalTests = Object.keys(results).length;
    const successRate = ((passedTests / totalTests) * 100).toFixed(1);
    
    console.log(`\n🎯 Overall Success Rate: ${passedTests}/${totalTests} (${successRate}%)`);
    
    if (passedTests === totalTests) {
      console.log('🎉 All tests passed! File Upload Service is working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Please review the errors above.');
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests()
    .then(() => {
      console.log('\n🏁 Test execution completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runTests,
  testFileValidation,
  testImageProcessing,
  testDocumentUpload,
  testGetDriverDocuments,
  testDocumentVerification,
  testDocumentStatistics,
  testVerificationQueue,
  testSignedUrlGeneration,
  testDocumentCleanup,
  testDocumentDeletion,
  testDriverVerificationStatus
};
