const crypto = require('crypto');
const { GeoPoint, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('../firebase');
const { MARKETPLACE_DEFAULTS } = require('../../config/marketplaceDefaults');
const { toPaise, isPositiveIntQuantity } = require('../../validators/marketplace');
const { presentCustomerOrder, copyWindow } = require('./customerOrderView');
const { appendEvent } = require('./orderEvents');
const { isPoolEnabled, allocateInTransaction } = require('../orderNumberPool');
const displayIdService = require('../displayIdService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function httpError(status, code, message, extra) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (extra) {
    Object.assign(error, extra);
  }
  return error;
}

function rupeesFromPaise(paise) {
  if (!Number.isInteger(paise)) {
    throw new TypeError('paise must be an integer');
  }
  return Number((paise / 100).toFixed(2));
}

function orderIdFor(customerId, idempotencyKey) {
  return crypto.createHash('sha256').update(`${customerId}:${idempotencyKey}`).digest('hex');
}

function lockIdFor(customerId, shopId) {
  return `${customerId}_${shopId}`;
}

function validateCreateInput(idempotencyKey, body) {
  const payload = body && typeof body === 'object' ? body : {};
  if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey.trim())) {
    return { ok: false, message: 'Idempotency-Key must be a UUID' };
  }
  if (typeof payload.shopId !== 'string' || payload.shopId.trim() === '') {
    return { ok: false, message: 'shopId is required' };
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return { ok: false, message: 'items must be a non-empty array' };
  }
  if (payload.customerNote !== undefined && payload.customerNote !== null) {
    if (typeof payload.customerNote !== 'string' || payload.customerNote.length > 300) {
      return { ok: false, message: 'customerNote must be at most 300 characters' };
    }
  }
  if (payload.riderNotes !== undefined && payload.riderNotes !== null) {
    if (typeof payload.riderNotes !== 'string' || payload.riderNotes.length > 200) {
      return { ok: false, message: 'riderNotes must be at most 200 characters' };
    }
  }
  if (payload.riderNoteText !== undefined && payload.riderNoteText !== null) {
    if (typeof payload.riderNoteText !== 'string' || payload.riderNoteText.length > 200) {
      return { ok: false, message: 'riderNoteText must be at most 200 characters' };
    }
  }
  if (typeof payload.addressId !== 'string' || payload.addressId.trim() === '') {
    return { ok: false, message: 'addressId is required' };
  }
  for (const item of payload.items) {
    if (!item || typeof item.productId !== 'string' || item.productId.trim() === '') {
      return { ok: false, message: 'each item needs a productId' };
    }
    if (item.variantId !== undefined && item.variantId !== null && typeof item.variantId !== 'string') {
      return { ok: false, message: 'variantId must be a string' };
    }
    if (!isPositiveIntQuantity(item.qty)) {
      return { ok: false, message: 'qty must be a positive integer' };
    }
    if (typeof item.price !== 'number' || !Number.isFinite(item.price)) {
      return { ok: false, message: 'price must be a finite number' };
    }
  }
  return { ok: true };
}

function readLimits(settingsData) {
  const source = settingsData && typeof settingsData === 'object' ? settingsData : {};
  function pick(key) {
    return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : MARKETPLACE_DEFAULTS[key];
  }
  return {
    maxLines: Number(pick('MAX_ORDER_LINES')),
    maxQty: Number(pick('MAX_QTY_PER_LINE')),
    maxUnpaid: Number(pick('MAX_UNPAID_ORDERS_PER_CUSTOMER')),
    timeoutMs: Number(pick('PAYMENT_TIMEOUT_MS')),
    policyGroupA: pick('POLICY_GROUP_A')
  };
}

function currentLinePrice(product, variant) {
  if (variant && typeof variant.priceOverride === 'number') {
    return variant.priceOverride;
  }
  return product.price;
}

function currentLineStock(product, variant) {
  if (variant) {
    return Number(variant.stock) || 0;
  }
  return Number(product.stock) || 0;
}

function lineCurrent(product, variant) {
  if (!product) {
    return { price: null, stock: null };
  }
  return {
    price: currentLinePrice(product, variant),
    stock: currentLineStock(product, variant)
  };
}

