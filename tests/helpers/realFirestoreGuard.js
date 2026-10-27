const admin = require('firebase-admin');

/**
 * Fail fast if tests initialize real Firebase Admin against a live project.
 * Call at the top of a suite after jest.mock('../src/services/firebase', ...).
 */
function installRealFirestoreGuard(getFirestoreMock) {
  beforeAll(() => {
    if (!getFirestoreMock || typeof getFirestoreMock.mock !== 'object') {
      throw new Error('REAL FIRESTORE guard: pass the jest mock for getFirestore');
    }
    if (admin.apps.length > 0 && getFirestoreMock.mock.calls.length === 0) {
      throw new Error(
        'REAL FIRESTORE guard: firebase-admin is initialized but getFirestore was not mocked'
      );
    }
  });

  afterEach(() => {
    if (admin.apps.length > 0 && getFirestoreMock.mock.results.length === 0) {
      throw new Error('REAL FIRESTORE guard: getFirestore mock was never invoked');
    }
  });
}

module.exports = {
  installRealFirestoreGuard
};
