const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getFirestore, getStorage } = require('../firebase');
const { isValidUtr } = require('../../validators/marketplace');
const { presentCustomerOrder } = require('./customerOrderView');
const { appendEvent } = require('./orderEvents');
const { isWithinUtrWindow, acceptHoursFrom } = require('./customerOrderActions');
const displayIdService = require('../displayIdService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EVIDENCE = 3;
const MAX_NOTE = 300;
const REPORT_DOC = 'paymentReport';

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function requireUuid(idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey.trim())) {
    throw httpError(400, 'VALIDATION', 'Idempotency-Key must be a UUID');
  }
  return idempotencyKey.trim();
}

function millisOf(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function imageExt(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'jpg';
  }
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'png';
  }
  return null;
}

function contentTypeFor(ext) {
  return ext === 'png' ? 'image/png' : 'image/jpeg';
}

function ownedOrder(snapshot, customerId) {
  if (!snapshot.exists) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const data = snapshot.data() || {};
  if (data.customerId !== customerId) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  return data;
}

function reviewOpen(data) {
  const review = data.payment && data.payment.review;
  return data.orderStatus === 'payment_review' && Boolean(review && review.status === 'open');
}

function evidenceAllowed(data) {
  return data.orderStatus === 'payment_unconfirmed' || reviewOpen(data);
}

function reportOf(snap) {
  if (!snap || !snap.exists) {
    return { note: null, evidenceIds: [], evidenceCount: 0, submittedAt: null };
  }
  const data = snap.data() || {};
  const count = Number(data.evidenceCount);
  return {
    note: typeof data.note === 'string' ? data.note : null,
    evidenceIds: Array.isArray(data.evidenceIds) ? data.evidenceIds.filter((id) => typeof id === 'string') : [],
    evidenceCount: Number.isFinite(count) && count > 0 ? count : 0,
    submittedAt: data.submittedAt || null
  };
}

function orderResponse(status, data, orderId) {
  return {
    status,
    body: {
      success: true,
      data: {
        order: presentCustomerOrder({ ...data, id: orderId })
      }
    }
  };
}

async function notifyCustomer(customerId, template, variables) {
  if (!customerId) {
    return;
  }
  try {
    const notificationService = require('../notificationService');
    const result = await notificationService.sendTemplateNotification(customerId, 'MARKETPLACE', template, variables);
    if (result && result.success === false) {
      console.error(`❌ [MARKETPLACE_ORDER] push ${template} failed`, result.error || result);
    }
  } catch (error) {
    console.error(`❌ [MARKETPLACE_ORDER] push ${template} failed`, error);
  }
}

async function notifyShop(shopId, template, variables) {
  if (!shopId) {
    return;
  }
  try {
    const notificationService = require('../notificationService');
    const result = await notificationService.sendTemplateNotification(shopId, 'MARKETPLACE', template, variables);
    if (result && result.success === false) {
      console.error(`❌ [MARKETPLACE_ORDER] push ${template} failed`, result.error || result);
    }
  } catch (error) {
    console.error(`❌ [MARKETPLACE_ORDER] push ${template} failed`, error);
  }
}

function displayLabel(data) {
  return displayIdService.formatDisplayId(data.displayId);
}

async function saveEvidenceObject(storagePath, buffer, ext, orderId, evidenceId) {
  const fileRef = getStorage().bucket().file(storagePath);
  await fileRef.save(buffer, {
    metadata: {
      contentType: contentTypeFor(ext),
      metadata: {
        orderId,
        evidenceId,
        purpose: 'payment'
      }
    }
  });
}

async function rollbackEvidence(db, orderRef, evidenceRef) {
  const reportRef = orderRef.collection('private').doc(REPORT_DOC);
  await db.runTransaction(async (tx) => {
    const reportSnap = await tx.get(reportRef);
    const evidenceSnap = await tx.get(evidenceRef);
    if (evidenceSnap.exists) {
      tx.delete(evidenceRef);
    }
    if (reportSnap.exists) {
      const current = reportOf(reportSnap);
      tx.set(reportRef, {
        note: current.note,
        evidenceIds: current.evidenceIds,
        evidenceCount: Math.max(0, current.evidenceCount - 1),
        submittedAt: current.submittedAt
      });
    }
  });
}

