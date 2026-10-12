const crypto = require('crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { getFirestore } = require('../firebase');
const {
  MAX_BYTES,
  httpError,
  requireUuid,
  imageExt,
  ownedOrder,
  saveEvidenceObject
} = require('./evidenceCommon');

const MAX_EVIDENCE = 3;
const PURPOSE = 'help';

async function rollbackHelpEvidence(db, evidenceRef) {
  await db.runTransaction(async (tx) => {
    const evidenceSnap = await tx.get(evidenceRef);
    if (evidenceSnap.exists) {
      tx.delete(evidenceRef);
    }
  });
}

async function uploadHelpEvidence({ customerId, orderId, idempotencyKey, file }) {
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
  const evidenceId = crypto.randomBytes(16).toString('hex');
  const evidenceRef = db.collection('evidenceUploads').doc(evidenceId);
  const storagePath = `marketplaceOrders/${orderId}/evidence/${evidenceId}.${ext}`;

  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    ownedOrder(orderSnap, customerId);

    const existingSnap = await tx.get(db.collection('evidenceUploads').where('orderId', '==', orderId));
    const replay = existingSnap.docs.find((doc) => {
      const row = doc.data() || {};
      return row.idempotencyKey === key && row.customerId === customerId && row.purpose === PURPOSE;
    });
    if (replay) {
      return { replay: true, evidenceId: replay.id };
    }

    const helpCount = existingSnap.docs.filter((doc) => (doc.data() || {}).purpose === PURPOSE).length;
    if (helpCount >= MAX_EVIDENCE) {
      throw httpError(409, 'LIMIT_REACHED', 'This order already has 3 help evidence files');
    }

    const at = Timestamp.now();
    tx.set(evidenceRef, {
      orderId,
      customerId,
      path: storagePath,
      purpose: PURPOSE,
      createdAt: at,
      attached: false,
      idempotencyKey: key
    });
    return { replay: false, evidenceId, storagePath, ext };
  });

  if (outcome.replay) {
    return { evidenceId: outcome.evidenceId, replay: true };
  }

  try {
    await saveEvidenceObject(outcome.storagePath, buffer, outcome.ext, orderId, outcome.evidenceId, PURPOSE);
  } catch {
    await rollbackHelpEvidence(db, evidenceRef);
    console.error('❌ [MARKETPLACE_ORDER] help evidence upload failed');
    throw httpError(500, 'INTERNAL_ERROR', 'Failed to store the image');
  }
  return { evidenceId: outcome.evidenceId, replay: false };
}

module.exports = {
  MAX_EVIDENCE,
  PURPOSE,
  uploadHelpEvidence
};
