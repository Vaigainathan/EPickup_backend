const crypto = require('crypto');
const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');
const displayIdService = require('./displayIdService');
const notificationService = require('./notificationService');

const COLLECTION = 'marketplaceOrders';
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

  presentOrder(id, data) {
    const payment = data.payment || {};
    const itemsTotal = data.itemsTotal ?? 0;
    const amount = payment.amount ?? itemsTotal;
    const cancellation = data.cancellation || {};
    const address = data.deliveryAddress || {};

    return {
      id,
      shopId: data.shopId,
      customerId: data.customerId || null,
      items: Array.isArray(data.items) ? data.items : [],
      itemsTotal,
      deliveryFee: data.deliveryFee ?? 0,
      deliveryAddress: {
        text: typeof address.text === 'string' ? address.text : '',
        coordinates: presentLocation(address.coordinates)
      },
      orderStatus: data.orderStatus,
      displayId: data.displayId ?? null,
      linkedBookingId: data.linkedBookingId ?? null,
      driverInfo: presentDriverInfo(data.driverInfo),
      payment: {
        status: payment.status || null,
        shopUpiId: payment.shopUpiId || null,
        amount,
        transactionReference: payment.transactionReference || id,
        customerUtr: payment.customerUtr ?? null,
        customerUpiId: payment.customerUpiId ?? null,
        initiatedAt: payment.initiatedAt || null,
        confirmedAt: payment.confirmedAt || null,
        expiredAt: payment.expiredAt || null,
        refundedAt: payment.refundedAt || null,
        confirmedByShopUid: payment.confirmedByShopUid ?? null
      },
      cancellation: {
        reason: cancellation.reason ?? null,
        cancelledAt: cancellation.cancelledAt || null,
        cancelledBy: cancellation.cancelledBy ?? null
      },
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    };
  }

  async notifyCustomer(customerId, type, variables = {}) {
    if (!customerId) {
      return;
    }
    try {
      await notificationService.sendTemplateNotification(customerId, 'MARKETPLACE', type, variables);
    } catch (error) {
      console.error('❌ [SHOP_ORDERS] Notification failed:', error.message);
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
    return snapshot.docs.map((doc) => this.presentOrder(doc.id, doc.data()));
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
      const applied = apply(data);
      if (applied.alreadyProcessed) {
        return {
          alreadyProcessed: true,
          order: this.presentOrder(snap.id, data),
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
      order: this.presentOrder(fresh.id, fresh.data())
    };
  }

  async confirmPayment(shopId, orderId) {
    const result = await this.runOwnedTransition(shopId, orderId, (data) => {
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

      return {
        updates: {
          orderStatus: 'preparing',
          'payment.status': 'confirmed',
          'payment.amount': data.itemsTotal,
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

  async rejectOrder(shopId, orderId) {
    const result = await this.runOwnedTransition(shopId, orderId, (data) => {
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

      return {
        updates: {
          orderStatus: 'cancelled',
          'cancellation.reason': null,
          'cancellation.cancelledAt': this.now(),
          'cancellation.cancelledBy': shopId
        },
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

  async markReady(shopId, orderId) {
    const owned = await this.getOwnedOrder(shopId, orderId);
    if (owned.data.orderStatus === 'ready' || owned.data.linkedBookingId) {
      return {
        alreadyProcessed: true,
        order: this.presentOrder(owned.id, owned.data)
      };
    }
    if (owned.data.orderStatus !== 'preparing') {
      throw httpError(409, 'INVALID_TRANSITION', 'Order must be preparing before it can be marked ready');
    }

    const bookingFields = await this.buildMarketplaceBookingDoc(shopId, owned.id, owned.data);
    const orderRef = owned.ref;

    const result = await this.getDb().runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists || snap.data().shopId !== shopId) {
        throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      }
      const data = snap.data();
      if (data.orderStatus === 'ready' || data.linkedBookingId) {
        return {
          alreadyProcessed: true,
          order: this.presentOrder(snap.id, data)
        };
      }
      if (data.orderStatus !== 'preparing') {
        throw httpError(409, 'INVALID_TRANSITION', 'Order must be preparing before it can be marked ready');
      }

      const bookingRef = this.getDb().collection('bookings').doc();
      const now = new Date();
      tx.set(bookingRef, {
        ...bookingFields,
        createdAt: now,
        updatedAt: now
      });
      tx.update(orderRef, {
        orderStatus: 'ready',
        linkedBookingId: bookingRef.id,
        updatedAt: this.now()
      });
      return { alreadyProcessed: false };
    });

    if (result.alreadyProcessed) {
      return result;
    }

    const fresh = await orderRef.get();
    return {
      alreadyProcessed: false,
      order: this.presentOrder(fresh.id, fresh.data())
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
      console.error('❌ [SHOP_ORDERS] Fare calculation failed, using fallback:', error.message);
      distanceKm = 5;
      fareDetails = fareCalculationService.calculateFare(distanceKm);
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

    return {
      customerId: orderData.customerId || null,
      status: 'pending',
      driverId: null,
      pickup: {
        name: shopName,
        phone: shopPhone,
        address: shopAddress,
        coordinates: {
          latitude: pickupCoords.latitude,
          longitude: pickupCoords.longitude
        }
      },
      dropoff: {
        name: customerName,
        phone: customerPhone,
        address: dropoffAddress,
        coordinates: {
          latitude: dropoffCoords.latitude,
          longitude: dropoffCoords.longitude
        }
      },
      package: {
        description: `Order ${displayId} — ${itemCount} items`,
        weight: 1
      },
      fare: {
        baseFare: fareDetails.baseFare,
        distanceFare: fareDetails.baseFare,
        totalFare: fareDetails.totalFare,
        currency: 'INR',
        commission: fareDetails.commission,
        driverNet: fareDetails.driverEarnings,
        companyRevenue: fareDetails.commission
      },
      pricing: {
        baseFare: fareDetails.baseFare,
        distanceFare: fareDetails.baseFare,
        totalFare: fareDetails.totalFare,
        currency: 'INR',
        commission: fareDetails.commission,
        driverNet: fareDetails.driverEarnings,
        companyRevenue: fareDetails.commission
      },
      distance: distanceKm,
      exactDistance: fareDetails.exactDistanceKm,
      roundedDistance: fareDetails.roundedDistanceKm || Math.ceil(distanceKm || 0),
      fareBreakdown: fareDetails.breakdown,
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

    return this.runOwnedTransition(shopId, orderId, (data) => {
      if (data.orderStatus === 'handed_over') {
        return alreadyProcessed(data);
      }
      if (data.orderStatus !== 'ready') {
        throw httpError(409, 'INVALID_TRANSITION', 'Order must be ready before handover');
      }
      const expectedOtp = String(data.handoverOtp || '');
      const expectedDisplay = Number(data.displayId);
      if (otp !== expectedOtp || displayId !== expectedDisplay) {
        throw httpError(409, 'HANDOVER_MISMATCH', 'Order ID or OTP does not match');
      }
      return {
        updates: { orderStatus: 'handed_over' }
      };
    });
  }

  async cancelOrder(shopId, orderId, payload = {}) {
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (!reason) {
      throw httpError(400, 'MISSING_REASON', 'reason is required');
    }

    const result = await this.runOwnedTransition(shopId, orderId, (data) => {
      const paid = paymentStatus(data) === 'confirmed';
      const refundPending = paymentStatus(data) === 'refund_pending'
        || paymentStatus(data) === 'refunded';

      if (data.orderStatus === 'cancelled') {
        return {
          alreadyProcessed: true,
          extra: { refundRequired: paid || refundPending }
        };
      }

      if (paid) {
        return {
          updates: {
            orderStatus: 'cancelled',
            'payment.status': 'refund_pending',
            'cancellation.reason': reason,
            'cancellation.cancelledAt': this.now(),
            'cancellation.cancelledBy': shopId
          },
          notify: { type: 'REFUND_INITIATED', reason },
          extra: { refundRequired: true }
        };
      }

      return {
        updates: {
          orderStatus: 'cancelled',
          'cancellation.reason': reason,
          'cancellation.cancelledAt': this.now(),
          'cancellation.cancelledBy': shopId
        },
        notify: { type: 'ORDER_CANCELLED', reason },
        extra: { refundRequired: false }
      };
    });

    if (!result.alreadyProcessed && result.notify) {
      const vars = {
        displayId: displayIdService.formatDisplayId(result.order.displayId),
        orderId: result.order.id,
        amount: result.order.payment.amount,
        reason: result.notify.reason || '',
        reasonLine: result.notify.reason ? ` Reason: ${result.notify.reason}` : ''
      };
      await this.notifyCustomer(result.order.customerId, result.notify.type, vars);
    }

    if (!result.alreadyProcessed) {
      await this.cancelLinkedPendingBooking(result.order.linkedBookingId);
    }

    return result;
  }

  async refundSent(shopId, orderId) {
    const result = await this.runOwnedTransition(shopId, orderId, (data) => {
      const status = paymentStatus(data);
      if (status === 'refunded') {
        return alreadyProcessed(data);
      }
      if (status !== 'refund_pending') {
        throw httpError(409, 'INVALID_TRANSITION', 'Refund can only be sent while refund is pending');
      }
      return {
        updates: {
          'payment.status': 'refunded',
          'payment.refundedAt': this.now()
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
    const displayId = await this.allocateUniqueDisplayId(customerId || shopId);
    const handoverOtp = generateHandoverOtp();
    const ref = this.orders().doc();
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
      handoverOtp,
      createdAt: now,
      updatedAt: now
    };

    this.assertAmountInvariant(doc.itemsTotal, doc.payment.amount);
    await ref.set(doc);
    const saved = await ref.get();

    return {
      order: this.presentOrder(saved.id, saved.data()),
      handoverOtp,
      displayId
    };
  }
}

module.exports = new ShopOrderService();