async function uploadPaymentEvidence({ customerId, orderId, idempotencyKey, file }) {
  const key = requireUuid(idempotencyKey);
  const buffer = file && file.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_BYTES) {
    throw httpError(400, 'FILE_INVALID', 'File must be a jpg or png of 5MB or smaller');
  }
  const ext = imageExt(buffer);
  if (!ext) {
    throw httpError(400, 'FILE_INVALID', 'File must be a jpg or png');
  }

  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const reportRef = orderRef.collection('private').doc(REPORT_DOC);
  const evidenceId = crypto.randomBytes(16).toString('hex');
  const evidenceRef = db.collection('evidenceUploads').doc(evidenceId);
  const storagePath = `marketplaceOrders/${orderId}/evidence/${evidenceId}.${ext}`;

  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const data = ownedOrder(orderSnap, customerId);
    if (!evidenceAllowed(data)) {
      throw httpError(409, 'INVALID_STATE', 'Evidence is not available for this order');
    }
    const reportSnap = await tx.get(reportRef);
    const existingSnap = await tx.get(db.collection('evidenceUploads').where('orderId', '==', orderId));
    const replay = existingSnap.docs.find((doc) => {
      const row = doc.data() || {};
      return row.idempotencyKey === key && row.customerId === customerId;
    });
    if (replay) {
      return { replay: true, evidenceId: replay.id };
    }
    const current = reportOf(reportSnap);
    if (current.evidenceCount >= MAX_EVIDENCE) {
      throw httpError(409, 'LIMIT_REACHED', 'This order already has 3 evidence files');
    }
    const at = Timestamp.now();
    tx.set(evidenceRef, {
      orderId,
      customerId,
      path: storagePath,
      purpose: 'payment',
      createdAt: at,
      attached: false,
      idempotencyKey: key
    });
    tx.set(reportRef, {
      note: current.note,
      evidenceIds: current.evidenceIds,
      evidenceCount: current.evidenceCount + 1,
      submittedAt: current.submittedAt
    });
    return { replay: false, evidenceId, storagePath, ext };
  });

  if (outcome.replay) {
    return { evidenceId: outcome.evidenceId, replay: true };
  }

  try {
    await saveEvidenceObject(outcome.storagePath, buffer, outcome.ext, orderId, outcome.evidenceId);
  } catch {
    await rollbackEvidence(db, orderRef, evidenceRef);
    console.error('❌ [MARKETPLACE_ORDER] evidence upload failed');
    throw httpError(500, 'INTERNAL_ERROR', 'Failed to store the image');
  }
  return { evidenceId: outcome.evidenceId, replay: false };
}

function parseNote(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'note') || body.note == null) {
    return { provided: false, note: null };
  }
  if (typeof body.note !== 'string') {
    throw httpError(400, 'VALIDATION', 'Note must be 300 characters or fewer');
  }
  const note = body.note.trim();
  if (note.length > MAX_NOTE) {
    throw httpError(400, 'VALIDATION', 'Note must be 300 characters or fewer');
  }
  return { provided: true, note };
}

function parseEvidenceIds(body) {
  if (!body || body.evidenceIds == null) {
    return null;
  }
  if (!Array.isArray(body.evidenceIds)) {
    throw httpError(400, 'EVIDENCE_INVALID', 'evidenceIds must be ids from this order');
  }
  const ids = [];
  body.evidenceIds.forEach((id) => {
    if (typeof id !== 'string' || !id.trim()) {
      throw httpError(400, 'EVIDENCE_INVALID', 'evidenceIds must be ids from this order');
    }
    const trimmed = id.trim();
    if (!ids.includes(trimmed)) {
      ids.push(trimmed);
    }
  });
  return ids;
}