function classifyOrderLines(items, productsById, shopId) {
  const badLines = [];
  const goodLines = [];
  items.forEach((item) => {
    const variantId = typeof item.variantId === 'string' && item.variantId.trim() !== ''
      ? item.variantId
      : null;
    const product = productsById.get(item.productId) || null;
    const variants = product && Array.isArray(product.variants) ? product.variants : [];
    const variant = variantId ? variants.find((row) => row.id === variantId) : null;
    const base = { productId: item.productId, variantId };

    if (!product || product.shopId !== shopId || product.isActive === false) {
      badLines.push({ ...base, reason: 'inactive', current: lineCurrent(product, null) });
      return;
    }
    if (variantId && !variant) {
      badLines.push({ ...base, reason: 'inactive', current: lineCurrent(product, null) });
      return;
    }
    if (!variantId && product.hasVariants === true) {
      badLines.push({ ...base, reason: 'inactive', current: lineCurrent(product, null) });
      return;
    }

    const price = currentLinePrice(product, variant);
    const stock = currentLineStock(product, variant);
    const current = { price, stock };
    if (toPaise(item.price) !== toPaise(price)) {
      badLines.push({ ...base, reason: 'price', current });
      return;
    }
    if (item.qty > stock) {
      badLines.push({ ...base, reason: 'stock', current });
      return;
    }
    goodLines.push({
      productId: item.productId,
      variantId,
      name: typeof product.name === 'string' ? product.name : '',
      price,
      qty: item.qty,
      linePaise: toPaise(price) * item.qty
    });
  });
  return { badLines, goodLines };
}

function storedOrderItems(goodLines) {
  return goodLines.map((line, index) => ({
    id: `line${index}`,
    productId: line.productId,
    variantId: line.variantId,
    name: line.name,
    price: line.price,
    qty: line.qty
  }));
}

function sumItemsTotalPaise(goodLines) {
  return goodLines.reduce((sum, line) => sum + line.linePaise, 0);
}

const UNPAID_AMOUNT_STATUSES = ['awaiting_payment', 'payment_unconfirmed'];

function occupiedExpectedPaise(data) {
  if (data && Number.isInteger(data.expectedAmountPaise)) {
    return data.expectedAmountPaise;
  }
  if (data && data.itemsTotal != null && Number.isFinite(Number(data.itemsTotal))) {
    return toPaise(data.itemsTotal);
  }
  return null;
}

function blockingExpectedPaise(orders) {
  return (Array.isArray(orders) ? orders : [])
    .filter((order) => order && UNPAID_AMOUNT_STATUSES.includes(order.orderStatus))
    .map((order) => occupiedExpectedPaise(order));
}

function chooseAmountAdjustment(itemsTotalPaise, occupiedPaise) {
  const taken = new Set(occupiedPaise.filter((value) => Number.isInteger(value)));
  for (let amountAdjustmentPaise = 0; amountAdjustmentPaise <= 99; amountAdjustmentPaise += 1) {
    const expectedAmountPaise = itemsTotalPaise - amountAdjustmentPaise;
    if (expectedAmountPaise <= 0) {
      continue;
    }
    if (!taken.has(expectedAmountPaise)) {
      return {
        amountAdjustmentPaise,
        expectedAmountPaise,
        expectedAmount: rupeesFromPaise(expectedAmountPaise)
      };
    }
  }
  return null;
}

function policyGroupFor(shopType, policyGroupA) {
  const list = Array.isArray(policyGroupA) ? policyGroupA : [];
  return list.includes(shopType) ? 'A' : 'B';
}

function istParts(now) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = {};
  formatter.formatToParts(now).forEach((part) => {
    parts[part.type] = part.value;
  });
  let hour = Number(parts.hour);
  if (hour === 24) {
    hour = 0;
  }
  const minute = Number(parts.minute);
  return {
    weekday: String(parts.weekday || '').toLowerCase(),
    minutes: (hour * 60) + minute
  };
}

function parseClock(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!match) {
    return null;
  }
  return (Number(match[1]) * 60) + Number(match[2]);
}

