const cron = require('node-cron');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore, getStorage } = require('./firebase');
const { appendEvent } = require('./marketplace/orderEvents');
const { readMp17Settings } = require('./marketplace/jobSettings');
const {
  maskUpiId,
  shouldDeleteUnattachedEvidence,
  shouldExpireHelpEvidence,
  shouldExpirePaymentEvidence,
  shouldMaskRefundUpi,
  OPEN_TICKET_STATUSES
} = require('./marketplace/cleanupJobDecisions');
const {
  orderMatchesStagingTestPair,
  recordStagingSkip,
  refundMatchesStagingTestPair,
  ticketMatchesStagingTestPair
} = require('./marketplace/mp17StagingPair');

const SETTINGS_DOC = ['appSettings', 'marketplace'];
const REPORT_DOC = 'paymentReport';
const JOB_ACTOR = { type: 'system', id: 'cleanup-job' };
const BATCH_LIMIT = 50;
const REFUND_SCAN_STATUSES = ['refunded', 'refund_pending'];

class MarketplaceCleanupJob {
  constructor() {
    this.task = null;
    this.ticking = false;
  }

  start() {
    if (this.task) {
      return;
    }
    this.task = cron.schedule('30 3 * * *', () => {
      this.runTick().catch((error) => {
        console.error('❌ [MARKETPLACE_CLEANUP] Tick failed:', error.message);
      });
    }, { timezone: 'Asia/Kolkata' });
    console.log('✅ [MARKETPLACE_CLEANUP] Cron scheduled (daily 03:30 IST)');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  async runTick(options = {}) {
    if (this.ticking) {
      return { skipped: true, reason: 'overlap', counts: {} };
    }
    this.ticking = true;
    try {
      return await this.executeTick(options);
    } finally {
      this.ticking = false;
    }
  }

  async executeTick(options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const db = getFirestore();
    const settingsSnap = await db.collection(SETTINGS_DOC[0]).doc(SETTINGS_DOC[1]).get();
    const settings = readMp17Settings(settingsSnap.exists ? settingsSnap.data() : null);
    const dryRun = Boolean(options.dryRun);
    const skippedNotTestPair = [];
    const counts = {
      unattachedDeleted: 0,
      paymentEvidenceExpired: 0,
      helpEvidenceExpired: 0,
      refundUpiMasked: 0
    };

    counts.unattachedDeleted += await this.cleanupUnattached(
      db, nowMs, settings.unattachedMaxAgeMs, dryRun, options, skippedNotTestPair
    );
    counts.paymentEvidenceExpired += await this.cleanupPaymentEvidence(
      db, nowMs, settings.evidenceRetentionMs, dryRun, options, skippedNotTestPair
    );
    counts.helpEvidenceExpired += await this.cleanupHelpEvidence(
      db, nowMs, settings.evidenceRetentionMs, dryRun, options, skippedNotTestPair
    );
    counts.refundUpiMasked += await this.maskRefundUpi(
      db, nowMs, settings.evidenceRetentionMs, dryRun, options, skippedNotTestPair
    );

    console.log('ℹ️ [MARKETPLACE_CLEANUP] Tick complete', { dryRun, counts });
    const result = { skipped: false, dryRun, nowMs, counts };
    if (options.reportStagingSkips === true) {
      result.skippedNotTestPair = skippedNotTestPair;
    }
    return result;
  }

  stagingPairFor(options) {
    return options.stagingPair || (options.only && options.only.customerId && options.only.shopId ? options.only : null);
  }

  skipForStaging(orderData, options, skippedNotTestPair, entry) {
    const pair = this.stagingPairFor(options);
    if (!pair) {
      return false;
    }
    if (orderMatchesStagingTestPair(orderData, pair)) {
      return false;
    }
    if (options.stagingApplyLock === true || options.reportStagingSkips === true) {
      recordStagingSkip(skippedNotTestPair, entry);
      return true;
    }
    return false;
  }

  async cleanupUnattached(db, nowMs, maxAgeMs, dryRun, options, skippedNotTestPair) {
    const snap = await db.collection('evidenceUploads')
      .where('attached', '==', false)
      .limit(BATCH_LIMIT)
      .get();
    let deleted = 0;
    for (const doc of snap.docs) {
      const row = doc.data() || {};
      if (!shouldDeleteUnattachedEvidence(row, nowMs, maxAgeMs)) {
        continue;
      }
      const orderData = await this.loadOrderData(db, row.orderId);
      if (this.skipForStaging(orderData, options, skippedNotTestPair, {
        kind: 'unattached_evidence',
        evidenceId: doc.id,
        orderId: row.orderId || null
      })) {
        continue;
      }
      if (dryRun) {
        deleted += 1;
        continue;
      }
      await this.deleteEvidenceFile(row.path);
      await doc.ref.delete();
      deleted += 1;
    }
    return deleted;
  }

  async cleanupPaymentEvidence(db, nowMs, retentionMs, dryRun, options, skippedNotTestPair) {
    const snap = await db.collection('evidenceUploads')
      .where('purpose', '==', 'payment')
      .where('attached', '==', true)
      .limit(BATCH_LIMIT)
      .get();
    let expired = 0;
    for (const doc of snap.docs) {
      const row = doc.data() || {};
      const orderId = row.orderId;
      if (!orderId) {
        continue;
      }
      const orderData = await this.loadOrderData(db, orderId);
      if (!orderData) {
        continue;
      }
      const review = orderData.payment && orderData.payment.review;
      if (review && review.status === 'open') {
        continue;
      }
      if (!shouldExpirePaymentEvidence(orderData, nowMs, retentionMs)) {
        continue;
      }
      if (this.skipForStaging(orderData, options, skippedNotTestPair, {
        kind: 'payment_evidence',
        evidenceId: doc.id,
        orderId
      })) {
        continue;
      }
      if (dryRun) {
        expired += 1;
        continue;
      }
      const removed = await this.removePaymentEvidence(db, orderId, doc.id, orderData.customerId);
      if (removed) {
        expired += 1;
      }
    }
    return expired;
  }

  async cleanupHelpEvidence(db, nowMs, retentionMs, dryRun, options, skippedNotTestPair) {
    const snap = await db.collection('evidenceUploads')
      .where('purpose', '==', 'help')
      .where('attached', '==', true)
      .limit(BATCH_LIMIT)
      .get();
    let expired = 0;
    for (const doc of snap.docs) {
      const row = doc.data() || {};
      const ticketId = row.ticketId;
      if (!ticketId) {
        continue;
      }
      const ticketSnap = await db.collection('supportTickets').doc(ticketId).get();
      if (!ticketSnap.exists) {
        continue;
      }
      const ticket = ticketSnap.data() || {};
      if (OPEN_TICKET_STATUSES.has(ticket.status)) {
        continue;
      }
      if (!shouldExpireHelpEvidence(ticket, nowMs, retentionMs)) {
        continue;
      }
      const orderData = ticket.orderId ? await this.loadOrderData(db, ticket.orderId) : null;
      const pair = this.stagingPairFor(options);
      const matches = orderData
        ? orderMatchesStagingTestPair(orderData, pair)
        : ticketMatchesStagingTestPair(ticket, pair);
      if ((options.stagingApplyLock || options.reportStagingSkips) && pair && !matches) {
        recordStagingSkip(skippedNotTestPair, {
          kind: 'help_evidence',
          evidenceId: doc.id,
          ticketId,
          orderId: ticket.orderId || null
        });
        continue;
      }
      if (dryRun) {
        expired += 1;
        continue;
      }
      const removed = await this.removeHelpEvidence(db, ticketId, doc.id, row);
      if (removed) {
        expired += 1;
      }
    }
    return expired;
  }

  async maskRefundUpi(db, nowMs, retentionMs, dryRun, options, skippedNotTestPair) {
    const snap = await db.collection('marketplaceOrders')
      .where('payment.status', 'in', REFUND_SCAN_STATUSES)
      .limit(BATCH_LIMIT)
      .get();
    let masked = 0;
    const pair = this.stagingPairFor(options);
    for (const orderDoc of snap.docs) {
      const orderData = orderDoc.data() || {};
      if (orderData.hasOpenRefund === true) {
        continue;
      }
      const refundSnap = await orderDoc.ref.collection('refunds').get();
      for (const refundDoc of refundSnap.docs) {
        const refund = refundDoc.data() || {};
        if (!shouldMaskRefundUpi(refund, nowMs, retentionMs)) {
          continue;
        }
        if ((options.stagingApplyLock || options.reportStagingSkips) && pair
          && !refundMatchesStagingTestPair(refund, orderData, pair)) {
          recordStagingSkip(skippedNotTestPair, {
            kind: 'refund_upi',
            orderId: orderDoc.id,
            refundId: refundDoc.id
          });
          continue;
        }
        if (dryRun) {
          masked += 1;
          continue;
        }
        const nextUpi = maskUpiId(refund.customerUpiId);
        await db.runTransaction(async (tx) => {
          const freshRefund = await tx.get(refundDoc.ref);
          if (!freshRefund.exists) {
            return;
          }
          const live = freshRefund.data() || {};
          if (!shouldMaskRefundUpi(live, nowMs, retentionMs)) {
            return;
          }
          tx.update(refundDoc.ref, {
            customerUpiId: nextUpi,
            updatedAt: FieldValue.serverTimestamp()
          });
          if (live.customerId && typeof live.customerUpiId === 'string') {
            const userRef = db.collection('users').doc(live.customerId);
            const userSnap = await tx.get(userRef);
            if (userSnap.exists) {
              const profileUpi = userSnap.data()
                && userSnap.data().customer
                && userSnap.data().customer.marketplace
                && userSnap.data().customer.marketplace.refundUpiId;
              if (profileUpi === live.customerUpiId) {
                tx.update(userRef, { 'customer.marketplace.refundUpiId': nextUpi });
              }
            }
          }
        });
        masked += 1;
      }
    }
    return masked;
  }

  async loadOrderData(db, orderId) {
    if (!orderId) {
      return null;
    }
    const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
    return orderSnap.exists ? (orderSnap.data() || {}) : null;
  }

  async removePaymentEvidence(db, orderId, evidenceId, customerId) {
    const orderRef = db.collection('marketplaceOrders').doc(orderId);
    const reportRef = orderRef.collection('private').doc(REPORT_DOC);
    const evidenceRef = db.collection('evidenceUploads').doc(evidenceId);
    let path = null;
    let cleared = false;
    await db.runTransaction(async (tx) => {
      const evidenceSnap = await tx.get(evidenceRef);
      if (!evidenceSnap.exists) {
        return;
      }
      const row = evidenceSnap.data() || {};
      path = row.path || null;
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) {
        return;
      }
      const orderData = orderSnap.data() || {};
      const review = orderData.payment && orderData.payment.review;
      if (review && review.status === 'open') {
        return;
      }
      const reportSnap = await tx.get(reportRef);
      const report = reportSnap.exists ? (reportSnap.data() || {}) : {};
      const ids = Array.isArray(report.evidenceIds) ? report.evidenceIds.filter((id) => id !== evidenceId) : [];
      const count = Number(report.evidenceCount);
      tx.set(reportRef, {
        note: typeof report.note === 'string' ? report.note : null,
        evidenceIds: ids,
        evidenceCount: Math.max(0, (Number.isFinite(count) ? count : ids.length) - 1),
        submittedAt: report.submittedAt || null
      });
      tx.delete(evidenceRef);
      appendEvent(tx, orderRef, {
        type: 'evidence_deleted',
        actor: JOB_ACTOR,
        data: { evidenceId, purpose: 'payment' }
      }, customerId || orderData.customerId);
      cleared = true;
    });
    if (cleared && path) {
      await this.deleteEvidenceFile(path);
    }
    return cleared;
  }

