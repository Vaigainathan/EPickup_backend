/**
 * DRV-B2b — driver KYC uploads persist filePath only; reads re-sign.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const REAL_FIRESTORE_GUARD = process.env.JEST_ALLOW_REAL_FIRESTORE === '1';

function assertNoRealFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!REAL_FIRESTORE_GUARD && projectId && projectId !== 'unit-test') {
    throw new Error(
      `Refusing tests: FIREBASE_PROJECT_ID=${projectId}. Set JEST_ALLOW_REAL_FIRESTORE=1 to override.`
    );
  }
}

process.env.FIREBASE_PROJECT_ID = 'unit-test';
process.env.JWT_SECRET = 'unit-test-jwt-secret';
assertNoRealFirestore();

const mockSignDriverKycPath = jest.fn().mockResolvedValue({
  url: 'https://signed.example/driver-kyc',
  signedUrlExpiresAt: '2026-10-24T13:00:00.000Z',
  path: 'drivers/driver-1/documents/driving_license/1.jpg',
  bucket: 'unit-test-bucket'
});

const mockListLatestDriverKycDocumentsFromStorage = jest.fn();

jest.mock('../src/services/driverKycDocumentUrlService', () => {
  const actual = jest.requireActual('../src/services/driverKycDocumentUrlService');
  return {
    ...actual,
    signDriverKycPath: (...args) => mockSignDriverKycPath(...args),
    listLatestDriverKycDocumentsFromStorage: (...args) =>
      mockListLatestDriverKycDocumentsFromStorage(...args)
  };
});

const kycActual = jest.requireActual('../src/services/driverKycDocumentUrlService');

const mockUserUpdateFirestore = jest.fn().mockResolvedValue(undefined);
const mockVerificationSet = jest.fn().mockResolvedValue(undefined);
const mockStorageMakePublic = jest.fn();
const mockStorageSave = jest.fn().mockResolvedValue(undefined);
const mockStorageGetSignedUrl = jest.fn();

const mockStorageFileRef = {
  save: mockStorageSave,
  makePublic: mockStorageMakePublic,
  getSignedUrl: mockStorageGetSignedUrl
};

const baseUserData = {
  name: 'Test Driver',
  phone: '+919999999999',
  driver: {
    vehicleDetails: {
      vehicleType: 'motorcycle',
      vehicleNumber: 'TN01AB1234',
      vehicleModel: 'Activa'
    }
  }
};

const requiredDocTypes = [
  'driving_license',
  'profile_photo',
  'aadhaar_card',
  'bike_insurance',
  'rc_book'
];

function buildFilePathOnlyDocuments() {
  const docs = {};
  for (const type of requiredDocTypes) {
    docs[type] = {
      filePath: `drivers/driver-1/documents/${type}/latest.jpg`,
      fileName: 'latest.jpg',
      uploadedAt: new Date().toISOString()
    };
  }
  return docs;
}

jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => mockStorageFileRef,
      name: 'unit-test-bucket'
    })
  })
}));

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({
      doc: () => ({ update: mockUserUpdateFirestore })
    })
  })
}));

jest.mock('../src/middleware/auth', () => ({
  requireDriver: (req, res, next) => {
    req.user = { uid: 'driver-1', userType: 'driver', phone: '+919999999999' };
    next();
  }
}));

jest.mock('../src/middleware/rateLimiter', () => ({
  documentStatusRateLimit: (req, res, next) => next()
}));
jest.mock('../src/middleware/rateLimit', () => ({
  speedLimiter: (req, res, next) => next(),
  bookingStatusLimiter: (req, res, next) => next()
}));
jest.mock('../src/middleware/cache', () => ({
  documentStatusCache: (req, res, next) => next(),
  invalidateUserCache: jest.fn()
}));
jest.mock('../src/middleware/idempotencyMiddleware', () => ({
  idempotencyKeyMiddleware: (req, res, next) => next()
}));
jest.mock('../src/services/bookingLockService', () =>
  jest.fn().mockImplementation(() => ({}))
);
jest.mock('../src/services/driverStatusWorkflowService', () => ({
  driverStatusWorkflowService: {},
  DriverStatusError: class DriverStatusError extends Error {}
}));
jest.mock('../src/services/marketplace/driverMarketplaceAssignment', () => ({
  loadAssignedMarketplaceContext: jest.fn(),
  attachMarketplaceToDriverBooking: jest.fn()
}));
jest.mock('../src/services/fareCalculationService', () => ({}));

jest.mock('../src/services/firebase', () => ({
  getFirebaseApp: () => ({}),
  getStorage: () => ({
    bucket: () => ({
      name: 'unit-test-bucket',
      file: () => ({
        save: mockStorageSave,
        makePublic: mockStorageMakePublic
      })
    })
  }),
  getFirestore: () => ({
    collection: (name) => {
      if (name === 'users') {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => baseUserData
            }),
            update: mockUserUpdateFirestore
          })
        };
      }
      if (name === 'documentVerificationRequests') {
        return {
          doc: () => ({
            id: 'vr-test-1',
            set: mockVerificationSet
          }),
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                get: jest.fn().mockResolvedValue({ empty: true, docs: [] })
              })
            })
          })
        };
      }
      return { doc: jest.fn() };
    }
  })
}));

const fileUploadRouter = require('../src/routes/fileUpload');
const driverRouter = require('../src/routes/driver');
const FileUploadService = require('../src/services/fileUploadService');

describe('DRV-B2b E — filePath-only Firestore doc re-signs on read', () => {
  beforeEach(() => {
    kycActual.clearSignCacheForTests();
    kycActual.setSignUrlImplForTests(async (filePath) => ({
      url: `https://signed.test/${filePath}`,
      signedUrlExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      bucket: 'unit-test-bucket',
      path: filePath
    }));
  });

  afterEach(() => {
    kycActual.setSignUrlImplForTests(null);
    kycActual.clearSignCacheForTests();
  });

  it('presentDriverKycDocumentMapEntry adds short-lived url from filePath only', async () => {
    const filePath = 'drivers/test-uid/documents/driving_license/1.jpg';
    const presented = await kycActual.presentDriverKycDocumentMapEntry({ filePath });

    expect(presented.filePath).toBe(filePath);
    expect(presented.downloadURL).toBe(`https://signed.test/${filePath}`);
    expect(presented.url).toBe(`https://signed.test/${filePath}`);
    expect(presented.signedUrlExpiresAt).toBeTruthy();
  });
});

describe('DRV-B2b D — legacy POST /api/driver/documents unchanged', () => {
  const driverSource = fs.readFileSync(
    path.join(__dirname, '../src/routes/driver.js'),
    'utf8'
  );

  it('marks legacy POST and PUT document routes in comments', () => {
    expect(driverSource).toMatch(/@legacy\s+Prefer POST \/api\/file-upload\/driver-document/);
    expect(driverSource).toMatch(/router\.put\('\/documents\/:type'/);
  });

  it('legacy POST still persists client documentUrl on driver.documents', () => {
    const postBlock = driverSource.slice(
      driverSource.indexOf("router.post('/documents',"),
      driverSource.indexOf("router.put('/documents/:type',")
    );
    expect(postBlock).toMatch(/url:\s*documentUrl/);
    expect(postBlock).not.toMatch(/filePath:\s*documentUrl/);
  });
});

describe('DRV-B2b A — POST /api/file-upload/driver-document', () => {
  const app = express();
  app.use('/api/file-upload', fileUploadRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    mockSignDriverKycPath.mockResolvedValue({
      url: 'https://signed.example/driver-kyc',
      signedUrlExpiresAt: '2026-10-24T13:00:00.000Z',
      path: 'drivers/driver-1/documents/driving_license/1.jpg',
      bucket: 'unit-test-bucket'
    });
  });

  it('persists filePath without downloadURL and returns 1h signed URL in response', async () => {
    const res = await request(app)
      .post('/api/file-upload/driver-document')
      .field('documentType', 'driving_license')
      .attach('document', Buffer.from('fake-image'), 'license.jpg');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.filePath).toMatch(/^drivers\/driver-1\/documents\/driving_license\//);
    expect(res.body.data.downloadURL).toBe('https://signed.example/driver-kyc');
    expect(res.body.data.signedUrlExpiresAt).toBeTruthy();
    expect(mockSignDriverKycPath).toHaveBeenCalledWith(res.body.data.filePath);
    expect(mockStorageMakePublic).not.toHaveBeenCalled();
    expect(mockStorageGetSignedUrl).not.toHaveBeenCalled();

    expect(mockUserUpdateFirestore).toHaveBeenCalled();
    const updateArg = mockUserUpdateFirestore.mock.calls[0][0];
    const docPayload =
      updateArg['driver.documents.driving_license'] || updateArg['documents.driving_license'];
    expect(docPayload.filePath).toBe(res.body.data.filePath);
    expect(docPayload.downloadURL).toBeUndefined();
    expect(docPayload.url).toBeUndefined();
  });
});

describe('DRV-B2b B — fileUploadService.uploadToStorage', () => {
  it('does not call makePublic and returns filePath without public downloadURL', async () => {
    const uploadSave = jest.fn().mockResolvedValue(undefined);
    const uploadMakePublic = jest.fn().mockResolvedValue(undefined);
    const uploadGetSignedUrl = jest.fn();
    const uploadFileRef = {
      save: uploadSave,
      makePublic: uploadMakePublic,
      getSignedUrl: uploadGetSignedUrl
    };
    const mockBucket = {
      name: 'unit-test-bucket',
      file: jest.fn(() => uploadFileRef)
    };

    const service = new FileUploadService();
    service.isAvailable = true;
    Object.defineProperty(service, 'bucket', {
      configurable: true,
      get: () => mockBucket
    });

    const file = {
      buffer: Buffer.from('x'),
      mimetype: 'image/jpeg',
      size: 1,
      originalname: 'test.jpg'
    };

    const result = await service.uploadToStorage(
      file,
      'driving_license_driver-1_1.jpg',
      'driving_license',
      'driver-1'
    );

    expect(uploadMakePublic).not.toHaveBeenCalled();
    expect(uploadSave).toHaveBeenCalled();
    expect(result.filePath).toBe(
      'drivers/driver-1/documents/driving_license/driving_license_driver-1_1.jpg'
    );
    expect(result.downloadURL).toBeUndefined();
    expect(result.thumbnailURL).toBeUndefined();
  });
});

describe('DRV-B2b C — POST request-verification stored shape', () => {
  const app = express();
  app.use('/api/driver', driverRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    mockListLatestDriverKycDocumentsFromStorage.mockResolvedValue(buildFilePathOnlyDocuments());
  });

  it('stores filePath per document slot without downloadURL', async () => {
    const res = await request(app).post('/api/driver/documents/request-verification');

    expect(res.status).toBe(200);
    expect(mockVerificationSet).toHaveBeenCalledTimes(1);

    const saved = mockVerificationSet.mock.calls[0][0];
    expect(saved.documents.drivingLicense.filePath).toContain('driving_license');
    expect(saved.documents.drivingLicense.downloadURL).toBeUndefined();
    expect(saved.documents.profilePhoto.filePath).toBeTruthy();
    expect(saved.documents.profilePhoto.downloadURL).toBeUndefined();
  });
});