function isShopOpenNow({ isOpen, openingHours, now = new Date() }) {
  if (isOpen !== true) {
    return false;
  }
  if (openingHours == null) {
    return true;
  }
  if (typeof openingHours !== 'object' || Array.isArray(openingHours)) {
    return false;
  }
  const clock = istParts(now);
  const today = openingHours[clock.weekday];
  if (!today || typeof today !== 'object') {
    return false;
  }
  const start = parseClock(today.start);
  const end = parseClock(today.end);
  if (start == null || end == null) {
    return false;
  }
  if (end >= start) {
    return clock.minutes >= start && clock.minutes < end;
  }
  return clock.minutes >= start || clock.minutes < end;
}

function addressText(address) {
  const candidates = [address.text, address.address, address.addressLine, address.fullAddress];
  const found = candidates.find((value) => typeof value === 'string' && value.trim() !== '');
  return found ? found.trim() : '';
}

function addressCoordinates(address) {
  const coords = address.coordinates || address.location;
  const lat = coords && typeof coords.latitude === 'number'
    ? coords.latitude
    : Number(address.lat ?? address.latitude);
  const lng = coords && typeof coords.longitude === 'number'
    ? coords.longitude
    : Number(address.lng ?? address.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return new GeoPoint(lat, lng);
}

function mixDisplayId(counter, timestamp, customerId) {
  const timestampSeed = timestamp % 99989;
  const customerSeed = displayIdService.generateHash(customerId) % 99989;
  const combinedSeed = (timestampSeed + customerSeed) % 99989;
  return ((counter + combinedSeed) % 89999) + 10000;
}

function isoStamp(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function paymentDetailsFromStored(data) {
  const payment = data && data.payment ? data.payment : {};
  const balance = payment.balance && typeof payment.balance === 'object' ? payment.balance : null;
  const short = payment.status === 'short' && balance;
  const details = {
    upiId: payment.shopUpiId ?? null,
    expectedAmount: short ? (balance.amount ?? null) : (data ? data.expectedAmount ?? null : null),
    expectedAmountPaise: short ? (balance.amountPaise ?? null) : (data ? data.expectedAmountPaise ?? null : null),
    verifiedPayeeName: data ? data.verifiedPayeeName ?? null : null,
    window: copyWindow(data ? data.window : null)
  };
  if (short) {
    details.dueBy = isoStamp(balance.dueBy);
  }
  return details;
}

function successBody(id, data) {
  return {
    success: true,
    data: {
      order: presentCustomerOrder({ id, ...data }),
      paymentDetails: paymentDetailsFromStored(data)
    }
  };
}

function generateHandoverOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function createMarketplaceOrder({ customerId, idempotencyKey, body }) {
  const validation = validateCreateInput(idempotencyKey, body);
  if (!validation.ok) {
    throw httpError(400, 'VALIDATION', validation.message);
  }

  const db = getFirestore();
  const resolvedOrderId = orderIdFor(customerId, idempotencyKey.trim());
  const orderRef = db.collection('marketplaceOrders').doc(resolvedOrderId);
  const shopId = body.shopId.trim();
  const lockRef = db.collection('marketplaceLocks').doc(lockIdFor(customerId, shopId));

  const created = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (orderSnap.exists) {
      return { replay: true, data: orderSnap.data() || {} };
    }

    const lockSnap = await tx.get(lockRef);
    if (lockSnap.exists) {
      const locked = lockSnap.data() || {};
      throw httpError(409, 'UNPAID_ORDER_EXISTS', 'You already have an unpaid order at this shop', {
        orderId: locked.orderId || null
      });
    }

    const customerRef = db.collection('users').doc(customerId);
    const shopUserRef = db.collection('users').doc(shopId);
    const shopRef = db.collection('shops').doc(shopId);
    const settingsRef = db.collection('appSettings').doc('marketplace');
    const customerSnap = await tx.get(customerRef);
    const shopUserSnap = await tx.get(shopUserRef);
    const shopSnap = await tx.get(shopRef);
    const settingsSnap = await tx.get(settingsRef);

    if (!customerSnap.exists) {
      throw httpError(400, 'VALIDATION', 'Customer not found');
    }
    const customerData = customerSnap.data() || {};
    const marketplaceProfile = customerData.customer && customerData.customer.marketplace
      ? customerData.customer.marketplace
      : {};
    if (marketplaceProfile.restriction && marketplaceProfile.restriction.active === true) {
      throw httpError(403, 'ACCOUNT_RESTRICTED', 'This account cannot place marketplace orders');
    }

    const limits = readLimits(settingsSnap.exists ? settingsSnap.data() : null);
    const unpaidCount = Number(marketplaceProfile.unpaidCount) || 0;
    if (unpaidCount >= limits.maxUnpaid) {
      throw httpError(409, 'TOO_MANY_UNPAID', 'Too many unpaid marketplace orders');
    }
    if (body.items.length > limits.maxLines) {
      throw httpError(400, 'VALIDATION', `items cannot exceed ${limits.maxLines}`);
    }
    if (body.items.some((item) => item.qty > limits.maxQty)) {
      throw httpError(400, 'VALIDATION', `qty cannot exceed ${limits.maxQty}`);
    }

    const addresses = customerData.customer && Array.isArray(customerData.customer.addresses)
      ? customerData.customer.addresses
      : [];
    const address = addresses.find((row) => row && row.id === body.addressId);
    if (!address) {
      throw httpError(400, 'VALIDATION', 'addressId was not found');
    }

    const shopUser = shopUserSnap.exists ? (shopUserSnap.data() || {}) : null;
    const shopIdentity = shopUser && shopUser.shop ? shopUser.shop : {};
    if (!shopUser || shopUser.userType !== 'shop' || shopUser.isActive === false || shopIdentity.approvalStatus !== 'approved' || !shopSnap.exists) {
      throw httpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
    }
    const shopProfile = shopSnap.data() || {};
    const openingHours = shopProfile.storefront && shopProfile.storefront.openingHours !== undefined
      ? shopProfile.storefront.openingHours
      : null;
    if (!isShopOpenNow({ isOpen: shopIdentity.isOpen === true, openingHours })) {
      throw httpError(409, 'SHOP_CLOSED', 'Shop is closed');
    }
    const bank = shopProfile.bank || {};
    const verifiedPayeeName = bank.upiNameVerification && typeof bank.upiNameVerification.verifiedName === 'string'
      ? bank.upiNameVerification.verifiedName.trim()
      : '';
    if (!verifiedPayeeName) {
      throw httpError(409, 'UPI_NOT_VERIFIED', 'Shop UPI name is not verified');
    }
    const shopUpiId = typeof bank.upiId === 'string' ? bank.upiId : '';

    const productIds = [...new Set(body.items.map((item) => item.productId))];
    const productSnaps = [];
    for (const productId of productIds) {
      productSnaps.push(await tx.get(db.collection('products').doc(productId)));
    }
    const productsById = new Map();
    productSnaps.forEach((snap) => {
      if (snap.exists) {
        productsById.set(snap.id, snap.data() || {});
      }
    });
    const classified = classifyOrderLines(body.items, productsById, shopId);
    if (classified.badLines.length > 0) {
      throw httpError(409, 'ITEMS_CHANGED', 'One or more items changed', {
        lines: classified.badLines
      });
    }

    const awaitingSnap = await tx.get(db.collection('marketplaceOrders')
      .where('shopId', '==', shopId)
      .where('orderStatus', 'in', UNPAID_AMOUNT_STATUSES));
    const occupied = blockingExpectedPaise(awaitingSnap.docs.map((doc) => doc.data()));
    const itemsTotalPaise = sumItemsTotalPaise(classified.goodLines);
    const adjustment = chooseAmountAdjustment(itemsTotalPaise, occupied);
    if (!adjustment) {
      throw httpError(409, 'SHOP_BUSY', 'This shop has too many unpaid orders at this amount');
    }

    const nowMs = Date.now();
    let displayId;
    if (isPoolEnabled()) {
      displayId = await allocateInTransaction(tx, db, {
        kind: 'shop_order',
        refId: resolvedOrderId
      });
    } else {
      const counterRef = db.collection('system_counters').doc(displayIdService.marketplaceCounterDoc);
      const counterSnap = await tx.get(counterRef);
      let counter;
      if (!counterSnap.exists) {
        counter = 1;
        tx.set(counterRef, {
          nextValue: 1,
          lastUpdated: new Date(),
          totalGenerated: 0
        });
      } else {
        const counterData = counterSnap.data() || {};
        counter = counterData.nextValue || 0;
        tx.update(counterRef, {
          nextValue: counter + 1,
          lastUpdated: new Date(),
          totalGenerated: (counterData.totalGenerated || 0) + 1
        });
      }
      displayId = mixDisplayId(counter, nowMs, customerId);
    }

    const itemsTotal = rupeesFromPaise(itemsTotalPaise);
    const now = Timestamp.fromMillis(nowMs);
    const orderData = {
      shopId,
      customerId,
      items: storedOrderItems(classified.goodLines),
      itemsTotal,
      itemsTotalPaise,
      deliveryFee: 0,
      expectedAmount: adjustment.expectedAmount,
      expectedAmountPaise: adjustment.expectedAmountPaise,
      amountAdjustmentPaise: adjustment.amountAdjustmentPaise,
      deliveryAddress: {
        addressId: body.addressId,
        text: addressText(address),
        coordinates: addressCoordinates(address)
      },
      orderStatus: 'awaiting_payment',
      paymentMethod: 'upi',
      payment: {
        status: 'pending',
        shopUpiId,
        amount: itemsTotal,
        transactionReference: resolvedOrderId,
        customerUtr: null,
        customerUpiId: null,
        initiatedAt: null,
        confirmedAt: null,
        expiredAt: null,
        refundedAt: null,
        confirmedByShopUid: null
      },
      cancellation: {
        reason: null,
        cancelledAt: null,
        cancelledBy: null
      },
      window: {
        start: Timestamp.fromMillis(nowMs),
        end: Timestamp.fromMillis(nowMs + limits.timeoutMs)
      },
      verifiedPayeeName,
      policyGroup: policyGroupFor(shopIdentity.shopType, limits.policyGroupA),
      shopSnapshot: {
        name: typeof shopIdentity.shopName === 'string' ? shopIdentity.shopName : '',
        category: typeof shopIdentity.shopType === 'string' ? shopIdentity.shopType : '',
        phone: typeof shopUser.phone === 'string' ? shopUser.phone : null
      },
      customerNote: typeof body.customerNote === 'string' ? body.customerNote : null,
      riderNotes: typeof body.riderNotes === 'string' ? body.riderNotes : null,
      riderNoteText: typeof body.riderNoteText === 'string' ? body.riderNoteText : null,
      linkedBookingId: null,
      driverInfo: null,
      displayId,
      createdAt: now,
      updatedAt: now
    };

    tx.set(orderRef, orderData);
    tx.set(orderRef.collection('private').doc('handover'), { otp: generateHandoverOtp() });
    tx.set(lockRef, { orderId: resolvedOrderId, createdAt: now });
    tx.update(customerRef, {
      'customer.marketplace.unpaidCount': FieldValue.increment(1),
      updatedAt: now
    });
    appendEvent(tx, orderRef, {
      type: 'created',
      actor: { type: 'customer', id: customerId },
      data: { orderId: resolvedOrderId, shopId }
    }, customerId);
    appendEvent(tx, orderRef, {
      type: 'payment_details_issued',
      actor: { type: 'system', id: 'marketplace' },
      data: {
        expectedAmount: adjustment.expectedAmount,
        expectedAmountPaise: adjustment.expectedAmountPaise,
        upiId: shopUpiId
      }
    }, customerId);

    return { replay: false, data: orderData, shopId, displayId };
  });

  if (!created.replay) {
    try {
      const notificationService = require('../notificationService');
      await notificationService.sendTemplateNotification(created.shopId, 'MARKETPLACE', 'INCOMING_PAYMENT', {
        displayId: displayIdService.formatDisplayId(created.displayId),
        orderId: resolvedOrderId,
        expectedAmount: created.data.expectedAmount
      });
    } catch (error) {
      console.error('❌ [MARKETPLACE_ORDER] Shop notification failed:', error.message);
    }
  }

  return {
    status: created.replay ? 200 : 201,
    body: successBody(resolvedOrderId, created.data)
  };
}

module.exports = {
  httpError,
  rupeesFromPaise,
  orderIdFor,
  validateCreateInput,
  classifyOrderLines,
  storedOrderItems,
  sumItemsTotalPaise,
  UNPAID_AMOUNT_STATUSES,
  chooseAmountAdjustment,
  occupiedExpectedPaise,
  blockingExpectedPaise,
  policyGroupFor,
  isShopOpenNow,
  paymentDetailsFromStored,
  successBody,
  createMarketplaceOrder
};
