const admin = require('firebase-admin');
const { getFirestore, getStorage } = require('./firebase');
const { encryptAccountNumber } = require('../utils/shopBankEncryption');

const UPI_VPA_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const MAX_DOC_BYTES = 5 * 1024 * 1024;
const REJECTED_SECTIONS = new Set(['business-details', 'documents', 'bank-details']);

function isAllowedDocumentType(contentType, originalName = '') {
  const mime = (contentType || '').toLowerCase();
  const name = (originalName || '').toLowerCase();
  if (mime.startsWith('image/') || mime === 'application/pdf') {
    return true;
  }
  if (/\.(jpe?g|png|webp|gif|heic|heif|pdf)$/.test(name)) {
    return true;
  }
  return false;
}

function extensionForDocument(contentType, originalName = '') {
  const mime = (contentType || '').toLowerCase();
  const name = (originalName || '').toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (mime.includes('png') || name.endsWith('.png')) {
    return 'png';
  }
  if (mime.includes('webp') || name.endsWith('.webp')) {
    return 'webp';
  }
  return 'jpg';
}

function isFilled(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasStoredDocument(documents, kind) {
  return isFilled(documents[`${kind}FilePath`]) || isFilled(documents[`${kind}Url`]);
}

function hasLocation(location) {
  if (!location) {
    return false;
  }
  const lat = location.latitude;
  const lng = location.longitude;
  return typeof lat === 'number' && Number.isFinite(lat)
    && typeof lng === 'number' && Number.isFinite(lng);
}

function inferSteps(shop, shopProfile) {
  const documents = shopProfile.documents || {};
  const bank = shopProfile.bank || {};

  const businessDetails = isFilled(shop.shopName)
    && isFilled(shop.shopType)
    && isFilled(shopProfile.address)
    && hasLocation(shopProfile.location);

  const documentsComplete = hasStoredDocument(documents, 'gst')
    && hasStoredDocument(documents, 'fssai');

  const hasAccountNumber = isFilled(bank.accountNumberEncrypted)
    || isFilled(bank.accountNumberLast4);

  const bankDetails = isFilled(bank.accountHolderName)
    && isFilled(bank.bankName)
    && hasAccountNumber
    && isFilled(bank.ifsc)
    && isFilled(bank.upiId)
    && bank.upiVerified === true;

  return {
    businessDetails,
    documents: documentsComplete,
    bankDetails
  };
}

function validateUpiVpa(upiId) {
  const normalized = typeof upiId === 'string' ? upiId.trim().toLowerCase() : '';
  return {
    normalized,
    valid: UPI_VPA_REGEX.test(normalized)
  };
}

function normalizeIfsc(ifsc) {
  return typeof ifsc === 'string' ? ifsc.trim().toUpperCase() : '';
}

function digitsOnly(value) {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

function normalizeRejectedSection(value) {
  return REJECTED_SECTIONS.has(value) ? value : null;
}

class ShopOnboardingService {
  getDb() {
    return getFirestore();
  }

  now() {
    return admin.firestore.FieldValue.serverTimestamp();
  }

  async loadShopContext(userId) {
    const db = this.getDb();
    const userRef = db.collection('users').doc(userId);
    const shopRef = db.collection('shops').doc(userId);
    const [userDoc, shopDoc] = await Promise.all([userRef.get(), shopRef.get()]);

    if (!userDoc.exists) {
      const error = new Error('User not found');
      error.status = 404;
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const userData = userDoc.data() || {};
    if (userData.userType !== 'shop') {
      const error = new Error('This resource requires shop role');
      error.status = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    return {
      userRef,
      shopRef,
      userData,
      shop: userData.shop || {},
      shopProfile: shopDoc.exists ? (shopDoc.data() || {}) : {},
      shopExists: shopDoc.exists
    };
  }

  assertEditable(shop) {
    if (shop.approvalStatus === 'approved') {
      const error = new Error('Onboarding is locked after approval');
      error.status = 403;
      error.code = 'ONBOARDING_LOCKED';
      throw error;
    }
  }

  async getStatus(userId) {
    const ctx = await this.loadShopContext(userId);
    const approvalStatus = ctx.shop.approvalStatus || 'pending';
    const rejectionReason = ctx.shop.rejectionReason ?? null;
    const rejectedSection = normalizeRejectedSection(
      ctx.shop.rejectedSection ?? ctx.shopProfile.rejectedSection
    );
    const submitted = ctx.shop.submitted === true || ctx.shopProfile.submitted === true;

    if (ctx.shop.submitted === undefined) {
      await ctx.userRef.update({ 'shop.submitted': false });
    }

    return await this.formatStatus(ctx.shop, ctx.shopProfile, {
      approvalStatus,
      rejectionReason,
      rejectedSection,
      submitted
    });
  }

  async signReadUrl(filePath) {
    const expires = Date.now() + (6 * 24 * 60 * 60 * 1000);
    const [url] = await getStorage().bucket().file(filePath).getSignedUrl({
      action: 'read',
      expires,
      version: 'v4'
    });
    return url;
  }

  async resolveDocumentUrl(filePath, fallbackUrl) {
    if (isFilled(filePath)) {
      try {
        return await this.signReadUrl(filePath);
      } catch (error) {
        console.error('❌ [SHOP_ONBOARDING] Failed to sign document URL:', error.message);
      }
    }
    if (isFilled(fallbackUrl) && /^https?:\/\//i.test(fallbackUrl)) {
      return fallbackUrl;
    }
    return null;
  }

  async formatStatus(shop, shopProfile, extras) {
    const documents = shopProfile.documents || {};
    const [gstUrl, fssaiUrl] = await Promise.all([
      this.resolveDocumentUrl(documents.gstFilePath, documents.gstUrl),
      this.resolveDocumentUrl(documents.fssaiFilePath, documents.fssaiUrl)
    ]);
    return {
      approvalStatus: extras.approvalStatus,
      rejectionReason: extras.rejectionReason,
      rejectedSection: extras.rejectedSection,
      submitted: extras.submitted,
      steps: inferSteps(shop, shopProfile),
      documents: {
        gstUrl,
        fssaiUrl,
        gstStatus: documents.gstStatus || null,
        fssaiStatus: documents.fssaiStatus || null
      }
    };
  }

  async saveBusinessDetails(userId, payload) {
    const ctx = await this.loadShopContext(userId);
    this.assertEditable(ctx.shop);

    const shopName = typeof payload.shopName === 'string' ? payload.shopName.trim() : '';
    const shopType = typeof payload.shopType === 'string' ? payload.shopType.trim() : '';
    const address = typeof payload.address === 'string' ? payload.address.trim() : '';
    const lat = Number(payload.latitude ?? payload.lat ?? payload.location?.latitude);
    const lng = Number(payload.longitude ?? payload.lng ?? payload.location?.longitude);

    if (!shopName || !shopType || !address || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      const error = new Error('shopName, shopType, address, and map pin (latitude, longitude) are required');
      error.status = 400;
      error.code = 'INVALID_BUSINESS_DETAILS';
      throw error;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      const error = new Error('Invalid map coordinates');
      error.status = 400;
      error.code = 'INVALID_LOCATION';
      throw error;
    }

    const now = this.now();
    const location = new admin.firestore.GeoPoint(lat, lng);

    const shopWrite = {
      address,
      location,
      updatedAt: now
    };
    if (!ctx.shopExists) {
      shopWrite.createdAt = now;
    }

    await Promise.all([
      ctx.userRef.update({
        'shop.shopName': shopName,
        'shop.shopType': shopType,
        updatedAt: now
      }),
      ctx.shopRef.set(shopWrite, { merge: true })
    ]);

    return this.getStatus(userId);
  }

  async uploadDocumentFile(userId, documentType, file) {
    if (!file || !file.buffer) {
      const error = new Error('No file provided');
      error.status = 400;
      error.code = 'MISSING_FILE';
      throw error;
    }

    if (file.size > MAX_DOC_BYTES) {
      const error = new Error('File must be 5MB or smaller');
      error.status = 400;
      error.code = 'FILE_TOO_LARGE';
      throw error;
    }

    const contentType = file.mimetype || 'application/octet-stream';
    if (!isAllowedDocumentType(contentType, file.originalname)) {
      const error = new Error('File must be an image or PDF');
      error.status = 400;
      error.code = 'INVALID_FILE_TYPE';
      throw error;
    }

    const ext = extensionForDocument(contentType, file.originalname);
    const timestamp = Date.now();
    const filePath = `shops/${userId}/documents/${documentType}/${timestamp}_${documentType}.${ext}`;
    const bucket = getStorage().bucket();
    const fileRef = bucket.file(filePath);
    const resolvedType = contentType.startsWith('image/') || contentType === 'application/pdf'
      ? contentType
      : (ext === 'pdf' ? 'application/pdf' : 'image/jpeg');

    await fileRef.save(file.buffer, {
      metadata: {
        contentType: resolvedType,
        customMetadata: {
          shopId: userId,
          documentType,
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'backend_proxy',
          originalFileName: file.originalname || `${documentType}.${ext}`
        }
      }
    });

    const [downloadURL] = await fileRef.getSignedUrl({
      action: 'read',
      expires: Date.now() + (6 * 24 * 60 * 60 * 1000),
      version: 'v4'
    });

    return { filePath, downloadURL };
  }

  async saveDocuments(userId, payload, files = {}) {
    const ctx = await this.loadShopContext(userId);
    this.assertEditable(ctx.shop);

    const existing = ctx.shopProfile.documents || {};
    let gstUrl = isFilled(payload.gstUrl) ? payload.gstUrl.trim() : (existing.gstUrl || '');
    let fssaiUrl = isFilled(payload.fssaiUrl) ? payload.fssaiUrl.trim() : (existing.fssaiUrl || '');
    let gstFilePath = existing.gstFilePath || '';
    let fssaiFilePath = existing.fssaiFilePath || '';
    let gstStatus = existing.gstStatus || null;
    let fssaiStatus = existing.fssaiStatus || null;

    if (files.gst) {
      const uploaded = await this.uploadDocumentFile(userId, 'gst', files.gst);
      gstFilePath = uploaded.filePath;
      gstUrl = uploaded.filePath;
      gstStatus = 'action_required';
    }
    if (files.fssai) {
      const uploaded = await this.uploadDocumentFile(userId, 'fssai', files.fssai);
      fssaiFilePath = uploaded.filePath;
      fssaiUrl = uploaded.filePath;
      fssaiStatus = 'action_required';
    }

    const uploadedSomething = Boolean(files.gst || files.fssai || isFilled(payload.gstUrl) || isFilled(payload.fssaiUrl));
    if (!uploadedSomething && !hasStoredDocument({ gstUrl, gstFilePath }, 'gst') && !hasStoredDocument({ fssaiUrl, fssaiFilePath }, 'fssai')) {
      const error = new Error('Upload a GST or FSSAI document (multipart fields gst and/or fssai)');
      error.status = 400;
      error.code = 'INVALID_DOCUMENTS';
      throw error;
    }

    let fssaiExpiryDate = existing.fssaiExpiryDate || null;
    if (payload.fssaiExpiryDate) {
      const parsed = new Date(payload.fssaiExpiryDate);
      if (Number.isNaN(parsed.getTime())) {
        const error = new Error('Invalid FSSAI expiry date');
        error.status = 400;
        error.code = 'INVALID_FSSAI_EXPIRY';
        throw error;
      }
      fssaiExpiryDate = parsed;
    }

    const now = this.now();
    const documents = {
      gstUrl: gstUrl || gstFilePath || '',
      gstFilePath: gstFilePath || null,
      gstStatus: (gstUrl || gstFilePath) ? (gstStatus || 'action_required') : null,
      fssaiUrl: fssaiUrl || fssaiFilePath || '',
      fssaiFilePath: fssaiFilePath || null,
      fssaiStatus: (fssaiUrl || fssaiFilePath) ? (fssaiStatus || 'action_required') : null,
      fssaiExpiryDate
    };

    const shopWrite = {
      documents,
      updatedAt: now
    };
    if (!ctx.shopExists) {
      shopWrite.createdAt = now;
    }

    await ctx.shopRef.set(shopWrite, { merge: true });
    return this.getStatus(userId);
  }

  async verifyUpi(userId, upiId) {
    const ctx = await this.loadShopContext(userId);
    this.assertEditable(ctx.shop);

    const { normalized, valid } = validateUpiVpa(upiId);
    if (!valid) {
      const error = new Error('Invalid UPI ID format');
      error.status = 400;
      error.code = 'INVALID_UPI_ID';
      throw error;
    }

    const now = this.now();

    await ctx.shopRef.set({
      bank: {
        ...(ctx.shopProfile.bank || {}),
        upiId: normalized,
        upiVerified: true,
        upiVerifiedAt: now
      },
      updatedAt: now,
      ...(ctx.shopExists ? {} : { createdAt: now })
    }, { merge: true });

    return {
      upiId: normalized,
      upiVerified: true
    };
  }

  async saveBankDetails(userId, payload) {
    const ctx = await this.loadShopContext(userId);
    this.assertEditable(ctx.shop);

    const accountHolderName = typeof payload.accountHolderName === 'string' ? payload.accountHolderName.trim() : '';
    const bankName = typeof payload.bankName === 'string' ? payload.bankName.trim() : '';
    const ifsc = normalizeIfsc(payload.ifsc);
    const accountNumber = digitsOnly(payload.accountNumber);
    const { normalized: upiId, valid: upiValid } = validateUpiVpa(payload.upiId);

    if (!accountHolderName || !bankName || !ifsc || !accountNumber || !upiId) {
      const error = new Error('accountHolderName, bankName, accountNumber, ifsc, and upiId are required');
      error.status = 400;
      error.code = 'INVALID_BANK_DETAILS';
      throw error;
    }

    if (!IFSC_REGEX.test(ifsc)) {
      const error = new Error('Invalid IFSC code');
      error.status = 400;
      error.code = 'INVALID_IFSC';
      throw error;
    }

    if (accountNumber.length < 8 || accountNumber.length > 18) {
      const error = new Error('Invalid account number');
      error.status = 400;
      error.code = 'INVALID_ACCOUNT_NUMBER';
      throw error;
    }

    if (!upiValid) {
      const error = new Error('Invalid UPI ID format');
      error.status = 400;
      error.code = 'INVALID_UPI_ID';
      throw error;
    }

    const existingBank = ctx.shopProfile.bank || {};
    const upiVerified = existingBank.upiVerified === true && existingBank.upiId === upiId;
    if (!upiVerified) {
      const error = new Error('UPI ID must be verified before saving bank details');
      error.status = 400;
      error.code = 'UPI_NOT_VERIFIED';
      throw error;
    }

    let accountNumberEncrypted;
    try {
      accountNumberEncrypted = encryptAccountNumber(accountNumber);
    } catch (encryptError) {
      const error = new Error(encryptError.message || 'Failed to encrypt account number');
      error.status = 500;
      error.code = 'ENCRYPTION_ERROR';
      throw error;
    }

    const now = this.now();
    const bank = {
      accountHolderName,
      bankName,
      accountNumberEncrypted,
      accountNumberLast4: accountNumber.slice(-4),
      ifsc,
      upiId,
      upiVerified: true,
      upiVerifiedAt: existingBank.upiVerifiedAt || now
    };

    await ctx.shopRef.set({
      bank,
      updatedAt: now,
      ...(ctx.shopExists ? {} : { createdAt: now })
    }, { merge: true });

    return this.getStatus(userId);
  }

  async submit(userId) {
    const ctx = await this.loadShopContext(userId);
    this.assertEditable(ctx.shop);

    const steps = inferSteps(ctx.shop, ctx.shopProfile);
    if (!steps.businessDetails || !steps.documents || !steps.bankDetails) {
      const error = new Error('All onboarding steps must be complete before submit');
      error.status = 400;
      error.code = 'ONBOARDING_INCOMPLETE';
      error.steps = steps;
      throw error;
    }

    const now = this.now();
    await Promise.all([
      ctx.userRef.update({
        'shop.submitted': true,
        'shop.approvalStatus': 'pending',
        'shop.rejectionReason': null,
        'shop.rejectedSection': null,
        updatedAt: now
      }),
      ctx.shopRef.set({
        submitted: true,
        rejectedSection: null,
        updatedAt: now,
        ...(ctx.shopExists ? {} : { createdAt: now })
      }, { merge: true })
    ]);

    return this.getStatus(userId);
  }
}

module.exports = new ShopOnboardingService();
module.exports.inferSteps = inferSteps;
module.exports.validateUpiVpa = validateUpiVpa;
module.exports.isFilled = isFilled;
module.exports.hasLocation = hasLocation;
