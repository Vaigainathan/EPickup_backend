const crypto = require('crypto');
const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');
const displayIdService = require('./displayIdService');
const { isPoolEnabled, allocateOrderNumber } = require('./orderNumberPool');
const notificationService = require('./notificationService');
const { NotificationTemplateProcessor } = require('./notificationTemplates');
const { appendEvent } = require('./marketplace/orderEvents');
const { fareFieldsFromCalculation } = require('./fareQuoteService');
const { deductStock, restoreLines, cancelRestoresStock } = require('./marketplace/stock');
const { toPaise, fromPaise } = require('../validators/marketplace');
const {
  resolveEnforcement,
  readUnpaidRelease,
  writeUnpaidRelease,
  confirmShopPayment,
  reportAmountDiffers,
  reportPaymentNotFound,
  resolvePaymentReview,
  answerPaidCheck,
  shopCancelAllowed
} = require('./marketplace/shopPaymentVerification');
const {
  OPEN_STATUSES,
  createRefund,
  listShopRefunds,
  loadRefundDocs,
  presentShopRefund,
  refundRemainder
} = require('./marketplace/refunds');

const COLLECTION = 'marketplaceOrders';
const PAST_PICKUP_BOOKING = new Set([
  'photo_captured',
  'picked_up',
  'in_transit',
  'at_dropoff',
  'delivered',
  'money_collection',
  'completed'
]);
const SUPPORT_READY_STAGES = new Set(['searching', 'assigned', 'at_shop']);
const DISPLAY_ID_ATTEMPTS = 8;

const ORDER_STATUSES = new Set([
  'awaiting_payment',
  'preparing',
  'ready',
  'handed_over',
  'completed',
  'cancelled'
]);

const CONFIRMABLE_PAYMENT = new Set(['pending', 'initiated', 'customer_claimed']);
const BLOCKED_CONFIRM_PAYMENT = new Set(['expired', 'cancelled', 'refund_pending', 'refunded']);
const CONFIRMED_OR_REFUND = new Set(['confirmed', 'refund_pending', 'refunded']);
const POST_CONFIRM_ORDER = new Set(['preparing', 'ready', 'handed_over', 'completed']);

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function alreadyProcessed(order) {
  return { alreadyProcessed: true, order };
}

function stockShortOpen(items) {
  return (Array.isArray(items) ? items : []).some((line) => (
    typeof line.stockDeducted === 'number'
    && line.stockDeducted < Number(line.qty)
    && line.unavailable !== true
  ));
}

function receivedPaiseOf(data) {
  const payment = (data && data.payment) || {};
  if (payment.receivedAmountPaise != null && Number.isFinite(Number(payment.receivedAmountPaise))) {
    return Number(payment.receivedAmountPaise);
  }
  if (payment.receivedAmount != null) {
    return toPaise(payment.receivedAmount);
  }
  return 0;
}

function sumRefundPaise(docs) {
  return (docs || []).reduce((sum, doc) => {
    const amount = (doc.data() || {}).amount;
    if (amount == null) {
      return sum;
    }
    return sum + toPaise(amount);
  }, 0);
}

function lineRefundPaise(line) {
  const qty = Number(line && line.qty);
  const count = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0;
  return toPaise(line.price) * count;
}

function pushVariables(data, orderId) {
  const snapshot = data.shopSnapshot && typeof data.shopSnapshot === 'object' ? data.shopSnapshot : {};
  return {
    displayId: displayIdService.formatDisplayId(data.displayId),
    orderId,
    shopName: typeof snapshot.name === 'string' ? snapshot.name : ''
  };
}

