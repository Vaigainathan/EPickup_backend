const REQUIRED_DRIVER_DOCUMENT_TYPES = [
  'drivingLicense',
  'aadhaarCard',
  'bikeInsurance',
  'rcBook',
  'profilePhoto'
];

const SUPPORT_SCRIPT_ID = 'support-script:approve-test-driver';
const VERIFY_COMMENTS = 'DRV-TEST-SETUP support script';

const USAGE = 'Usage: node scripts/support/approve-test-driver.js --driver <uid> [--points <n>] [--apply]';

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  const next = argv[index + 1];
  if (!next || next.startsWith('--')) {
    return '';
  }
  return next;
}

function parseApproveTestDriverArgv(argv = process.argv) {
  const driverId = argValue(argv, '--driver');
  const pointsRaw = argValue(argv, '--points');
  const apply = argv.includes('--apply');
  let points = null;
  if (pointsRaw !== '') {
    points = Number(pointsRaw);
  }
  return {
    driverId,
    pointsRaw,
    points,
    apply
  };
}

function validateApproveTestDriverArgv(parsed) {
  if (!parsed.driverId) {
    return { ok: false, message: USAGE };
  }
  if (parsed.pointsRaw !== '' && (!Number.isFinite(parsed.points) || parsed.points < 0)) {
    return {
      ok: false,
      message: 'Refusing to run: --points must be a finite number greater than or equal to 0.'
    };
  }
  return { ok: true };
}

function assertDriverUser(userData) {
  if (!userData || userData.userType !== 'driver') {
    return {
      ok: false,
      message: 'Refusing to run: user is not userType driver.'
    };
  }
  return { ok: true };
}

function documentStorageKey(docType) {
  return docType.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function resolveDriverDocument(documents, docType) {
  const docs = documents && typeof documents === 'object' ? documents : {};
  const camelKey = docType;
  const snakeKey = documentStorageKey(docType);
  if (docs[camelKey]) {
    return { key: camelKey, doc: docs[camelKey] };
  }
  if (docs[snakeKey]) {
    return { key: snakeKey, doc: docs[snakeKey] };
  }
  return { key: null, doc: null };
}

function isDriverDocumentPresent(doc) {
  if (!doc || typeof doc !== 'object') {
    return false;
  }
  const hasFilePath = typeof doc.filePath === 'string' && doc.filePath.trim() !== '';
  const url = doc.url || doc.downloadURL;
  const hasUrl = typeof url === 'string' && url.trim() !== '';
  const isVerified = doc.verified === true
    || doc.status === 'verified'
    || doc.verificationStatus === 'verified'
    || doc.verificationStatus === 'approved';
  return hasFilePath || hasUrl || isVerified;
}

function isDriverDocumentVerified(doc) {
  if (!doc || typeof doc !== 'object') {
    return false;
  }
  return doc.verified === true
    || doc.status === 'verified'
    || doc.verificationStatus === 'verified'
    || doc.verificationStatus === 'approved';
}

function summarizeDocument(docType, documents) {
  const { key, doc } = resolveDriverDocument(documents, docType);
  const present = isDriverDocumentPresent(doc);
  const verified = isDriverDocumentVerified(doc);
  return {
    documentType: docType,
    storageKey: key,
    present,
    verified
  };
}

function planDocumentVerifications(documents) {
  return REQUIRED_DRIVER_DOCUMENT_TYPES
    .map((docType) => {
      const summary = summarizeDocument(docType, documents);
      if (!summary.present || summary.verified) {
        return null;
      }
      return {
        documentType: docType,
        adminDocumentType: docType,
        status: 'verified'
      };
    })
    .filter(Boolean);
}

function planDriverApproval(userData) {
  const driver = userData.driver && typeof userData.driver === 'object' ? userData.driver : {};
  const documents = driver.documents || {};
  const documentSummaries = REQUIRED_DRIVER_DOCUMENT_TYPES.map((docType) => summarizeDocument(docType, documents));
  const documentsToVerify = planDocumentVerifications(documents);
  const verificationStatus = typeof driver.verificationStatus === 'string'
    ? driver.verificationStatus
    : 'pending';
  const alreadyApproved = verificationStatus === 'approved';
  const approvalNoop = alreadyApproved && documentsToVerify.length === 0;

  return {
    documentSummaries,
    documentsToVerify,
    verificationStatus,
    alreadyApproved,
    approvalNoop
  };
}

function planWalletTopUp(walletData, targetPoints) {
  if (targetPoints == null) {
    return { requested: false, noop: true };
  }
  const walletExists = Boolean(walletData && walletData.exists);
  const currentBalance = walletExists
    ? Number(walletData.pointsBalance || 0)
    : null;
  const noop = walletExists && currentBalance === targetPoints;
  return {
    requested: true,
    walletExists,
    currentBalance,
    targetBalance: targetPoints,
    noop,
    delta: walletExists && currentBalance != null ? targetPoints - currentBalance : null
  };
}

function buildApprovalPreview({
  driverId,
  apply,
  userData,
  walletSnapshot,
  points
}) {
  const driverCheck = assertDriverUser(userData);
  if (!driverCheck.ok) {
    return { ok: false, message: driverCheck.message };
  }

  const approval = planDriverApproval(userData);
  const wallet = planWalletTopUp(walletSnapshot, points);

  const before = {
    verificationStatus: approval.verificationStatus,
    documents: approval.documentSummaries,
    wallet: wallet.requested
      ? {
        exists: wallet.walletExists,
        pointsBalance: wallet.currentBalance
      }
      : null
  };

  const after = {
    verificationStatus: approval.approvalNoop && !wallet.requested
      ? approval.verificationStatus
      : 'approved',
    documents: approval.documentSummaries.map((row) => ({
      documentType: row.documentType,
      present: row.present,
      verified: row.present ? true : row.verified
    })),
    wallet: wallet.requested
      ? {
        exists: true,
        pointsBalance: wallet.targetBalance
      }
      : null
  };

  return {
    ok: true,
    driverId,
    apply,
    dryRun: !apply,
    before,
    after,
    actions: {
      verifyDocuments: approval.documentsToVerify,
      approveDriver: !approval.approvalNoop,
      walletTopUp: wallet.requested && !wallet.noop
    },
    noop: approval.approvalNoop && (!wallet.requested || wallet.noop)
  };
}

module.exports = {
  REQUIRED_DRIVER_DOCUMENT_TYPES,
  SUPPORT_SCRIPT_ID,
  VERIFY_COMMENTS,
  USAGE,
  argValue,
  parseApproveTestDriverArgv,
  validateApproveTestDriverArgv,
  assertDriverUser,
  resolveDriverDocument,
  isDriverDocumentPresent,
  isDriverDocumentVerified,
  planDocumentVerifications,
  planDriverApproval,
  planWalletTopUp,
  buildApprovalPreview
};
