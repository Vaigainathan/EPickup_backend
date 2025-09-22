/* eslint-env jest */
/* global jest */

// Jest setup file
// This file runs before each test file

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.FIREBASE_PROJECT_ID = 'epickup-app'; // Use real project ID for tests

// Increase timeout for integration tests
if (typeof jest !== 'undefined') {
  jest.setTimeout(30000);
}

// Mock Firestore for tests
const mockFirestore = {
  collection: jest.fn(() => ({
    add: jest.fn(() => Promise.resolve({ id: 'mock-id' })),
    doc: jest.fn(() => ({
      get: jest.fn(() => Promise.resolve({ exists: false })),
      set: jest.fn(() => Promise.resolve()),
      update: jest.fn(() => Promise.resolve()),
      delete: jest.fn(() => Promise.resolve())
    })),
    where: jest.fn(() => ({
      limit: jest.fn(() => ({
        get: jest.fn(() => Promise.resolve({ size: 0, docs: [] }))
      })),
      orderBy: jest.fn(() => ({
        get: jest.fn(() => Promise.resolve({ size: 0, docs: [] }))
      })),
      get: jest.fn(() => Promise.resolve({ size: 0, docs: [] }))
    })),
    get: jest.fn(() => Promise.resolve({ size: 0, docs: [] }))
  }))
};

// Mock Firebase Admin SDK
jest.mock('../../src/services/firebase', () => ({
  getFirestore: () => mockFirestore,
  initializeFirebase: jest.fn(() => Promise.resolve())
}));

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Uncomment to suppress console.log in tests
  // log: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};