function presentLocation(location) {
  if (!location) {
    return null;
  }
  const lat = location.latitude ?? location._latitude;
  const lng = location.longitude ?? location._longitude;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lng !== 'number' || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function presentDriverInfo(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const name = typeof raw.name === 'string' ? raw.name : '';
  const phone = typeof raw.phone === 'string' ? raw.phone : '';
  const vehicle = typeof raw.vehicle === 'string'
    ? raw.vehicle
    : (typeof raw.vehicleNumber === 'string' ? raw.vehicleNumber : '');
  if (!name && !phone && !vehicle) {
    return null;
  }
  return { name, phone, vehicle };
}

function marketplaceBookingFareFields(fareDetails, distanceKm) {
  return fareFieldsFromCalculation(fareDetails, distanceKm);
}

function riderInstructions(orderData) {
  const text = typeof orderData.riderNoteText === 'string' ? orderData.riderNoteText.trim() : '';
  if (text) {
    return text;
  }
  const notes = typeof orderData.riderNotes === 'string' ? orderData.riderNotes.trim() : '';
  return notes || '';
}

function presentDelivery(delivery) {
  const source = delivery && typeof delivery === 'object' ? delivery : {};
  return {
    stage: typeof source.stage === 'string' ? source.stage : null,
    fare: typeof source.fare === 'number' ? source.fare : null
  };
}

function toLatLng(location) {
  const presented = presentLocation(location);
  if (!presented) {
    return null;
  }
  return {
    lat: presented.lat,
    lng: presented.lng,
    latitude: presented.lat,
    longitude: presented.lng
  };
}

function generateHandoverOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function otpFromValue(value) {
  if (value == null || value === '') {
    return null;
  }
  return String(value);
}

function parseDisplayId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const digits = value.trim().replace(/^#/, '');
  const parsed = parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return null;
}

function presentShopReview(review) {
  if (!review || typeof review !== 'object') {
    return null;
  }
  const response = review.shopResponse && typeof review.shopResponse === 'object' ? review.shopResponse : null;
  const outcome = review.outcome && typeof review.outcome === 'object' ? review.outcome : null;
  return {
    status: review.status ?? null,
    openedAt: toIso(review.openedAt),
    trigger: review.trigger ?? null,
    shopResponse: response
      ? {
        result: response.result ?? null,
        receivedAmount: response.receivedAmount ?? null,
        at: toIso(response.at)
      }
      : null,
    outcome: outcome ? { result: outcome.result ?? null } : null
  };
}

function paymentStatus(data) {
  return data?.payment?.status || null;
}

function wasPaymentConfirmed(data) {
  const status = paymentStatus(data);
  return CONFIRMED_OR_REFUND.has(status);
}

class ShopOrderService {
  getDb() {
    return getFirestore();
  }

  now() {
    return admin.firestore.FieldValue.serverTimestamp();
  }

  orders() {
    return this.getDb().collection(COLLECTION);
  }

  /**
   * payment.amount is always itemsTotal (product cost). Never includes deliveryFee.
   */
  assertAmountInvariant(itemsTotal, paymentAmount) {
    if (Number(paymentAmount) !== Number(itemsTotal)) {
      throw httpError(
        500,
        'PAYMENT_AMOUNT_MISMATCH',
        'payment.amount must equal itemsTotal and must never include deliveryFee'
      );
    }
  }

  handoverPrivateRef(orderId) {
    return this.orders().doc(orderId).collection('private').doc('handover');
  }

  async readHandoverOtp(orderId, data) {
    const privateSnap = await this.handoverPrivateRef(orderId).get();
    if (privateSnap.exists) {
      const fromPrivate = otpFromValue(privateSnap.data() && privateSnap.data().otp);
      if (fromPrivate) {
        return fromPrivate;
      }
    }
    return otpFromValue(data && data.handoverOtp);
  }

  async presentOrder(id, data, refundDocs) {
    const payment = data.payment || {};
    const loaded = Array.isArray(refundDocs)
      ? refundDocs
      : await loadRefundDocs(this.orders().doc(id));
    const itemsTotal = data.itemsTotal ?? 0;
    const amount = payment.amount ?? itemsTotal;
    const cancellation = data.cancellation || {};
    const address = data.deliveryAddress || {};
    const handoverOtp = await this.readHandoverOtp(id, data);

    return {
      id,
      shopId: data.shopId,
      customerId: data.customerId || null,
      items: Array.isArray(data.items) ? data.items : [],
      stockShort: data.stockShort === true,
      stockShortOpen: stockShortOpen(data.items),
      itemsTotal,
      deliveryFee: data.deliveryFee ?? 0,
      readyAt: toIso(data.readyAt),
      delivery: presentDelivery(data.delivery),
      deliveryAddress: {
        text: typeof address.text === 'string' ? address.text : '',
        coordinates: presentLocation(address.coordinates)
      },
      orderStatus: data.orderStatus,
      displayId: data.displayId ?? null,
      expectedAmount: data.expectedAmount ?? null,
      window: data.window && typeof data.window === 'object'
        ? { start: toIso(data.window.start), end: toIso(data.window.end) }
        : null,
      // Shop-facing only. Do not reuse this presenter on a customer GET without stripping handoverOtp.
      handoverOtp,
      linkedBookingId: data.linkedBookingId ?? null,
      driverInfo: presentDriverInfo(data.driverInfo),
      payment: {
        status: payment.status || null,
        shopUpiId: payment.shopUpiId || null,
        amount,
        transactionReference: payment.transactionReference || id,
        customerUtr: payment.customerUtr ?? null,
        officialUtr: payment.officialUtr ?? null,
        receivedAmount: payment.receivedAmount ?? null,
        receivedAmountPaise: payment.receivedAmountPaise ?? null,
        balance: payment.balance && typeof payment.balance === 'object'
          ? {
            amount: payment.balance.amount ?? null,
            amountPaise: payment.balance.amountPaise ?? null,
            dueBy: toIso(payment.balance.dueBy),
            utr: payment.balance.utr ?? null,
            officialUtr: payment.balance.officialUtr ?? null,
            utrSource: payment.balance.utrSource ?? null,
            submittedAt: toIso(payment.balance.submittedAt),
            confirmedAt: toIso(payment.balance.confirmedAt)
          }
          : null,
        customerUpiId: payment.customerUpiId ?? null,
        initiatedAt: payment.initiatedAt || null,
        confirmedAt: payment.confirmedAt || null,
        expiredAt: payment.expiredAt || null,
        refundedAt: payment.refundedAt || null,
        confirmedByShopUid: payment.confirmedByShopUid ?? null
      },
      review: presentShopReview(payment.review),
      cancellation: {
        reason: cancellation.reason ?? null,
        shopReason: typeof cancellation.shopReason === 'string' ? cancellation.shopReason : null,
        cancelledAt: cancellation.cancelledAt || null,
        cancelledBy: cancellation.cancelledBy ?? null,
        paidCheck: typeof cancellation.paidCheck === 'string' ? cancellation.paidCheck : null,
        paidCheckAt: toIso(cancellation.paidCheckAt)
      },
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
      hasOpenRefund: data.hasOpenRefund === true,
      refunds: loaded.map((refund) => presentShopRefund(refund, id))
    };
  }

  async notifyCustomer(customerId, type, variables = {}) {
    if (!customerId) {
      return;
    }
    try {
      if (type === 'UTR_CORRECTED' || type === 'AMOUNT_SHORT') {
        const template = NotificationTemplateProcessor.getTemplate('MARKETPLACE', type);
        const notification = NotificationTemplateProcessor.process(template, variables);
        if (notification.data && notification.data.variables) {
          delete notification.data.variables.utr;
          delete notification.data.variables.receivedAmount;
          delete notification.data.variables.balanceAmount;
        }
        const result = await notificationService.sendToUser(customerId, notification);
        if (result && result.success === false) {
          console.error('❌ [SHOP_ORDERS] Notification failed:', (result.error && result.error.code) || result.error);
        }
        return;
      }
      const result = await notificationService.sendTemplateNotification(customerId, 'MARKETPLACE', type, variables);
      if (result && result.success === false) {
        console.error('❌ [SHOP_ORDERS] Notification failed:', (result.error && result.error.code) || result.error);
      }
    } catch (error) {
      console.error('❌ [SHOP_ORDERS] Notification failed:', error.message);
    }
  }

  async sendNotifies(customerId, notifies) {
    const notes = Array.isArray(notifies) ? notifies : [];
    for (let index = 0; index < notes.length; index += 1) {
      await this.notifyCustomer(customerId, notes[index].type, notes[index].variables || {});
    }
  }

  async sendShopNotifies(shopId, notifies) {
    const notes = Array.isArray(notifies) ? notifies : [];
    if (!shopId || notes.length === 0) {
      return;
    }
    for (let index = 0; index < notes.length; index += 1) {
      try {
        const note = notes[index];
        const result = await notificationService.sendTemplateNotification(
          shopId,
          'MARKETPLACE',
          note.type,
          note.variables || {}
        );
        if (result && result.success === false) {
          console.error('❌ [SHOP_ORDERS] Shop notification failed:', (result.error && result.error.code) || result.error);
        }
      } catch (error) {
        console.error('❌ [SHOP_ORDERS] Shop notification failed:', error.message);
      }
    }
  }

  /**
   * Stage 1: query-then-write. Not safe under concurrent creates (Stage 2 follow-up).
   */
  async allocateUniqueDisplayId(customerId) {
    const timestamp = Date.now();
    for (let attempt = 0; attempt < DISPLAY_ID_ATTEMPTS; attempt += 1) {
      const candidate = await displayIdService.generateDisplayIdFor(
        displayIdService.marketplaceCounterDoc,
        timestamp + attempt,
        customerId || 'seed'
      );
      const hit = await this.orders().where('displayId', '==', candidate).limit(1).get();
      if (hit.empty) {
        return candidate;
      }
    }
    throw httpError(
      500,
      'DISPLAY_ID_COLLISION',
      'Could not allocate a unique displayId after retries'
    );
  }

  async getOwnedOrder(shopId, orderId) {
    const snap = await this.orders().doc(orderId).get();
    if (!snap.exists || snap.data().shopId !== shopId) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    return { ref: snap.ref, id: snap.id, data: snap.data() };
  }

  async listOpenRefunds(shopId, status) {
    return listShopRefunds(shopId, status);
  }

  async listOrders(shopId, status) {
    let orderStatus = null;
    if (status !== undefined && status !== null && String(status).trim() !== '') {
      orderStatus = String(status).trim();
      if (!ORDER_STATUSES.has(orderStatus)) {
        throw httpError(400, 'INVALID_STATUS', 'Invalid order status filter');
      }
    }

    let query = this.orders().where('shopId', '==', shopId);
    if (orderStatus) {
      query = query.where('orderStatus', '==', orderStatus);
    }
    const snapshot = await query.orderBy('createdAt', 'desc').get();
    return Promise.all(snapshot.docs.map((doc) => this.presentOrder(doc.id, doc.data())));
  }

  async getOrder(shopId, orderId) {
    const owned = await this.getOwnedOrder(shopId, orderId);
    return this.presentOrder(owned.id, owned.data);
  }

  async runOwnedTransition(shopId, orderId, apply) {
    const ref = this.orders().doc(orderId);
    const result = await this.getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().shopId !== shopId) {
        throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      }
      const data = snap.data();
      const applied = await apply(data, tx);
      if (applied.alreadyProcessed) {
        return {
          alreadyProcessed: true,
          order: await this.presentOrder(snap.id, data),
          notify: null,
          extra: applied.extra || {}
        };
      }
      tx.update(ref, {
        ...applied.updates,
        updatedAt: this.now()
      });
      return {
        alreadyProcessed: false,
        notify: applied.notify || null,
        extra: applied.extra || {}
      };
    });

    if (result.alreadyProcessed) {
      return result;
    }

    const fresh = await ref.get();
    return {
      ...result,
      order: await this.presentOrder(fresh.id, fresh.data())
    };
  }

  async confirmPayment(shopId, orderId, body, enforcement) {
    const flags = await resolveEnforcement(enforcement);
    if (flags.newStatuses) {
      const outcome = await confirmShopPayment({ shopId, orderId, body });
      if (!outcome.alreadyProcessed) {
        await this.sendNotifies(outcome.customerId, outcome.notifies);
        await this.sendShopNotifies(shopId, outcome.shopNotifies);
      }
      const fresh = await this.orders().doc(orderId).get();
      return {
        alreadyProcessed: outcome.alreadyProcessed,
        order: await this.presentOrder(fresh.id, fresh.data())
      };
    }

    const ref = this.orders().doc(orderId);
    const result = await this.runOwnedTransition(shopId, orderId, async (data, tx) => {
      const status = paymentStatus(data);
      if (status === 'confirmed' && POST_CONFIRM_ORDER.has(data.orderStatus)) {
        return alreadyProcessed(data);
      }
      if (BLOCKED_CONFIRM_PAYMENT.has(status) || data.orderStatus === 'cancelled') {
        throw httpError(409, 'INVALID_TRANSITION', 'Payment cannot be confirmed for this order');
      }
      if (!CONFIRMABLE_PAYMENT.has(status)) {
        throw httpError(409, 'INVALID_TRANSITION', 'Payment cannot be confirmed for this order');
      }

      this.assertAmountInvariant(data.itemsTotal, data.payment?.amount);
      const release = data.orderStatus === 'awaiting_payment'
        ? await readUnpaidRelease(tx, ref.firestore, {
          customerId: data.customerId,
          shopId: data.shopId
        })
        : null;
      const stock = await deductStock(tx, ref.firestore, {
        orderRef: ref,
        items: data.items,
        actor: { type: 'shop', id: shopId },
        customerId: data.customerId
      });
      if (release) {
        writeUnpaidRelease(tx, release, orderId, true);
      }
      appendEvent(tx, ref, {
        type: 'shop_confirm',
        actor: { type: 'shop', id: shopId }
      }, data.customerId);

      return {
        updates: {
          orderStatus: 'preparing',
          items: stock.items,
          stockShort: stock.stockShort === true,
          stockDeducted: stock.orderStockDeducted === true,
          'payment.status': 'confirmed',
          'payment.amount': data.itemsTotal,
          'payment.receivedAmount': data.expectedAmount != null ? data.expectedAmount : null,
          'payment.receivedAmountPaise': data.expectedAmountPaise != null ? data.expectedAmountPaise : null,
          'payment.confirmedAt': this.now(),
          'payment.confirmedByShopUid': shopId
        },
        notify: { type: 'PAYMENT_CONFIRMED' }
      };
    });

    if (!result.alreadyProcessed && result.notify) {
      await this.notifyCustomer(result.order.customerId, result.notify.type, {
        displayId: displayIdService.formatDisplayId(result.order.displayId),
        orderId: result.order.id,
        amount: result.order.payment.amount
      });
    }

    return result;
  }

  async reportAmountDiffers(shopId, orderId, body) {
    const outcome = await reportAmountDiffers({ shopId, orderId, body });
    if (!outcome.alreadyProcessed) {
      await this.sendNotifies(outcome.customerId, outcome.notifies);
      await this.sendShopNotifies(shopId, outcome.shopNotifies);
    }
    const fresh = await this.orders().doc(orderId).get();
    return {
      alreadyProcessed: outcome.alreadyProcessed,
      order: await this.presentOrder(fresh.id, fresh.data())
    };
  }

  async reportNotFound(shopId, orderId) {
    const outcome = await reportPaymentNotFound({ shopId, orderId });
    if (!outcome.alreadyProcessed) {
      await this.sendNotifies(outcome.customerId, outcome.notifies);
      await this.sendShopNotifies(shopId, outcome.shopNotifies);
    }
    const fresh = await this.orders().doc(orderId).get();
    return {
      alreadyProcessed: outcome.alreadyProcessed,
      order: await this.presentOrder(fresh.id, fresh.data())
    };
  }

  async resolveReview({ orderId, outcome, reason, operator }) {
    const result = await resolvePaymentReview({ orderId, outcome, reason, operator });
    if (!result.alreadyProcessed) {
      await this.sendNotifies(result.customerId, result.notifies);
      await this.sendShopNotifies(result.shopId, result.shopNotifies);
    }
    return result;
  }

  async answerPaidCheck(shopId, orderId, body) {
    const outcome = await answerPaidCheck({ shopId, orderId, body });
    if (!outcome.alreadyProcessed) {
      await this.sendNotifies(outcome.customerId, outcome.notifies);
    }
    const fresh = await this.orders().doc(orderId).get();
    return {
      alreadyProcessed: outcome.alreadyProcessed,
      order: await this.presentOrder(fresh.id, fresh.data())
    };
  }

  async rejectOrder(shopId, orderId, enforcement) {
    const flags = await resolveEnforcement(enforcement);
    const ref = this.orders().doc(orderId);
    const result = await this.runOwnedTransition(shopId, orderId, async (data, tx) => {
      if (data.orderStatus === 'payment_review') {
        throw httpError(409, 'INVALID_STATE', 'An open payment review cannot be rejected');
      }
      if (wasPaymentConfirmed(data)) {
        throw httpError(
          409,
          'INVALID_TRANSITION',
          'Cannot reject an order after payment is confirmed'
        );
      }
      if (data.orderStatus === 'cancelled') {
        return alreadyProcessed(data);
      }
      const payment = data.payment || {};
      if (flags.utrBlocksReject && (payment.customerUtr || payment.officialUtr)) {
        throw httpError(409, 'UTR_PRESENT', 'Use Received or Not found when a UTR exists');
      }

      const hasCustomerUtr = Boolean(payment.customerUtr);
      const db = ref.firestore;
      const release = data.orderStatus === 'awaiting_payment'
        ? await readUnpaidRelease(tx, db, { customerId: data.customerId, shopId: data.shopId })
        : null;
      const shopRef = db.collection('shops').doc(shopId);
      const shopSnap = await tx.get(shopRef);
      if (release) {
        writeUnpaidRelease(tx, release, orderId, true);
      }
      if (shopSnap && shopSnap.exists) {
        const rejections = shopSnap.data() && shopSnap.data().marketplaceStats
          ? Number(shopSnap.data().marketplaceStats.rejections)
          : 0;
        tx.update(shopRef, {
          'marketplaceStats.rejections': (Number.isFinite(rejections) ? rejections : 0) + 1
        });
      }
      appendEvent(tx, ref, {
        type: 'rejected',
        actor: { type: 'shop', id: shopId },
        data: !flags.utrBlocksReject && hasCustomerUtr ? { hadCustomerUtr: true } : null
      }, data.customerId);
      const updates = {
        orderStatus: 'cancelled',
        closedReason: 'shop_rejected',
        'cancellation.reason': 'shop_rejected',
        'cancellation.cancelledAt': this.now(),
        'cancellation.cancelledBy': shopId,
        'cancellation.requestedBy': 'shop'
      };
      if (!flags.utrBlocksReject && hasCustomerUtr) {
        updates['cancellation.paidCheck'] = 'pending';
        updates['cancellation.paidCheckAt'] = this.now();
        updates['payment.status'] = 'customer_claimed';
      } else if (!flags.utrBlocksReject) {
        updates['payment.status'] = 'cancelled';
      }
      return {
        updates,
        notify: { type: 'ORDER_CANCELLED', reason: null }
      };
    });

    if (!result.alreadyProcessed && result.notify) {
      await this.notifyCustomer(result.order.customerId, 'ORDER_CANCELLED', {
        displayId: displayIdService.formatDisplayId(result.order.displayId),
        orderId: result.order.id,
        reasonLine: ' '
      });
    }

    return result;
  }

  async markReady(shopId, orderId, options = {}) {
    const notifyDrivers = options.notifyDrivers !== false;
    const owned = await this.getOwnedOrder(shopId, orderId);
    if (owned.data.orderStatus === 'ready' && owned.data.linkedBookingId) {
      return {
        alreadyProcessed: true,
        order: await this.presentOrder(owned.id, owned.data)
      };
    }
    if (owned.data.orderStatus !== 'preparing') {
      throw httpError(409, 'INVALID_TRANSITION', 'Order must be preparing before it can be marked ready');
    }

    const bookingFields = await this.buildMarketplaceBookingDoc(shopId, owned.id, owned.data);
    const orderRef = owned.ref;
    const db = this.getDb();

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists || snap.data().shopId !== shopId) {
        throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      }
      const data = snap.data();
      if (data.orderStatus === 'ready' && data.linkedBookingId) {
        return { alreadyProcessed: true };
      }
      if (data.orderStatus !== 'preparing') {
        throw httpError(409, 'INVALID_TRANSITION', 'Order must be preparing before it can be marked ready');
      }
      if (stockShortOpen(data.items)) {
        throw httpError(409, 'STOCK_SHORT_UNRESOLVED', 'Resolve the stock short before marking the order ready');
      }

      const bookingRef = db.collection('bookings').doc();
      const now = new Date();
      const booking = {
        ...bookingFields,
        id: bookingRef.id,
        createdAt: now,
        updatedAt: now
      };
      tx.set(bookingRef, booking);
      tx.update(orderRef, {
        orderStatus: 'ready',
        readyAt: admin.firestore.FieldValue.serverTimestamp(),
        linkedBookingId: bookingRef.id,
        deliveryFee: bookingFields.fare.totalFare,
        delivery: {
          stage: 'searching',
          fare: bookingFields.fare.totalFare
        },
        updatedAt: this.now()
      });
      appendEvent(tx, orderRef, {
        type: 'marked_ready',
        actor: { type: 'shop', id: shopId },
        data: { bookingId: bookingRef.id, stage: 'searching' }
      }, data.customerId);
      return {
        alreadyProcessed: false,
        booking,
        customerId: data.customerId,
        variables: {
          ...pushVariables(data, snap.id),
          deliveryFee: bookingFields.fare.totalFare
        }
      };
    });

    if (result.alreadyProcessed) {
      const fresh = await orderRef.get();
      return {
        alreadyProcessed: true,
        order: await this.presentOrder(fresh.id, fresh.data())
      };
    }

    if (notifyDrivers) {
      try {
        const WebSocketEventHandler = require('./websocketEventHandler');
        const handler = new WebSocketEventHandler();
        await handler.initialize();
        await handler.notifyDriversOfNewBooking(result.booking);
      } catch (error) {
        console.error('❌ [SHOP_ORDERS] Driver notify failed:', error.message);
      }
    }

    await this.notifyCustomer(result.customerId, 'ORDER_PACKED', result.variables);

    const fresh = await orderRef.get();
    return {
      alreadyProcessed: false,
      order: await this.presentOrder(fresh.id, fresh.data())
    };
  }

  async buildMarketplaceBookingDoc(shopId, orderId, orderData) {
    const db = this.getDb();
    const [userSnap, shopSnap, customerSnap] = await Promise.all([
      db.collection('users').doc(shopId).get(),
      db.collection('shops').doc(shopId).get(),
      orderData.customerId
        ? db.collection('users').doc(orderData.customerId).get()
        : Promise.resolve(null)
    ]);

    const userData = userSnap.exists ? (userSnap.data() || {}) : {};
    const shopUser = userData.shop || {};
    const shopProfile = shopSnap.exists ? (shopSnap.data() || {}) : {};
    const customerData = customerSnap && customerSnap.exists ? (customerSnap.data() || {}) : {};
    const delivery = orderData.deliveryAddress || {};

    const pickupCoords = toLatLng(shopProfile.location);
    const dropoffCoords = toLatLng(delivery.coordinates);
    if (!pickupCoords || !dropoffCoords) {
      throw httpError(
        409,
        'MISSING_LOCATION',
        'Shop pickup location and delivery coordinates are required before marking ready'
      );
    }

    const fareCalculationService = require('./fareCalculationService');
    let distanceKm;
    let fareDetails;
    try {
      const calculated = await fareCalculationService.calculateDistanceAndFare(
        { lat: pickupCoords.lat, lng: pickupCoords.lng },
        { lat: dropoffCoords.lat, lng: dropoffCoords.lng }
      );
      distanceKm = calculated.distanceKm;
      fareDetails = calculated.fare;
    } catch (error) {
      if (fareCalculationService.isFareUnavailableError(error)) {
        console.error('❌ [SHOP_ORDERS] Fare unavailable, order not marked ready:', error.message);
        throw httpError(
          503,
          'FARE_UNAVAILABLE',
          fareCalculationService.FARE_UNAVAILABLE_DETAILS
        );
      }
      throw error;
    }

    const itemCount = Array.isArray(orderData.items)
      ? orderData.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
      : 0;
    const displayId = displayIdService.formatDisplayId(orderData.displayId);
    const shopName = typeof shopUser.shopName === 'string' && shopUser.shopName
      ? shopUser.shopName
      : (typeof userData.name === 'string' && userData.name ? userData.name : 'Shop');
    const shopPhone = typeof userData.phone === 'string' ? userData.phone : '';
    const shopAddress = typeof shopProfile.address === 'string' ? shopProfile.address : '';
    const customerName = typeof customerData.name === 'string' && customerData.name
      ? customerData.name
      : 'Customer';
    const customerPhone = typeof customerData.phone === 'string' ? customerData.phone : '';
    const dropoffAddress = typeof delivery.text === 'string' ? delivery.text : '';
    const instructions = riderInstructions(orderData);
    const dropoff = {
      name: customerName,
      phone: customerPhone,
      address: dropoffAddress,
      coordinates: {
        latitude: dropoffCoords.latitude,
        longitude: dropoffCoords.longitude
      }
    };
    if (instructions) {
      dropoff.instructions = instructions;
    }

    return {
      customerId: orderData.customerId || null,
      status: 'pending',
      driverId: null,
      displayId: orderData.displayId,
      pickup: {
        name: shopName,
        phone: shopPhone,
        address: shopAddress,
        coordinates: {
          latitude: pickupCoords.latitude,
          longitude: pickupCoords.longitude
        }
      },
      dropoff,
      package: {
        description: `Order ${displayId} — ${itemCount} items`,
        weight: 1
      },
      ...marketplaceBookingFareFields(fareDetails, distanceKm),
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      sourceType: 'marketplace',
      marketplaceOrderId: orderId
    };
  }

  async cancelLinkedPendingBooking(linkedBookingId) {
    if (!linkedBookingId) {
      return;
    }
    const ref = this.getDb().collection('bookings').doc(linkedBookingId);
    await this.getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        return;
      }
      const data = snap.data() || {};
      if (data.status !== 'pending' || data.driverId) {
        return;
      }
      tx.update(ref, {
        status: 'cancelled',
        cancellationReason: 'Marketplace order cancelled',
        cancelledAt: new Date(),
        updatedAt: new Date()
      });
    });
  }

  async confirmHandover(shopId, orderId, payload = {}) {
    const otp = typeof payload.otp === 'string' ? payload.otp.trim() : '';
    const displayId = parseDisplayId(payload.displayId ?? payload.orderId);
    if (!otp || displayId === null) {
      throw httpError(400, 'INVALID_HANDOVER', 'otp and displayId are required');
    }

    return this.runOwnedTransition(shopId, orderId, async (data, tx) => {
      if (data.orderStatus === 'handed_over') {
        return alreadyProcessed(data);
      }
      if (data.orderStatus !== 'ready') {
        throw httpError(409, 'INVALID_TRANSITION', 'Order must be ready before handover');
      }
      const privateSnap = await tx.get(this.handoverPrivateRef(orderId));
      const privateOtp = privateSnap.exists
        ? otpFromValue(privateSnap.data() && privateSnap.data().otp)
        : null;
      const expectedOtp = privateOtp || otpFromValue(data.handoverOtp) || '';
      const expectedDisplay = Number(data.displayId);
      if (otp !== expectedOtp || displayId !== expectedDisplay) {
        throw httpError(409, 'HANDOVER_MISMATCH', 'Order ID or OTP does not match');
      }
      const orderRef = this.orders().doc(orderId);
      const stage = data.delivery && data.delivery.stage;
      if (stage === 'delivered') {
        if (data.shopId) {
          tx.set(this.getDb().collection('shops').doc(data.shopId), {
            orderCount: admin.firestore.FieldValue.increment(1)
          }, { merge: true });
        }
        appendEvent(tx, orderRef, {
          type: 'completed',
          actor: { type: 'shop', id: shopId }
        }, data.customerId);
        return {
          updates: { orderStatus: 'completed' }
        };
      }
      appendEvent(tx, orderRef, {
        type: 'handed_over',
        actor: { type: 'shop', id: shopId }
      }, data.customerId);
      return {
        updates: { orderStatus: 'handed_over' }
      };
    });
  }

  async markUnavailable(shopId, orderId, payload = {}) {
    const rawIds = payload && Array.isArray(payload.itemIds) ? payload.itemIds : null;
    if (!rawIds) {
      throw httpError(400, 'VALIDATION', 'itemIds is required');
    }
    const itemIds = [];
    rawIds.forEach((id) => {
      if (typeof id !== 'string' || id.trim() === '' || itemIds.includes(id)) {
        return;
      }
      itemIds.push(id);
    });
    if (itemIds.length === 0) {
      throw httpError(400, 'VALIDATION', 'itemIds is required');
    }

    const ref = this.orders().doc(orderId);
    const result = await this.getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().shopId !== shopId) {
        throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      }
      const data = snap.data();
      if (data.orderStatus !== 'preparing') {
        throw httpError(409, 'INVALID_STATE', 'Items can only be marked unavailable while the order is preparing');
      }
      const items = Array.isArray(data.items) ? data.items : [];
      const indexes = itemIds.map((id) => items.findIndex((line, index) => {
        const stored = line && typeof line.id === 'string' && line.id.trim() !== ''
          ? line.id
          : `line${index}`;
        return stored === id;
      }));
      if (indexes.some((index) => index < 0)) {
        throw httpError(400, 'VALIDATION', 'Unknown item id');
      }
      const wouldAll = items.every((line, index) => line.unavailable === true || indexes.includes(index));
      if (wouldAll) {
        throw httpError(409, 'ALL_ITEMS_UNAVAILABLE', 'use cancel');
      }
      const targets = indexes.map((index) => items[index]);
      if (targets.every((line) => line.unavailable === true)) {
        return { alreadyProcessed: true };
      }
      if (targets.some((line) => line.unavailable === true)) {
        throw httpError(409, 'ALREADY_UNAVAILABLE', 'A line is already unavailable');
      }

      const refundSnap = await tx.get(ref.collection('refunds'));
      const amountPaise = indexes.reduce((sum, index) => sum + lineRefundPaise(items[index]), 0);
      if (sumRefundPaise(refundSnap.docs || []) + amountPaise > receivedPaiseOf(data)) {
        throw httpError(409, 'REFUND_CAP', 'Refund would exceed the amount received');
      }
      const restored = await restoreLines(tx, ref.firestore, {
        orderRef: ref,
        items,
        actor: { type: 'shop', id: shopId },
        indexes,
        customerId: data.customerId
      });
      const nextItems = restored.items.map((line, index) => (
        indexes.includes(index) ? { ...line, unavailable: true } : line
      ));
      const marked = indexes.map((index) => nextItems[index]);
      createRefund(tx, {
        orderRef: ref,
        data,
        reason: 'stock_short',
        amount: fromPaise(amountPaise),
        items: marked,
        actor: { type: 'shop', id: shopId },
        resultingOrderStatus: 'preparing'
      });
      appendEvent(tx, ref, {
        type: 'items_unavailable',
        actor: { type: 'shop', id: shopId },
        data: {
          lines: marked.map((line) => ({
            id: line.id,
            productId: line.productId || null,
            variantId: line.variantId || null,
            qty: line.qty
          }))
        }
      }, data.customerId);
      tx.update(ref, {
        items: nextItems,
        updatedAt: this.now()
      });
      return {
        alreadyProcessed: false,
        customerId: data.customerId || null,
        variables: pushVariables(data, orderId)
      };
    });

    if (!result.alreadyProcessed) {
      await this.notifyCustomer(result.customerId, 'ITEMS_UNAVAILABLE', result.variables);
      await this.notifyCustomer(result.customerId, 'REFUND_INITIATED', result.variables);
    }
    const fresh = await ref.get();
    return {
      alreadyProcessed: result.alreadyProcessed,
      order: await this.presentOrder(fresh.id, fresh.data())
    };
  }

  async cancelOrder(shopId, orderId, payload = {}, enforcement) {
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (!reason) {
      throw httpError(400, 'MISSING_REASON', 'reason is required');
    }
    const flags = await resolveEnforcement(enforcement);
    const ref = this.orders().doc(orderId);

    const result = await this.runOwnedTransition(shopId, orderId, async (data, tx) => {
      const paid = paymentStatus(data) === 'confirmed';
      const refundPending = paymentStatus(data) === 'refund_pending'
        || paymentStatus(data) === 'refunded';

      if (data.orderStatus === 'cancelled') {
        return {
          alreadyProcessed: true,
          extra: { refundRequired: paid || refundPending }
        };
      }
      if (data.orderStatus === 'payment_review') {
        throw httpError(409, 'INVALID_STATE', 'Use confirm-payment with fulfil false to leave a payment review');
      }
      const decision = shopCancelAllowed(data, flags);
      if (!decision.ok) {
        throw httpError(409, 'CANCEL_NOT_ALLOWED', 'This order cannot be cancelled');
      }
      const db = ref.firestore;
      const release = data.orderStatus === 'awaiting_payment'
        ? await readUnpaidRelease(tx, db, {
          customerId: data.customerId,
          shopId: data.shopId
        })
        : null;
      let refundDocs = [];
      if (paid) {
        const refundSnap = await tx.get(ref.collection('refunds'));
        refundDocs = refundSnap.docs || [];
      }
      let nextItems = data.items;
      if (cancelRestoresStock(data)) {
        const restored = await restoreLines(tx, db, {
          orderRef: ref,
          items: data.items,
          actor: { type: 'shop', id: shopId },
          customerId: data.customerId
        });
        nextItems = restored.items;
      }
      if (release) {
        writeUnpaidRelease(tx, release, orderId, true);
      }
      appendEvent(tx, ref, {
        type: 'cancelled',
        actor: { type: 'shop', id: shopId },
        reason
      }, data.customerId);

      const updates = {
        orderStatus: 'cancelled',
        closedReason: 'shop_cancelled',
        'cancellation.reason': 'shop_cancelled',
        'cancellation.shopReason': reason,
        'cancellation.cancelledAt': this.now(),
        'cancellation.cancelledBy': shopId
      };
      if (nextItems !== data.items) {
        updates.items = nextItems;
      }

      if (paid) {
        const receivedPaise = receivedPaiseOf(data);
        const remainderPaise = Math.max(0, receivedPaise - sumRefundPaise(refundDocs));
        if (remainderPaise > 0) {
          createRefund(tx, {
            orderRef: ref,
            data,
            reason: 'shop_cancel',
            amount: fromPaise(remainderPaise),
            items: nextItems,
            actor: { type: 'shop', id: shopId },
            eventReason: reason,
            resultingOrderStatus: 'cancelled'
          });
        }
        updates['payment.status'] = 'refund_pending';
        return {
          updates,
          notify: {
            type: remainderPaise > 0 ? 'REFUND_INITIATED' : 'ORDER_CANCELLED',
            shopReason: reason
          },
          extra: { refundRequired: true }
        };
      }

      return {
        updates,
        notify: { type: 'ORDER_CANCELLED', shopReason: reason },
        extra: { refundRequired: false }
      };
    });

    if (!result.alreadyProcessed && result.notify) {
      const shopReason = result.notify.shopReason || '';
      const vars = {
        displayId: displayIdService.formatDisplayId(result.order.displayId),
        orderId: result.order.id,
        amount: result.order.payment.amount,
        reason: shopReason,
        reasonLine: shopReason ? ` Reason: ${shopReason}` : ''
      };
      await this.notifyCustomer(result.order.customerId, result.notify.type, vars);
    }

    if (!result.alreadyProcessed) {
      await this.cancelLinkedPendingBooking(result.order.linkedBookingId);
    }

    return result;
  }

  async supportCancelBeforeHandover({ orderId, operator, note }) {
    if (typeof operator !== 'string' || operator.trim() === ''
      || typeof note !== 'string' || note.trim() === '') {
      throw httpError(400, 'VALIDATION', 'operator and reason are required');
    }
    const operatorId = operator.trim();
    const noteText = note.trim();
    const db = this.getDb();
    const orderRef = this.orders().doc(orderId);
    const outcome = await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) {
        throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      }
      const data = orderSnap.data() || {};
      if (data.orderStatus === 'cancelled' && (
        data.closedReason === 'support_cancelled'
        || (data.cancellation && data.cancellation.reason === 'support_cancelled')
      )) {
        return { alreadyProcessed: true, data };
      }
      const stage = data.delivery && data.delivery.stage;
      const stageBlocked = stage === 'picked_up' || stage === 'on_the_way' || stage === 'delivered';
      const statusBlocked = data.orderStatus === 'handed_over' || data.orderStatus === 'completed';
      const allowed = data.orderStatus === 'preparing'
        || (data.orderStatus === 'ready' && (stage == null || SUPPORT_READY_STAGES.has(stage)));
      if (statusBlocked || stageBlocked || !allowed) {
        throw httpError(409, 'CANCEL_NOT_ALLOWED', 'This order cannot be cancelled');
      }

      let booking = null;
      let bookingRef = null;
      if (data.linkedBookingId) {
        bookingRef = db.collection('bookings').doc(data.linkedBookingId);
        const bookingSnap = await tx.get(bookingRef);
        if (bookingSnap.exists) {
          booking = bookingSnap.data() || {};
          if (PAST_PICKUP_BOOKING.has(booking.status)) {
            throw httpError(409, 'CANCEL_NOT_ALLOWED', 'This order cannot be cancelled');
          }
        } else {
          bookingRef = null;
        }
      }

      const payment = data.payment || {};
      const receivedPaise = payment.receivedAmountPaise != null
        && Number.isFinite(Number(payment.receivedAmountPaise))
        ? Number(payment.receivedAmountPaise)
        : (payment.receivedAmount != null ? toPaise(payment.receivedAmount) : 0);
      const remainder = await refundRemainder(tx, orderRef, receivedPaise);

      let driverRef = null;
      let driverSnap = null;
      const driverId = booking && booking.driverId ? booking.driverId : null;
      if (driverId) {
        driverRef = db.collection('users').doc(driverId);
        driverSnap = await tx.get(driverRef);
      }

      let nextItems = data.items;
      if (cancelRestoresStock(data)) {
        const restored = await restoreLines(tx, db, {
          orderRef,
          items: data.items,
          actor: { type: 'support', id: operatorId },
          customerId: data.customerId
        });
        nextItems = restored.items;
      }

      const at = new Date();
      if (bookingRef) {
        tx.update(bookingRef, {
          status: 'cancelled',
          cancellationReason: 'Marketplace order cancelled',
          cancelledBy: 'support',
          cancelledAt: at,
          updatedAt: at
        });
      }
      if (driverRef && driverSnap && driverSnap.exists) {
        const driverData = driverSnap.data() || {};
        const active = driverData.driver && driverData.driver.activeBookings;
        tx.update(driverRef, {
          'driver.activeBookings': Math.max((active || 1) - 1, 0),
          updatedAt: at
        });
      }

      const reason = 'support_cancelled';
      const orderPatch = {
        orderStatus: 'cancelled',
        closedReason: reason,
        items: nextItems,
        'cancellation.reason': reason,
        'cancellation.cancelledAt': admin.firestore.FieldValue.serverTimestamp(),
        'cancellation.cancelledBy': 'support',
        'cancellation.support': { operator: operatorId, note: noteText },
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      if (bookingRef) {
        orderPatch['delivery.stage'] = 'cancelled';
      }
      tx.update(orderRef, orderPatch);
      appendEvent(tx, orderRef, {
        type: 'cancelled',
        actor: { type: 'support', id: operatorId },
        data: { reason }
      }, data.customerId);
      let refundCreated = false;
      let refundAmount = null;
      if (remainder.remainderPaise > 0) {
        refundAmount = fromPaise(remainder.remainderPaise);
        createRefund(tx, {
          orderRef,
          data,
          reason,
          amount: refundAmount,
          items: nextItems,
          actor: { type: 'support', id: operatorId },
          resultingOrderStatus: 'cancelled'
        });
        refundCreated = true;
      }
      return {
        alreadyProcessed: false,
        data,
        customerId: data.customerId || null,
        displayId: data.displayId,
        shopName: data.shopSnapshot && typeof data.shopSnapshot.name === 'string'
          ? data.shopSnapshot.name
          : '',
        driverId,
        bookingId: data.linkedBookingId || null,
        refundCreated,
        refundAmount
      };
    });

    if (outcome.alreadyProcessed) {
      return { alreadyProcessed: true, wrote: false };
    }

    const variables = {
      displayId: displayIdService.formatDisplayId(outcome.displayId),
      orderId,
      shopName: outcome.shopName,
      reasonLine: ''
    };
    try {
      if (outcome.refundCreated) {
        await this.notifyCustomer(outcome.customerId, 'REFUND_INITIATED', {
          ...variables,
          amount: outcome.refundAmount
        });
      } else {
        await this.notifyCustomer(outcome.customerId, 'ORDER_CANCELLED', variables);
      }
    } catch (error) {
      console.error('❌ [SHOP_ORDERS] Support cancel notification failed:', error.message);
    }
    if (outcome.driverId && outcome.bookingId) {
      try {
        await notificationService.sendTemplateNotification(
          outcome.driverId,
          'DRIVER',
          'BOOKING_CANCELLED',
          {
            bookingId: outcome.bookingId,
            reason: 'Booking cancelled by admin'
          }
        );
      } catch (error) {
        console.error('❌ [SHOP_ORDERS] Driver cancel notification failed:', error.message);
      }
    }
    return { alreadyProcessed: false, wrote: true };
  }

  async refundSent(shopId, orderId, enforcement) {
    const flags = await resolveEnforcement(enforcement);
    if (flags.newStatuses === true) {
      throw httpError(409, 'REFUND_UTR_REQUIRED', 'Record the refund UTR on the refund');
    }
    const orderRef = this.orders().doc(orderId);
    const result = await this.runOwnedTransition(shopId, orderId, async (data, tx) => {
      const status = paymentStatus(data);
      if (status === 'refunded') {
        return alreadyProcessed(data);
      }
      if (status !== 'refund_pending') {
        throw httpError(409, 'INVALID_TRANSITION', 'Refund can only be sent while refund is pending');
      }
      const refundSnap = await tx.get(orderRef.collection('refunds'));
      const openDocs = (refundSnap.docs || []).filter((doc) => {
        const refundStatus = (doc.data() || {}).status;
        return OPEN_STATUSES.has(refundStatus);
      });
      const stamp = admin.firestore.FieldValue.serverTimestamp();
      openDocs.forEach((doc) => {
        tx.update(doc.ref, {
          status: 'closed',
          closedBy: 'legacy_refund_sent',
          updatedAt: stamp
        });
        appendEvent(tx, orderRef, {
          type: 'refund_auto_closed',
          actor: { type: 'shop', id: shopId },
          data: { legacy: true }
        }, data.customerId);
      });
      if (openDocs.length === 0) {
        appendEvent(tx, orderRef, {
          type: 'payment_refunded',
          actor: { type: 'shop', id: shopId }
        }, data.customerId);
      }
      return {
        updates: {
          'payment.status': 'refunded',
          'payment.refundedAt': this.now(),
          hasOpenRefund: false
        },
        notify: { type: 'REFUND_SENT' }
      };
    });

    if (!result.alreadyProcessed && result.notify) {
      await this.notifyCustomer(result.order.customerId, 'REFUND_SENT', {
        displayId: displayIdService.formatDisplayId(result.order.displayId),
        orderId: result.order.id,
        amount: result.order.payment.amount
      });
    }

    return result;
  }

  /**
   * Test-only writer for Stage 1 (no customer create endpoint yet).
   */
  async createSeedOrder({ shopId, customerId, orderStatus = 'awaiting_payment' } = {}) {
    if (!shopId) {
      throw httpError(400, 'INVALID_SEED', 'shopId is required');
    }
    if (orderStatus && !ORDER_STATUSES.has(orderStatus)) {
      throw httpError(400, 'INVALID_STATUS', 'Invalid order status');
    }

    const itemsTotal = 250;
    const deliveryFee = 45;
    let displayId;
    let handoverOtp;
    let ref;
    if (isPoolEnabled()) {
      ref = this.orders().doc();
      displayId = await allocateOrderNumber(this.getDb(), {
        kind: 'shop_order',
        refId: ref.id
      });
      handoverOtp = generateHandoverOtp();
    } else {
      displayId = await this.allocateUniqueDisplayId(customerId || shopId);
      handoverOtp = generateHandoverOtp();
      ref = this.orders().doc();
    }
    const now = this.now();

    let shopUpiId = '';
    const shopSnap = await this.getDb().collection('shops').doc(shopId).get();
    if (shopSnap.exists) {
      const bank = shopSnap.data().bank || {};
      shopUpiId = typeof bank.upiId === 'string' ? bank.upiId : '';
    }

    const paymentStatusValue = orderStatus === 'awaiting_payment' ? 'pending' : (
      orderStatus === 'cancelled' ? 'pending' : 'confirmed'
    );

    const doc = {
      shopId,
      customerId: customerId || null,
      items: [
        {
          productId: 'seed-item-1',
          variantId: null,
          name: 'Seed product',
          price: itemsTotal,
          qty: 1
        }
      ],
      itemsTotal,
      deliveryFee,
      deliveryAddress: {
        text: 'Seed delivery address',
        coordinates: new admin.firestore.GeoPoint(12.4963, 78.5678)
      },
      orderStatus,
      payment: {
        status: paymentStatusValue,
        shopUpiId,
        amount: itemsTotal,
        transactionReference: ref.id,
        customerUtr: null,
        customerUpiId: null,
        initiatedAt: null,
        confirmedAt: paymentStatusValue === 'confirmed' ? now : null,
        expiredAt: null,
        refundedAt: null,
        confirmedByShopUid: paymentStatusValue === 'confirmed' ? shopId : null
      },
      cancellation: {
        reason: null,
        cancelledAt: null,
        cancelledBy: null
      },
      linkedBookingId: null,
      driverInfo: null,
      displayId,
      createdAt: now,
      updatedAt: now
    };

    this.assertAmountInvariant(doc.itemsTotal, doc.payment.amount);
    const batch = this.getDb().batch();
    batch.set(ref, doc);
    batch.set(this.handoverPrivateRef(ref.id), { otp: handoverOtp });
    await batch.commit();
    const saved = await ref.get();

    return {
      order: await this.presentOrder(saved.id, saved.data()),
      handoverOtp,
      displayId
    };
  }
}

const shopOrderService = new ShopOrderService();
shopOrderService.marketplaceBookingFareFields = marketplaceBookingFareFields;
module.exports = shopOrderService;
