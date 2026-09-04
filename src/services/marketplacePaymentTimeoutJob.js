const cron = require('node-cron');
const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');
const displayIdService = require('./displayIdService');
const shopOrderService = require('./shopOrderService');

const SETTINGS_DOC = ['appSettings', 'marketplace'];
const EXPIREABLE = new Set(['pending', 'initiated']);

class MarketplacePaymentTimeoutJob {
  constructor() {
    this.task = null;
  }

  start() {
    if (this.task) {
      console.log('ℹ️ [MARKETPLACE_TIMEOUT] Cron already scheduled');
      return;
    }
    this.task = cron.schedule('* * * * *', () => {
      this.runTick().catch((error) => {
        console.error('❌ [MARKETPLACE_TIMEOUT] Tick failed:', error.message);
      });
    });
    console.log('✅ [MARKETPLACE_TIMEOUT] Cron scheduled (every 60s)');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('ℹ️ [MARKETPLACE_TIMEOUT] Cron stopped');
    }
  }

  async readTimeoutMs() {
    const snap = await getFirestore().collection(SETTINGS_DOC[0]).doc(SETTINGS_DOC[1]).get();
    if (!snap.exists) {
      return { ok: false, reason: 'appSettings/marketplace document is missing' };
    }
    const value = snap.data() && snap.data().PAYMENT_TIMEOUT_MS;
    const timeoutMs = Number(value);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, reason: 'appSettings/marketplace.PAYMENT_TIMEOUT_MS is missing or invalid' };
    }
    return { ok: true, timeoutMs };
  }

  async expireOne(orderRef) {
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) {
        return { expired: false, reason: 'missing' };
      }
      const data = snap.data() || {};
      const paymentStatus = data.payment && data.payment.status;
      if (!EXPIREABLE.has(paymentStatus)) {
        return { expired: false, reason: 'not-expireable', paymentStatus, orderStatus: data.orderStatus };
      }
      tx.update(orderRef, {
        orderStatus: 'cancelled',
        'payment.status': 'expired',
        'payment.expiredAt': admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return {
        expired: true,
        customerId: data.customerId || null,
        displayId: data.displayId,
        paymentStatus
      };
    });
  }

  async runTick() {
    const settings = await this.readTimeoutMs();
    if (!settings.ok) {
      console.warn(`⚠️ [MARKETPLACE_TIMEOUT] Skipping tick: ${settings.reason}`);
      return { skipped: true, reason: settings.reason, expired: [], skippedOrders: [] };
    }

    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - settings.timeoutMs);
    const snapshot = await getFirestore()
      .collection('marketplaceOrders')
      .where('payment.status', 'in', ['pending', 'initiated'])
      .where('createdAt', '<', cutoff)
      .get();

    const expired = [];
    const skippedOrders = [];

    for (const doc of snapshot.docs) {
      const result = await this.expireOne(doc.ref);
      if (!result.expired) {
        skippedOrders.push({ id: doc.id, reason: result.reason, paymentStatus: result.paymentStatus });
        continue;
      }
      await shopOrderService.notifyCustomer(result.customerId, 'PAYMENT_EXPIRED', {
        displayId: displayIdService.formatDisplayId(result.displayId),
        orderId: doc.id
      });
      expired.push(doc.id);
    }

    if (expired.length || snapshot.size) {
      console.log('✅ [MARKETPLACE_TIMEOUT] Tick complete', {
        timeoutMs: settings.timeoutMs,
        matched: snapshot.size,
        expired: expired.length
      });
    }

    return {
      skipped: false,
      timeoutMs: settings.timeoutMs,
      matched: snapshot.size,
      expired,
      skippedOrders
    };
  }
}

module.exports = new MarketplacePaymentTimeoutJob();