async function submitPaymentReport({ customerId, orderId, idempotencyKey, body, nowMs }) {
  requireUuid(idempotencyKey);
  const utr = body && body.utr;
  if (!isValidUtr(utr)) {
    throw httpError(400, 'INVALID_UTR', 'UTR must be exactly 12 digits');
  }
  const noteInput = parseNote(body);
  const requestedIds = parseEvidenceIds(body);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const reportRef = orderRef.collection('private').doc(REPORT_DOC);
  const registryRef = db.collection('utrRegistry').doc(String(utr));

  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const data = ownedOrder(orderSnap, customerId);
    const payment = data.payment || {};
    const storedUtr = payment.customerUtr || null;
    if (storedUtr && storedUtr !== utr) {
      throw httpError(409, 'ALREADY_SUBMITTED', 'A UTR was already submitted for this order');
    }
    const open = reviewOpen(data);
    if (!open && data.orderStatus !== 'payment_unconfirmed') {
      throw httpError(409, 'INVALID_STATE', 'This order cannot take a payment report');
    }

    const reportSnap = await tx.get(reportRef);
    const current = reportOf(reportSnap);
    const mergedIds = requestedIds == null
      ? current.evidenceIds.slice()
      : current.evidenceIds.concat(requestedIds.filter((id) => !current.evidenceIds.includes(id)));
    if (mergedIds.length > MAX_EVIDENCE) {
      throw httpError(409, 'LIMIT_REACHED', 'A payment report can include at most 3 evidence files');
    }

    const evidenceSnaps = [];
    for (const id of mergedIds) {
      evidenceSnaps.push(await tx.get(db.collection('evidenceUploads').doc(id)));
    }
    mergedIds.forEach((id, index) => {
      const snap = evidenceSnaps[index];
      const row = snap.exists ? (snap.data() || {}) : null;
      if (!row || row.orderId !== orderId || row.customerId !== customerId || row.purpose !== 'payment') {
        throw httpError(400, 'EVIDENCE_INVALID', 'evidenceIds must be ids from this order');
      }
    });

    const registrySnap = open ? null : await tx.get(registryRef);
    const settingsSnap = open ? null : await tx.get(db.collection('appSettings').doc('marketplace'));
    if (!open) {
      if (registrySnap.exists) {
        const registry = registrySnap.data() || {};
        if (registry.orderId !== orderId) {
          throw httpError(409, 'UTR_USED', 'This UTR is already used');
        }
      }
      const startMs = millisOf(data.window && data.window.start);
      const hours = acceptHoursFrom(settingsSnap.exists ? settingsSnap.data() : null);
      if (!isWithinUtrWindow(startMs, now, hours)) {
        throw httpError(409, 'UTR_WINDOW_CLOSED', 'The UTR window is closed');
      }
    }

    const shopRef = db.collection('shops').doc(data.shopId);
    const shopSnap = open ? null : await tx.get(shopRef);
    const at = Timestamp.fromMillis(now);
    const note = noteInput.provided ? noteInput.note : current.note;
    tx.set(reportRef, {
      note,
      evidenceIds: mergedIds,
      evidenceCount: current.evidenceCount,
      submittedAt: FieldValue.serverTimestamp()
    });
    evidenceSnaps.forEach((snap) => {
      if (snap.exists && (snap.data() || {}).attached !== true) {
        tx.update(snap.ref, { attached: true });
      }
    });

    if (open) {
      return {
        openedReview: false,
        data,
        shopId: data.shopId
      };
    }

    const nextPayment = {
      ...payment,
      customerUtr: utr,
      utrSubmittedAt: payment.utrSubmittedAt || at,
      status: 'under_review',
      review: {
        status: 'open',
        openedAt: FieldValue.serverTimestamp(),
        trigger: 'customer_report',
        shopResponse: null,
        outcome: null
      }
    };
    tx.update(orderRef, {
      orderStatus: 'payment_review',
      'payment.customerUtr': utr,
      'payment.status': 'under_review',
      'payment.utrSubmittedAt': nextPayment.utrSubmittedAt,
      'payment.review': nextPayment.review,
      updatedAt: at
    });
    if (!registrySnap.exists) {
      tx.set(registryRef, {
        orderId,
        customerId,
        kind: 'customer',
        at
      });
      appendEvent(tx, orderRef, {
        type: 'utr_submitted',
        actor: { type: 'customer', id: customerId },
        data: { utr }
      }, data.customerId);
    }
    if (shopSnap && shopSnap.exists) {
      const stats = shopSnap.data().marketplaceStats || {};
      const opened = Number(stats.reviewsOpened);
      tx.update(shopRef, {
        'marketplaceStats.reviewsOpened': (Number.isFinite(opened) ? opened : 0) + 1
      });
    }
    appendEvent(tx, orderRef, {
      type: 'review_opened',
      actor: { type: 'customer', id: customerId },
      data: { trigger: 'customer_report' }
    }, data.customerId);
    const snapshot = data.shopSnapshot && typeof data.shopSnapshot === 'object' ? data.shopSnapshot : {};
    return {
      openedReview: true,
      data: { ...data, orderStatus: 'payment_review', payment: nextPayment, updatedAt: at },
      shopId: data.shopId,
      displayId: displayLabel(data),
      orderId,
      shopName: typeof snapshot.name === 'string' ? snapshot.name : ''
    };
  });

  if (outcome.openedReview) {
    const variables = {
      displayId: outcome.displayId,
      orderId: outcome.orderId,
      shopName: outcome.shopName
    };
    await notifyCustomer(customerId, 'PAYMENT_UNDER_REVIEW', variables);
    await notifyShop(outcome.shopId, 'PAYMENT_REVIEW_SHOP', variables);
  }
  return orderResponse(200, outcome.data, orderId);
}

async function downloadOrderEvidence(db, orderId, destDir) {
  const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
  if (!orderSnap.exists) {
    return { exists: false, note: null, evidenceCount: 0, files: [] };
  }
  const reportSnap = await db.collection('marketplaceOrders').doc(orderId).collection('private').doc(REPORT_DOC).get();
  const report = reportOf(reportSnap);
  const snap = await db.collection('evidenceUploads').where('orderId', '==', orderId).get();
  await fs.mkdir(destDir, { recursive: true });
  const files = [];
  for (const doc of snap.docs) {
    const row = doc.data() || {};
    const storagePath = typeof row.path === 'string' ? row.path : '';
    const ext = storagePath.endsWith('.png') ? 'png' : 'jpg';
    const name = `${doc.id}.${ext}`;
    if (storagePath) {
      await getStorage().bucket().file(storagePath).download({
        destination: path.join(destDir, name)
      });
    }
    files.push(name);
  }
  files.sort();
  return {
    exists: true,
    note: report.note,
    evidenceCount: report.evidenceCount,
    files
  };
}

module.exports = {
  MAX_BYTES,
  imageExt,
  contentTypeFor,
  uploadPaymentEvidence,
  submitPaymentReport,
  downloadOrderEvidence
};
