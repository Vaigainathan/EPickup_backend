const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

/**
 * Test Setup and Configuration
 * Provides test environment setup and utilities
 */

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.ENCRYPTION_KEY = 'test-encryption-key-for-testing-only';

// Initialize Firebase Admin for testing
let testApp = null;
let testDb = null;
let testAuth = null;

const initializeTestFirebase = () => {
  try {
    if (!testApp) {
      testApp = initializeApp({
        projectId: 'epickup-test',
        // Use Firebase emulator for testing
        databaseURL: 'http://localhost:9000'
      }, 'test-app');
      
      testDb = getFirestore(testApp);
      testAuth = getAuth(testApp);
      
      console.log('✅ Test Firebase initialized');
    }
    return { testApp, testDb, testAuth };
  } catch (error) {
    console.error('❌ Failed to initialize test Firebase:', error);
    throw error;
  }
};

// Test data factories
const createTestUser = (overrides = {}) => ({
  uid: `test-user-${Date.now()}`,
  phone: '+919876543210',
  userType: 'customer',
  name: 'Test User',
  email: 'test@example.com',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

const createTestDriver = (overrides = {}) => ({
  uid: `test-driver-${Date.now()}`,
  phone: '+919876543211',
  userType: 'driver',
  name: 'Test Driver',
  email: 'driver@example.com',
  isActive: true,
  driver: {
    licenseNumber: 'DL123456789',
    vehicleNumber: 'TN01AB1234',
    isOnline: false,
    isAvailable: false,
    currentLocation: {
      latitude: 12.9716,
      longitude: 79.1596
    }
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

const createTestBooking = (overrides = {}) => ({
  id: `test-booking-${Date.now()}`,
  customerId: `test-customer-${Date.now()}`,
  driverId: null,
  status: 'pending',
  pickup: {
    address: 'Test Pickup Address',
    coordinates: {
      latitude: 12.9716,
      longitude: 79.1596
    },
    contactName: 'Test Customer',
    contactPhone: '+919876543210'
  },
  drop: {
    address: 'Test Drop Address',
    coordinates: {
      latitude: 12.9716,
      longitude: 79.1596
    },
    contactName: 'Test Recipient',
    contactPhone: '+919876543211'
  },
  weight: 5.0,
  description: 'Test package',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

const createTestAdmin = (overrides = {}) => ({
  uid: `test-admin-${Date.now()}`,
  phone: '+919876543212',
  userType: 'admin',
  name: 'Test Admin',
  email: 'admin@example.com',
  isActive: true,
  role: 'admin',
  permissions: ['all'],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

// Test utilities
const generateTestToken = (userData) => {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    {
      userId: userData.uid,
      userType: userData.userType,
      role: userData.role || userData.userType,
      phone: userData.phone,
      email: userData.email
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

const createTestRequest = (userData = null, body = {}, params = {}, query = {}) => {
  const req = {
    body,
    params,
    query,
    headers: {},
    user: userData,
    token: userData ? {
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    } : null
  };

  if (userData) {
    req.headers.authorization = `Bearer ${generateTestToken(userData)}`;
  }

  return req;
};

const createTestResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis()
  };
  return res;
};

const createTestNext = () => jest.fn();

// Database utilities
const clearTestData = async () => {
  try {
    if (!testDb) {
      await initializeTestFirebase();
    }

    // Clear test collections
    const collections = ['users', 'bookings', 'driverLocations', 'driverAssignments', 'payments'];
    
    for (const collectionName of collections) {
      const snapshot = await testDb.collection(collectionName).get();
      const batch = testDb.batch();
      
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
    }
    
    console.log('✅ Test data cleared');
  } catch (error) {
    console.error('❌ Failed to clear test data:', error);
    throw error;
  }
};

const seedTestData = async (data = {}) => {
  try {
    if (!testDb) {
      await initializeTestFirebase();
    }

    const { users = [], drivers = [], bookings = [], admins = [] } = data;

    // Seed users
    for (const user of users) {
      await testDb.collection('users').doc(user.uid).set(user);
    }

    // Seed drivers
    for (const driver of drivers) {
      await testDb.collection('users').doc(driver.uid).set(driver);
    }

    // Seed admins
    for (const admin of admins) {
      await testDb.collection('users').doc(admin.uid).set(admin);
    }

    // Seed bookings
    for (const booking of bookings) {
      await testDb.collection('bookings').doc(booking.id).set(booking);
    }

    console.log('✅ Test data seeded');
  } catch (error) {
    console.error('❌ Failed to seed test data:', error);
    throw error;
  }
};

// Mock utilities
const mockFirebase = () => {
  const mockDoc = {
    exists: true,
    data: jest.fn(),
    id: 'mock-doc-id'
  };

  const mockCollection = {
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue(mockDoc),
      set: jest.fn().mockResolvedValue(),
      update: jest.fn().mockResolvedValue(),
      delete: jest.fn().mockResolvedValue()
    }),
    add: jest.fn().mockResolvedValue({ id: 'mock-doc-id' }),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      docs: [],
      size: 0,
      empty: true
    })
  };

  const mockDb = {
    collection: jest.fn().mockReturnValue(mockCollection),
    batch: jest.fn().mockReturnValue({
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue()
    }),
    runTransaction: jest.fn().mockImplementation(async (callback) => {
      return await callback({
        get: jest.fn().mockResolvedValue(mockDoc),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      });
    })
  };

  return { mockDb, mockDoc, mockCollection };
};

// Test assertions
const expectSuccessResponse = (res, expectedData = null) => {
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      success: true,
      ...expectedData
    })
  );
};

const expectErrorResponse = (res, statusCode, expectedError) => {
  expect(res.status).toHaveBeenCalledWith(statusCode);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      success: false,
      error: expect.objectContaining(expectedError)
    })
  );
};

const expectValidationError = (res) => {
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'VALIDATION_ERROR'
      })
    })
  );
};

// Global test setup
beforeAll(async () => {
  await initializeTestFirebase();
  await clearTestData();
});

afterAll(async () => {
  await clearTestData();
  if (testApp) {
    await testApp.delete();
  }
});

beforeEach(async () => {
  await clearTestData();
});

module.exports = {
  initializeTestFirebase,
  createTestUser,
  createTestDriver,
  createTestBooking,
  createTestAdmin,
  generateTestToken,
  createTestRequest,
  createTestResponse,
  createTestNext,
  clearTestData,
  seedTestData,
  mockFirebase,
  expectSuccessResponse,
  expectErrorResponse,
  expectValidationError,
  testDb,
  testAuth
};