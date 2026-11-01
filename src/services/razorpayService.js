const crypto = require('crypto');
const Razorpay = require('razorpay');
const { v4: uuidv4 } = require('uuid');
const { getFirestore } = require('./firebase');

class RazorpayService {
  constructor() {
    this.db = getFirestore();
    this.instance = null;
  }

  isConfigured() {
    return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  }

  getInstance() {
    if (!this.isConfigured()) {
      throw new Error('Razorpay is not configured');
    }

    if (!this.instance) {
      this.instance = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });
    }

    return this.instance;
  }

  normalizeIndianContact(phoneNumber) {
    if (!phoneNumber) return undefined;
    const digits = String(phoneNumber).replace(/\D/g, '');
    if (digits.length >= 10) {
      return digits.slice(-10);
    }
    return undefined;
  }

  async createWalletTopupPayment({ transactionId, driverId, amount, mobileNumber, customerName, customerEmail }) {
    try {
      const rzp = this.getInstance();
      const amountInPaise = Math.round(Number(amount) * 100);

      const timestamp = Date.now();
      const shortDriverId = driverId.substring(0, 8);
      const shortReference = `WLT_${timestamp}_${shortDriverId}`.substring(0, 40);

      const payload = {
        amount: amountInPaise,
        currency: 'INR',
        accept_partial: false,
        reference_id: shortReference,
        description: `EPickup wallet top-up (${driverId})`,
        reminder_enable: false,
        notes: {
          transactionId,
          shortReference,
          driverId,
          purpose: 'driver_wallet_topup'
        }
      };

      const validContact = this.normalizeIndianContact(mobileNumber);
      const validEmail = customerEmail && customerEmail.includes('@') ? customerEmail : undefined;
      const validName = customerName && customerName.length > 0 ? customerName : undefined;

      if (validContact || validName || validEmail) {
        payload.customer = {};
        if (validName) payload.customer.name = validName;
        if (validContact) payload.customer.contact = validContact;
        if (validEmail) payload.customer.email = validEmail;
      }

      if (validContact || validEmail) {
        payload.notify = {
          sms: Boolean(validContact),
          email: Boolean(validEmail)
        };
      }

      const link = await rzp.paymentLink.create(payload);

      return {
        success: true,
        data: {
          paymentUrl: link.short_url,
          paymentLinkId: link.id,
          merchantTransactionId: transactionId,
          shortReference: shortReference,
          isSDK: false,
          paymentMode: 'PRODUCTION',
          isTestMode: false,
          gateway: 'razorpay'
        }
      };
    } catch (error) {
      console.error('❌ [RAZORPAY] createWalletTopupPayment failed:', error);
      return {
        success: false,
        error: error.message || 'Failed to create Razorpay payment link'
      };
    }
  }

  verifyWebhookSignature(rawBody, signature) {
    try {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!secret || !signature || rawBody == null) {
        return false;
      }

      const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
      const signatureBuffer = Buffer.from(signature, 'utf8');
      if (expectedBuffer.length !== signatureBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch (error) {
      console.error('❌ [RAZORPAY] verifyWebhookSignature error:', error.message);
      return false;
    }
  }

  async findTopupByTransactionId(transactionId) {
    const doc = await this.db.collection('driverTopUps').doc(transactionId).get();
    if (doc.exists) return doc;

    let query = await this.db.collection('driverTopUps')
      .where('id', '==', transactionId)
      .limit(1)
      .get();
    if (!query.empty) return query.docs[0];

    query = await this.db.collection('driverTopUps')
      .where('phonepeTransactionId', '==', transactionId)
      .limit(1)
      .get();
    if (!query.empty) return query.docs[0];

    query = await this.db.collection('driverTopUps')
      .where('razorpayPaymentLinkId', '==', transactionId)
      .limit(1)
      .get();
    if (!query.empty) return query.docs[0];

    return null;
  }

  async emitWalletTopUpSideEffects(driverId, {
    newPointsBalance,
    pointsAdded,
    currentBalance,
    transactionId,
    paymentMethod,
    realMoneyAmount
  }) {
    try {
      const cachingService = require('./cachingService');
      await cachingService.delete(`wallet:balance:${driverId}`, 'memory');
      await cachingService.invalidatePattern(`wallet:full:${driverId}:`, 'memory');
      await cachingService.delete(`wallet:transactions:count:${driverId}`, 'memory');
    } catch (cacheError) {
      console.warn('⚠️ [RAZORPAY] Failed to invalidate cache after top-up:', cacheError.message);
    }

    try {
      const socketService = require('./socket');
      const walletData = {
        balance: newPointsBalance,
        transactions: [{
          id: transactionId,
          type: 'credit',
          amount: pointsAdded,
          previousBalance: currentBalance,
          newBalance: newPointsBalance,
          paymentMethod,
          status: 'completed',
          createdAt: new Date().toISOString()
        }]
      };
      socketService.emitWalletUpdate(driverId, walletData);
      socketService.emitTransactionEvent(driverId, walletData.transactions[0]);
      socketService.emitRevenueUpdate({
        totalRevenue: Number(realMoneyAmount),
        driverId,
        source: 'driver_topup'
      });
    } catch (socketError) {
      console.error('❌ [RAZORPAY] Failed to emit wallet update event:', socketError.message);
    }
  }

  async completeWalletTopUpInTransaction(topupDocRef, meta = {}) {
    const outcome = await this.db.runTransaction(async (transaction) => {
      const topupSnap = await transaction.get(topupDocRef);
      if (!topupSnap.exists) {
        return { success: false, error: 'Top-up transaction not found' };
      }

      const topup = topupSnap.data();
      const topupDocId = topup.id || topupSnap.id;

      if (topup.status === 'completed') {
        return {
          success: true,
          idempotent: true,
          data: {
            alreadyProcessed: true,
            transactionId: topupDocId,
            newBalance: topup.newPointsBalance || 0,
            pointsAwarded: topup.pointsAwarded || 0
          }
        };
      }

      if (topup.status !== 'pending') {
        return { success: false, error: `Top-up status is ${topup.status}` };
      }

      const driverId = topup.driverId;
      const realMoneyAmount = Number(topup.amount);
      const paymentMethod = topup.paymentMethod || 'upi';
      const paymentDetails = {
        transactionId: topupDocId,
        gateway: 'razorpay',
        razorpayPaymentId: meta.razorpayPaymentId || null,
        razorpayPaymentLinkId: meta.razorpayPaymentLinkId || topup.razorpayPaymentLinkId || null
      };
      const pointsToAdd = realMoneyAmount;

      const walletRef = this.db.collection('driverPointsWallets').doc(driverId);
      const walletSnap = await transaction.get(walletRef);

      let currentBalance = 0;
      let currentTotalEarned = 0;
      if (walletSnap.exists) {
        const walletData = walletSnap.data();
        currentBalance = Number(walletData.pointsBalance || 0);
        currentTotalEarned = Number(walletData.totalPointsEarned || 0);
      }

      const newPointsBalance = currentBalance + pointsToAdd;
      const newTotalEarned = currentTotalEarned + pointsToAdd;
      const pointsTransactionId = uuidv4();
      const revenueId = uuidv4();
      const completedAt = new Date();

      if (!walletSnap.exists) {
        transaction.set(walletRef, {
          driverId,
          pointsBalance: newPointsBalance,
          totalPointsEarned: newTotalEarned,
          totalPointsSpent: 0,
          status: 'active',
          requiresTopUp: false,
          createdAt: completedAt,
          lastUpdated: completedAt,
          transactions: []
        });
      } else {
        transaction.update(walletRef, {
          pointsBalance: newPointsBalance,
          totalPointsEarned: newTotalEarned,
          requiresTopUp: false,
          lastUpdated: completedAt
        });
      }

      transaction.set(this.db.collection('pointsTransactions').doc(pointsTransactionId), {
        id: pointsTransactionId,
        driverId,
        type: 'credit',
        pointsAmount: pointsToAdd,
        realMoneyAmount,
        previousBalance: currentBalance,
        newBalance: newPointsBalance,
        paymentMethod,
        paymentDetails,
        status: 'completed',
        createdAt: completedAt
      });

      transaction.set(this.db.collection('companyRevenue').doc(revenueId), {
        id: revenueId,
        source: 'driver_topup',
        amount: realMoneyAmount,
        driverId,
        paymentMethod,
        paymentDetails,
        pointsAwarded: pointsToAdd,
        phonepeTransactionId: paymentDetails.transactionId || null,
        transactionId: pointsTransactionId,
        createdAt: completedAt
      });

      transaction.update(topupDocRef, {
        status: 'completed',
        paymentGateway: 'razorpay',
        razorpayPaymentId: meta.razorpayPaymentId || topup.razorpayPaymentId || null,
        razorpayPaymentLinkId: meta.razorpayPaymentLinkId || topup.razorpayPaymentLinkId || null,
        completedAt,
        updatedAt: completedAt,
        pointsAwarded: pointsToAdd,
        newPointsBalance: newPointsBalance
      });

      return {
        success: true,
        idempotent: false,
        data: {
          transactionId: topupDocId,
          newBalance: newPointsBalance,
          pointsAwarded: pointsToAdd,
          pointsTransactionId,
          driverId,
          paymentMethod,
          realMoneyAmount,
          currentBalance
        }
      };
    });

    if (outcome.success && !outcome.idempotent && outcome.data) {
      await this.emitWalletTopUpSideEffects(outcome.data.driverId, {
        newPointsBalance: outcome.data.newBalance,
        pointsAdded: outcome.data.pointsAwarded,
        currentBalance: outcome.data.currentBalance,
        transactionId: outcome.data.pointsTransactionId,
        paymentMethod: outcome.data.paymentMethod,
        realMoneyAmount: outcome.data.realMoneyAmount
      });
    }

    return outcome;
  }

  async processWalletTopupPayment(transactionId, meta = {}) {
    try {
      const topupDoc = await this.findTopupByTransactionId(transactionId);
      if (!topupDoc || !topupDoc.exists) {
        return { success: false, error: 'Top-up transaction not found' };
      }

      const result = await this.completeWalletTopUpInTransaction(topupDoc.ref, meta);
      if (!result.success) {
        if (result.error && result.error !== 'Top-up transaction not found') {
          await topupDoc.ref.update({
            status: 'failed',
            updatedAt: new Date(),
            pointsError: result.error
          }).catch(() => {});
        }
        return result;
      }

      return {
        success: true,
        data: result.data
      };
    } catch (error) {
      console.error('❌ [RAZORPAY] processWalletTopupPayment failed:', error);
      return { success: false, error: error.message || 'Top-up processing failed' };
    }
  }

  async verifyWalletTopupStatus(transactionId) {
    try {
      const topupDoc = await this.findTopupByTransactionId(transactionId);
      if (!topupDoc || !topupDoc.exists) {
        return { success: false, status: 'not_found', error: 'Transaction not found' };
      }

      const topup = topupDoc.data();
      if (topup.status === 'completed') {
        return {
          success: true,
          status: 'completed',
          data: {
            transactionId: topup.id || topupDoc.id,
            pointsAwarded: topup.pointsAwarded || 0,
            newBalance: topup.newPointsBalance || 0
          }
        };
      }

      if (!topup.razorpayPaymentLinkId) {
        return { success: true, status: 'pending', data: { transactionId: topup.id || topupDoc.id } };
      }

      const rzp = this.getInstance();
      const link = await rzp.paymentLink.fetch(topup.razorpayPaymentLinkId);

      if (link.status === 'paid') {
        const paymentResult = await this.processWalletTopupPayment(topup.id || topupDoc.id, {
          razorpayPaymentId: link.payment_id || null,
          razorpayPaymentLinkId: link.id
        });

        if (paymentResult.success) {
          return {
            success: true,
            status: 'completed',
            data: {
              transactionId: topup.id || topupDoc.id,
              pointsAwarded: paymentResult.data.pointsAwarded,
              newBalance: paymentResult.data.newBalance
            }
          };
        }

        return { success: false, status: 'failed', error: paymentResult.error || 'Top-up processing failed' };
      }

      if (link.status === 'cancelled' || link.status === 'expired') {
        await topupDoc.ref.update({
          status: 'failed',
          paymentGateway: 'razorpay',
          updatedAt: new Date()
        });
        return { success: false, status: 'failed', error: `Payment ${link.status}` };
      }

      return { success: true, status: 'pending', data: { transactionId: topup.id || topupDoc.id } };
    } catch (error) {
      console.error('❌ [RAZORPAY] verifyWalletTopupStatus failed:', error);
      return { success: false, status: 'error', error: error.message || 'Verification failed' };
    }
  }

  async handlePaymentCallback(body, _signature) {
    try {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔍 [RAZORPAY_WEBHOOK_HANDLER] Processing webhook callback');
      console.log('   Event:', body?.event);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const event = body?.event;
      const paymentEntity = body?.payload?.payment?.entity || {};
      const paymentLinkEntity = body?.payload?.payment_link?.entity || {};

      const transactionId =
        paymentEntity.notes?.transactionId ||
        paymentLinkEntity.notes?.transactionId ||
        paymentEntity.notes?.merchantTransactionId ||
        paymentLinkEntity.reference_id;

      if (!transactionId) {
        console.warn('⚠️ [RAZORPAY_WEBHOOK] No transaction reference found in webhook');
        return { success: true, message: 'Webhook ignored: no transaction reference' };
      }

      if (event === 'payment_link.paid' || event === 'payment.captured') {
        const processed = await this.processWalletTopupPayment(transactionId, {
          razorpayPaymentId: paymentEntity.id || null,
          razorpayPaymentLinkId: paymentLinkEntity.id || null
        });

        return processed.success
          ? { success: true, message: 'Top-up processed' }
          : { success: false, error: processed.error || 'Top-up processing failed' };
      }

      if (event === 'payment.failed' || event === 'payment_link.cancelled' || event === 'payment_link.expired') {
        const doc = await this.findTopupByTransactionId(transactionId);
        if (doc && doc.exists) {
          await doc.ref.update({
            status: 'failed',
            paymentGateway: 'razorpay',
            updatedAt: new Date(),
            razorpayPaymentId: paymentEntity.id || null,
            razorpayPaymentLinkId: paymentLinkEntity.id || null
          });
        }

        return { success: true, message: 'Failure webhook processed' };
      }

      return { success: true, message: `Webhook ignored for event: ${event}` };
    } catch (error) {
      console.error('❌ [RAZORPAY] handlePaymentCallback failed:', error.message);
      return { success: false, error: error.message || 'Webhook handling failed' };
    }
  }
}

module.exports = new RazorpayService();