  async removeHelpEvidence(db, ticketId, evidenceId, row) {
    const ticketRef = db.collection('supportTickets').doc(ticketId);
    const evidenceRef = db.collection('evidenceUploads').doc(evidenceId);
    const path = row && row.path;
    let cleared = false;
    await db.runTransaction(async (tx) => {
      const ticketSnap = await tx.get(ticketRef);
      if (!ticketSnap.exists) {
        return;
      }
      const ticket = ticketSnap.data() || {};
      if (OPEN_TICKET_STATUSES.has(ticket.status)) {
        return;
      }
      const evidenceSnap = await tx.get(evidenceRef);
      if (!evidenceSnap.exists) {
        return;
      }
      const ids = Array.isArray(ticket.evidenceIds)
        ? ticket.evidenceIds.filter((id) => id !== evidenceId)
        : [];
      tx.update(ticketRef, { evidenceIds: ids, updatedAt: FieldValue.serverTimestamp() });
      tx.delete(evidenceRef);
      if (ticket.orderId && ticket.customerId) {
        const orderRef = db.collection('marketplaceOrders').doc(ticket.orderId);
        appendEvent(tx, orderRef, {
          type: 'evidence_deleted',
          actor: JOB_ACTOR,
          data: { evidenceId, purpose: 'help', ticketId }
        }, ticket.customerId);
      }
      cleared = true;
    });
    if (cleared && path) {
      await this.deleteEvidenceFile(path);
    }
    return cleared;
  }

  async deleteEvidenceFile(storagePath) {
    if (typeof storagePath !== 'string' || storagePath.trim() === '') {
      return true;
    }
    try {
      await getStorage().bucket().file(storagePath).delete({ ignoreNotFound: true });
      return true;
    } catch (error) {
      const code = error && (error.code || error.statusCode);
      const message = String(error.message || '').toLowerCase();
      if (code === 404 || message.includes('not found') || message.includes('no such object')) {
        return true;
      }
      console.error('❌ [MARKETPLACE_CLEANUP] Storage delete failed', error.message);
      return false;
    }
  }
}

const marketplaceCleanupJob = new MarketplaceCleanupJob();
module.exports = marketplaceCleanupJob;
