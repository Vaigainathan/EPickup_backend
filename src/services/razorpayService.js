const crypto = require('crypto');
const Razorpay = require('razorpay');
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

      // ✅ FIX: Razorpay Payment Links API requires reference_id max 40 characters
      // Create short reference: WLT_<timestamp>_<shortId>
      const timestamp = Date.now();
      const shortDriverId = driverId.substring(0, 8); // First 8 chars of driver ID
      const shortReference = `WLT_${timestamp}_${shortDriverId}`.substring(0, 40);

      const payload = {
        amount: amountInPaise,
        currency: 'INR',
        accept_partial: false,
        reference_id: shortReference,  // ✅ Now guaranteed under 40 chars
        description: `EPickup wallet top-up (${driverId})`,
        reminder_enable: false,
        notes: {
          transactionId,              // ✅ Full ID stored in notes for tracking
          shortReference,
          driverId,
          purpose: 'driver_wallet_topup'
        }
      };

      // ✅ FIX: Only add customer details if they're valid
      const validContact = this.normalizeIndianContact(mobileNumber);
      const validEmail = customerEmail && customerEmail.includes('@') ? customerEmail : undefined;
      const validName = customerName && customerName.length > 0 ? customerName : undefined;

      if (validContact || validName || validEmail) {
        payload.customer = {};
        if (validName) payload.customer.name = validName;
        if (validContact) payload.customer.contact = validContact;
        if (validEmail) payload.customer.email = validEmail;
      }

      // ✅ Only add notification settings if contact/email exist
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

  verifyWebhookSignature(body, signature) {
    try {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!secret || !signature) return false;

      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
      );
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

  async processWalletTopupPayment(transactionId, meta = {}) {
    try {
      const topupDoc = await this.findTopupByTransactionId(transactionId);
      if (!topupDoc || !topupDoc.exists) {
        return { success: false, error: 'Top-up transaction not found' };
      }

      const topup = topupDoc.data();
      if (topup.status === 'completed') {
        return {
          success: true,
          data: {
            alreadyProcessed: true,
            transactionId: topup.id || topupDoc.id,
            newBalance: topup.newPointsBalance || 0,
            pointsAwarded: topup.pointsAwarded || 0
          }
        };
      }

      const walletService = require('./walletService');
      const pointsResult = await walletService.addPoints(
        topup.driverId,
        topup.amount,
        topup.paymentMethod || 'upi',
        {
          transactionId: topup.id || topupDoc.id,
          gateway: 'razorpay',
          razorpayPaymentId: meta.razorpayPaymentId || null,
          razorpayPaymentLinkId: meta.razorpayPaymentLinkId || topup.razorpayPaymentLinkId || null
        }
      );

      if (!pointsResult.success) {
        await topupDoc.ref.update({
          status: 'failed',
          updatedAt: new Date(),
          pointsError: pointsResult.error || 'Failed to add points'
        });
        return { success: false, error: pointsResult.error || 'Failed to add points' };
      }

      await topupDoc.ref.update({
        status: 'completed',
        paymentGateway: 'razorpay',
        razorpayPaymentId: meta.razorpayPaymentId || topup.razorpayPaymentId || null,
        razorpayPaymentLinkId: meta.razorpayPaymentLinkId || topup.razorpayPaymentLinkId || null,
        completedAt: new Date(),
        updatedAt: new Date(),
        pointsAwarded: pointsResult.data.pointsAdded,
        newPointsBalance: pointsResult.data.newBalance
      });

      return {
        success: true,
        data: {
          transactionId: topup.id || topupDoc.id,
          newBalance: pointsResult.data.newBalance,
          pointsAwarded: pointsResult.data.pointsAdded
        }
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

  async handlePaymentCallback(body, signature) {
    try {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔍 [RAZORPAY_WEBHOOK_HANDLER] Processing webhook callback');
      console.log('   Event:', body?.event);
      console.log('   Has signature:', !!signature);
      console.log('   Has payload:', !!body?.payload);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const hasWebhookSecret = Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
      console.log('🔐 [RAZORPAY_WEBHOOK] Webhook secret configured:', hasWebhookSecret);
      
      if (hasWebhookSecret && !this.verifyWebhookSignature(body, signature)) {
        console.error('❌ [RAZORPAY_WEBHOOK] Invalid webhook signature');
        return { success: false, error: 'Invalid webhook signature' };
      }

      const event = body?.event;
      const paymentEntity = body?.payload?.payment?.entity || {};
      const paymentLinkEntity = body?.payload?.payment_link?.entity || {};

      console.log('📋 [RAZORPAY_WEBHOOK] Parsed entities:');
      console.log('   Payment entity keys:', Object.keys(paymentEntity));
      console.log('   Payment Link entity keys:', Object.keys(paymentLinkEntity));
      console.log('   Payment notes:', paymentEntity.notes);
      console.log('   Payment Link reference_id:', paymentLinkEntity.reference_id);

      const transactionId =
        paymentLinkEntity.reference_id ||
        paymentEntity.notes?.transactionId ||
        paymentEntity.notes?.merchantTransactionId ||
        paymentLinkEntity.notes?.transactionId;

      console.log('🔍 [RAZORPAY_WEBHOOK] Extracted transactionId:', transactionId);

      if (!transactionId) {
        console.warn('⚠️ [RAZORPAY_WEBHOOK] No transaction reference found in webhook');
        return { success: true, message: 'Webhook ignored: no transaction reference' };
      }

      if (event === 'payment_link.paid' || event === 'payment.captured') {
        console.log('✅ [RAZORPAY_WEBHOOK] Payment successful event detected:', event);
        const processed = await this.processWalletTopupPayment(transactionId, {
          razorpayPaymentId: paymentEntity.id || null,
          razorpayPaymentLinkId: paymentLinkEntity.id || null
        });

        console.log('📊 [RAZORPAY_WEBHOOK] Payment processing result:', processed);
        return processed.success
          ? { success: true, message: 'Top-up processed' }
          : { success: false, error: processed.error || 'Top-up processing failed' };
      }

      if (event === 'payment.failed' || event === 'payment_link.cancelled' || event === 'payment_link.expired') {
        console.log('❌ [RAZORPAY_WEBHOOK] Payment failed/cancelled event:', event);
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

      console.log('⊘ [RAZORPAY_WEBHOOK] Webhook ignored for event:', event);
      return { success: true, message: `Webhook ignored for event: ${event}` };
    } catch (error) {
      console.error('❌ [RAZORPAY] handlePaymentCallback failed:', {
        message: error.message,
        stack: error.stack,
        fullError: error
      });
      return { success: false, error: error.message || 'Webhook handling failed' };
    }
  }
}

module.exports = new RazorpayService();
