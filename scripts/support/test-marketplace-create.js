/**
 * Staging test for marketplace order create. Calls createMarketplaceOrder
 * directly. Dry run is the default and writes nothing.
 *
 * Usage:
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id>
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --apply
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --cleanup [--order <id>]
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --cleanup --apply [--order <id>]
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --utr [12-digits] [--order <id>]
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --balance-utr <12-digits>
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --cancel
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --confirm [--order <id>] [--enforce] [--full-utr <12-digits>] [--fulfil false]
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --payment-not-found [--order <id>]
 *
 * --utr, --balance-utr, --cancel, --confirm, --amount-differs, and --payment-not-found
 * use the order on marketplaceLocks/{customer}_{shop}, unless --order <id> is set.
 * --order is required once the lock is gone (payment_unconfirmed or payment_review).
 * --utr without a value uses 123456789012. Dry run prints that order and
 * does not write. Add --apply to call submitCustomerUtr or cancelCustomerOrder.
 * --balance-utr dry run prints the last 4 and writes nothing. --apply calls submitBalanceUtr.
 * --cancel on a short order prints refundAmount from the received amount on a
 * dry run, and from the amount_short_cancel stub after --apply.
 * --confirm dry run prints utrLast4. On a short order that is the last 4 of
 * balance.utr. --full-utr sends that 12-digit value instead. --confirm --apply
 * calls confirmPayment. A short confirm needs --enforce. The confirm result
 * prints officialUtrLast4 for the first payment and balanceOfficialUtrLast4
 * for the balance match.
 * --amount-differs <rupees> [--order <id>] dry run prints utrLast4 and the body and
 * writes nothing. --amount-differs <rupees> --apply calls the service.
 * --payment-not-found [--order <id>] [--apply] calls reportNotFound.
 * --set-stock <n> --product <productId> [--variant <id>] prints current stock
 * then the new stock. Dry run writes nothing. --apply calls updateStock for
 * this shop only and sets that stock absolutely.
 * --mark-unavailable --order <id> --item-ids line0,line1 prints the lines.
 * Dry run writes nothing. --apply calls markUnavailable.
 * --shop-cancel --order <id> --reason "text" prints whether stock would be
 * restored. Dry run writes nothing. --apply calls shopOrderService.cancelOrder.
 * --items productId:qty,productId:qty builds the create body from those
 * active products at the current price (variantId when the product has one).
 * Dry run prints the lines and writes nothing. --apply sends that body.
 * --enforce on that call uses new statuses. Without it, live settings apply.
 * --confirm dry run also prints stockBefore, units, and stockAfter.
 * --show prints each line's live stock, stockDeducted, stockRestored,
 * unavailable, and the order stockShort. UTR stays last 4.
 * --confirm --fulfil false sends fulfil:false.
 * --evidence <local-file> --order <id> [--idempotency-key <uuid>] [--apply]
 * uploads one jpg or png. Dry run prints bytes and image type. Apply prints
 * evidenceId and the key. The same key returns the same id.
 * --payment-report --order <id> --utr <12-digits> [--note <text>]
 * [--evidence-ids <id,id>] [--apply] prints the UTR last 4, note length, and
 * id count. It does not print the note.
 * --enforce passes { newStatuses: true, utrBlocksReject: true } into that
 * call only. It does not write appSettings.
 * --tick runs the payment job for this customer and shop only. Dry run
 * prints the actions and writes nothing. --tick --apply runs one tick.
 * --now <ISO> or --advance-minutes <N> sets the comparison clock. Timestamps
 * written by the job still use the server clock. --tick --enforce passes
 * { newStatuses: true } and does not write appSettings.
 * --show --order <id> reads that order and writes nothing. --apply is ignored.
 * It also prints readyAt, delivery.stage, delivery.fare, deliveryFee,
 * linkedBookingId, and the linked booking displayId, status, and fare.totalFare.
 * --mark-ready --order <id> [--apply] marks the order ready. Dry run writes
 * nothing and prints "driver notify skipped". --notify-drivers is off unless
 * that flag is passed. Do not pass it until driver pushes are approved.
 * --sync-booking --order <id> --booking-status <status> [--apply] runs the
 * listener sync against an in-memory booking. It does not write the booking.
 * --handover --order <id> [--apply] reads the private handover OTP and calls
 * confirmHandover in this process. Dry run writes nothing. The OTP is never
 * printed (otp: ***).
 * Timestamps are ISO. UTR values are the last 4 only.
 * --refund-upi <upiId> --refund <refundId> --order <id> [--save] calls
 * submitCustomerUpi with upiId and upiIdConfirm set to the same value.
 * --refund-ack yes|no --refund <refundId> --order <id> calls acknowledgeRefund.
 * Both are dry-run unless --apply. Logs show the UPI handle only (***@ybl).
 * --legacy-refund-sent --order <id> calls shopOrderService.refundSent with no
 * enforcement override, the same as POST /api/shop/orders/:id/refund-sent.
 *
 * --apply case order. The price case is first, on this shop, so the unpaid
 * lock is not written yet:
 *   1. new key, wrong price → ITEMS_CHANGED reason price
 *   2. new key, qty 1, current price (variantId when the product has one) → 201
 *   3. same key → 200, same order, unpaidCount unchanged
 *   4. new key, same shop → UNPAID_ORDER_EXISTS
 *
 * --cleanup prints the lock, order, events, refunds subcollection, private/handover,
 * and every utrRegistry doc whose orderId is this order, including kind refund.
 * Lookup is --order <id>,
 * else the lock. With neither, it prints the 5 newest orders for this
 * customer and shop and deletes nothing. --cleanup --apply deletes the
 * chosen order only. unpaidCount is decremented when the matching lock
 * is deleted and the count is greater than 0, whatever the order status.
 * An awaiting_payment order with no lock still decrements when the count
 * is greater than 0. orderNumbers is left in place. Dry run is the default.
 */

require('dotenv').config();

const crypto = require('crypto');
const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const {
  chooseCleanupTarget,
  recentOrdersForCleanup,
  shouldDecrementUnpaid
} = require('./marketplaceCleanupRules');
const {
  confirmRequestBody,
  shortCancelRefundPreview,
  buildOrderShow,
  resolveCreateItems,
  assertStagingPair,
  markReadyNotifiesDrivers
} = require('./marketplaceStagingActions');

assertStagingEnv();

function maskUpi(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) {
    return '***';
  }
  return `***${value.slice(at)}`;
}

async function requireOwnedOrder(db, customerId, shopId, orderId) {
  if (!orderId) {
    console.error('Needs --order <id>. Nothing was written.');
    process.exit(1);
  }
  const snap = await db.collection('marketplaceOrders').doc(orderId).get();
  if (!snap.exists) {
    console.error('Order not found. Nothing was written.');
    process.exit(1);
  }
  const data = snap.data() || {};
  if (data.customerId !== customerId || data.shopId !== shopId) {
    console.error('That order does not belong to this customer and shop. Nothing was written.');
    process.exit(1);
  }
  return data;
}

function liveStock(product, line) {
  if (!product) {
    return null;
  }
  if (line.variantId && Array.isArray(product.variants)) {
    const variant = product.variants.find((row) => row.id === line.variantId);
    return variant ? (variant.stock ?? null) : null;
  }
  return product.stock ?? null;
}

async function productMap(db, items, shopId) {
  const wanted = new Set();
  const rows = Array.isArray(items) ? items : [];
  rows.forEach((line) => {
    if (line && line.productId) {
      wanted.add(line.productId);
    }
  });
  const products = new Map();
  if (!shopId || wanted.size === 0) {
    return products;
  }
  const snap = await db.collection('products').where('shopId', '==', shopId).get();
  snap.docs.forEach((doc) => {
    if (wanted.has(doc.id)) {
      products.set(doc.id, doc.data() || {});
    }
  });
  return products;
}

function stockLineView(line, product) {
  return {
    id: line.id ?? null,
    productId: line.productId ?? null,
    variantId: line.variantId ?? null,
    qty: line.qty ?? null,
    stock: liveStock(product, line),
    stockDeducted: typeof line.stockDeducted === 'number' ? line.stockDeducted : null,
    stockRestored: line.stockRestored === true,
    unavailable: line.unavailable === true
  };
}

async function previewOrderStock(db, orderId, shopId) {
  const { previewDeduction } = require('../../src/services/marketplace/stock');
  const snap = await db.collection('marketplaceOrders').doc(orderId).get();
  if (!snap.exists) {
    return null;
  }
  const items = Array.isArray(snap.data().items) ? snap.data().items : [];
  if (items.some((line) => typeof line.stockDeducted === 'number')) {
    return {
      alreadyDeducted: true,
      lines: items.map((line) => stockLineView(line, null))
    };
  }
  const products = await productMap(db, items, shopId);
  const preview = previewDeduction(items, products);
  return {
    alreadyDeducted: false,
    lines: preview.lines.map((line) => {
      const product = line.productId ? products.get(line.productId) : null;
      const before = liveStock(product, line);
      return {
        id: line.id,
        productId: line.productId,
        variantId: line.variantId,
        qty: line.qty,
        stockBefore: before,
        units: line.stockDeducted,
        stockAfter: typeof before === 'number' ? before - line.stockDeducted : null
      };
    })
  };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) {
    return '';
  }
  return next;
}

function plain(value) {
  if (value == null) {
    return value;
  }
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    return { lat: value.latitude, lng: value.longitude };
  }
  if (Array.isArray(value)) {
    return value.map(plain);
  }
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      if (key === 'handoverOtp' || key === 'otp' || key === 'accountNumberEncrypted' || key === 'passwordHash') {
        out[key] = '[redacted]';
        return;
      }
      out[key] = plain(value[key]);
    });
    return out;
  }
  return value;
}

function istClock(now = new Date()) {
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
  const pad = (value) => String(value).padStart(2, '0');
  return {
    weekday: String(parts.weekday || '').toLowerCase(),
    time: `${pad(hour)}:${pad(minute)}`
  };
}

function openingHoursCheck(isOpen, openingHours, isShopOpenNow) {
  const clock = istClock();
  const openNow = isShopOpenNow({ isOpen, openingHours });
  let reason = 'inside today\'s opening window';
  if (isOpen !== true) {
    reason = 'isOpen is not true, so the shop is closed before hours are checked';
  } else if (openingHours == null) {
    reason = 'openingHours is absent and isOpen is true, so the shop is open';
  } else if (!openNow) {
    reason = 'openingHours are present and the current Asia/Kolkata time is outside today\'s window, or today\'s hours cannot be read';
  }
  return {
    nowIst: clock,
    isOpen,
    openingHours: openingHours || null,
    openNow,
    reason
  };
}

function addressSummary(address) {
  const row = address || {};
  return {
    id: row.id || null,
    text: row.text || row.address || row.addressLine || row.fullAddress || null,
    hasCoordinates: Boolean(row.coordinates || row.location || row.lat || row.latitude)
  };
}

function variantSummary(variant) {
  return {
    id: variant.id,
    value: variant.value || null,
    priceOverride: variant.priceOverride ?? null,
    stock: variant.stock ?? null
  };
}

function productSummary(id, data) {
  const variants = Array.isArray(data.variants) ? data.variants : [];
  return {
    id,
    name: data.name || null,
    isActive: data.isActive !== false,
    price: data.price ?? null,
    stock: data.stock ?? null,
    hasVariants: data.hasVariants === true,
    variants: variants.map(variantSummary)
  };
}

function currentOffer(product) {
  if (product.hasVariants && product.variants.length > 0) {
    const variant = product.variants.find((row) => Number(row.stock) >= 1) || product.variants[0];
    const price = typeof variant.priceOverride === 'number' ? variant.priceOverride : product.price;
    return {
      productId: product.id,
      variantId: variant.id,
      qty: 1,
      price,
      stock: Number(variant.stock) || 0
    };
  }
  return {
    productId: product.id,
    qty: 1,
    price: product.price,
    stock: Number(product.stock) || 0
  };
}

function lineFromOffer(offer, price) {
  const line = {
    productId: offer.productId,
    qty: 1,
    price
  };
  if (offer.variantId) {
    line.variantId = offer.variantId;
  }
  return line;
}

async function loadContext(db, customerId, shopId, isShopOpenNow) {
  const [customerSnap, shopUserSnap, shopSnap, productsSnap] = await Promise.all([
    db.collection('users').doc(customerId).get(),
    db.collection('users').doc(shopId).get(),
    db.collection('shops').doc(shopId).get(),
    db.collection('products').where('shopId', '==', shopId).get()
  ]);

  const customer = customerSnap.exists ? (customerSnap.data() || {}) : null;
  const addresses = customer && customer.customer && Array.isArray(customer.customer.addresses)
    ? customer.customer.addresses
    : [];
  const shopUser = shopUserSnap.exists ? (shopUserSnap.data() || {}) : null;
  const identity = shopUser && shopUser.shop ? shopUser.shop : {};
  const shop = shopSnap.exists ? (shopSnap.data() || {}) : null;
  const bank = shop && shop.bank ? shop.bank : {};
  const { shopOpenToggleIsOn, openingHoursFromShopProfile } = require('../../src/utils/shopOpeningHours');
  const openingHours = openingHoursFromShopProfile(shop);
  const isOpen = shopOpenToggleIsOn(identity);
  const products = productsSnap.docs
    .map((doc) => productSummary(doc.id, doc.data() || {}))
    .filter((row) => row.isActive);
  const offer = products.map(currentOffer).find((row) => row.stock >= 1) || null;

  return {
    customerExists: Boolean(customer),
    addresses: addresses.map(addressSummary),
    unpaidCount: customer && customer.customer && customer.customer.marketplace
      ? (customer.customer.marketplace.unpaidCount || 0)
      : 0,
    shop: {
      shopDocExists: Boolean(shop),
      userType: shopUser ? shopUser.userType : null,
      isActive: shopUser ? shopUser.isActive !== false : false,
      approvalStatus: identity.approvalStatus || null,
      isOpen,
      shopType: identity.shopType || null,
      shopName: identity.shopName || null,
      upiId: typeof bank.upiId === 'string' ? bank.upiId : null,
      upiVerified: bank.upiVerified === true,
      upiNameVerification: bank.upiNameVerification ? plain(bank.upiNameVerification) : null,
      openingHours: plain(openingHours)
    },
    openingHoursCheck: openingHoursCheck(isOpen, openingHours, isShopOpenNow),
    products,
    line: offer ? lineFromOffer(offer, offer.price) : null,
    wrongPriceLine: offer ? lineFromOffer(offer, Number(offer.price) + 50) : null
  };
}

async function readUnpaidCount(db, customerId) {
  const snap = await db.collection('users').doc(customerId).get();
  const marketplace = snap.exists && snap.data().customer && snap.data().customer.marketplace;
  return marketplace && marketplace.unpaidCount ? marketplace.unpaidCount : 0;
}

async function paymentJobReport(db, shopId) {
  const settingsSnap = await db.collection('appSettings').doc('marketplace').get();
  const timeoutRaw = settingsSnap.exists ? settingsSnap.data().PAYMENT_TIMEOUT_MS : null;
  const timeoutMs = Number(timeoutRaw);
  const timeoutOk = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const cutoffMs = timeoutOk ? Date.now() - timeoutMs : null;
  const ordersSnap = await db.collection('marketplaceOrders').where('shopId', '==', shopId).get();
  const matching = [];
  ordersSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const paymentStatus = data.payment && data.payment.status;
    if (paymentStatus !== 'pending' && paymentStatus !== 'initiated') {
      return;
    }
    const createdAtMs = data.createdAt && typeof data.createdAt.toMillis === 'function'
      ? data.createdAt.toMillis()
      : null;
    matching.push({
      id: doc.id,
      orderStatus: data.orderStatus || null,
      paymentStatus,
      createdAt: createdAtMs == null ? null : new Date(createdAtMs).toISOString(),
      wouldExpireNow: timeoutOk && createdAtMs != null && createdAtMs < cutoffMs
    });
  });

  return {
    job: 'MarketplacePaymentTimeoutJob',
    query: "payment.status in ['pending', 'initiated'] AND createdAt < now - PAYMENT_TIMEOUT_MS",
    expireWrite: "orderStatus 'cancelled', payment.status 'expired', payment.expiredAt. Does not write cancellation. Does not expire customer_claimed.",
    timeoutMs: timeoutOk ? timeoutMs : null,
    cutoff: cutoffMs == null ? null : new Date(cutoffMs).toISOString(),
    shopMatches: matching,
    newOrderWouldExpireOnNextTick: false
  };
}

async function callCreate(createMarketplaceOrder, customerId, idempotencyKey, body) {
  try {
    const result = await createMarketplaceOrder({ customerId, idempotencyKey, body });
    return { ok: true, status: result.status, body: result.body };
  } catch (error) {
    return {
      ok: false,
      status: error.status || 500,
      code: error.code || null,
      message: error.message,
      lines: error.lines || null,
      orderId: error.orderId || null
    };
  }
}

async function printOutcome(db, customerId, shopId, orderId, displayId) {
  const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
  const privateSnap = await db.collection('marketplaceOrders').doc(orderId).collection('private').doc('handover').get();
  const lockSnap = await db.collection('marketplaceLocks').doc(`${customerId}_${shopId}`).get();
  const eventsSnap = await db.collection('marketplaceOrders').doc(orderId).collection('events').get();
  const registrySnap = displayId == null
    ? null
    : await db.collection('orderNumbers').doc(String(displayId)).get();

  console.log(JSON.stringify({
    order: orderSnap.exists ? plain(orderSnap.data()) : null,
    privateHandoverExists: privateSnap.exists,
    marketplaceLock: lockSnap.exists ? plain(lockSnap.data()) : null,
    unpaidCount: await readUnpaidCount(db, customerId),
    eventTypes: eventsSnap.docs.map((doc) => (doc.data() || {}).type || null),
    orderNumbers: registrySnap && registrySnap.exists ? plain(registrySnap.data()) : null
  }, null, 2));
}

async function recentOrders(db, customerId, shopId) {
  const snap = await db.collection('marketplaceOrders').where('customerId', '==', customerId).get();
  const orders = snap.docs.map((doc) => {
    const data = doc.data() || {};
    const createdAtMs = data.createdAt && typeof data.createdAt.toMillis === 'function'
      ? data.createdAt.toMillis()
      : 0;
    const createdAt = createdAtMs ? new Date(createdAtMs).toISOString() : null;
    return {
      id: doc.id,
      shopId: data.shopId,
      orderStatus: data.orderStatus,
      displayId: data.displayId == null ? null : data.displayId,
      createdAtMs,
      createdAt
    };
  });
  return recentOrdersForCleanup(orders, shopId, 5);
}

async function registryDocsForOrder(db, orderId) {
  const snap = await db.collection('utrRegistry').where('orderId', '==', orderId).get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    kind: (doc.data() || {}).kind || null
  }));
}

function presentCleanupPlan(plan) {
  return {
    foundBy: plan.foundBy,
    lockExists: plan.lockExists,
    deleteLock: plan.deleteLock,
    orderId: plan.orderId,
    orderOwned: plan.orderOwned,
    orderStatus: plan.orderStatus,
    eventCount: plan.eventCount,
    privateHandoverExists: plan.privateHandoverExists,
    displayId: plan.displayId,
    orderNumbersExists: plan.orderNumbersExists,
    refunds: plan.refundCount,
    refundRegistry: plan.refundRegistryCount,
    utrRegistry: plan.registryDocs.map((doc) => ({
      last4: String(doc.id).slice(-4),
      kind: doc.kind
    })),
    evidenceFileCount: plan.evidenceDocs.length,
    unpaidCount: plan.unpaidCount
  };
}

async function cleanupPlan(db, customerId, shopId, explicitOrderId) {
  const lockSnap = await db.collection('marketplaceLocks').doc(`${customerId}_${shopId}`).get();
  const lock = lockSnap.exists ? (lockSnap.data() || {}) : null;
  const lockOrderId = lock && lock.orderId ? lock.orderId : null;
  const picked = chooseCleanupTarget({ explicitOrderId, lockOrderId });
  const orderId = picked.orderId;
  const foundBy = picked.foundBy;
  const orderRef = orderId ? db.collection('marketplaceOrders').doc(orderId) : null;
  const orderSnap = orderRef ? await orderRef.get() : null;
  const order = orderSnap && orderSnap.exists ? (orderSnap.data() || {}) : null;
  const owned = Boolean(order && order.customerId === customerId && order.shopId === shopId);
  const eventsSnap = owned ? await orderRef.collection('events').get() : null;
  const refundsSnap = owned ? await orderRef.collection('refunds').get() : null;
  const privateSnap = owned ? await orderRef.collection('private').doc('handover').get() : null;
  const displayId = owned ? order.displayId : null;
  const registrySnap = displayId == null
    ? null
    : await db.collection('orderNumbers').doc(String(displayId)).get();
  const registryDocs = owned ? await registryDocsForOrder(db, orderId) : [];
  const evidenceSnap = owned
    ? await db.collection('evidenceUploads').where('orderId', '==', orderId).get()
    : null;
  const evidenceDocs = evidenceSnap
    ? evidenceSnap.docs.map((doc) => ({
      id: doc.id,
      path: typeof (doc.data() || {}).path === 'string' ? doc.data().path : null
    }))
    : [];
  const unpaidCount = await readUnpaidCount(db, customerId);
  const deleteLock = Boolean(owned && lockOrderId && lockOrderId === orderId);

  return {
    foundBy,
    lockExists: lockSnap.exists,
    deleteLock,
    orderId,
    linkedBookingId: owned && order.linkedBookingId ? order.linkedBookingId : null,
    orderOwned: owned,
    orderStatus: owned ? (order.orderStatus || null) : null,
    eventCount: eventsSnap ? eventsSnap.size : 0,
    refundCount: refundsSnap ? refundsSnap.size : 0,
    refundRegistryCount: registryDocs.filter((doc) => doc.kind === 'refund').length,
    privateHandoverExists: Boolean(privateSnap && privateSnap.exists),
    displayId: displayId == null ? null : displayId,
    orderNumbersExists: Boolean(registrySnap && registrySnap.exists),
    registryDocs,
    evidenceDocs,
    unpaidCount,
    decrementUnpaid: shouldDecrementUnpaid({
      deleteLock,
      orderStatus: owned ? (order.orderStatus || null) : null,
      unpaidCount
    })
  };
}

async function applyCleanup(db, customerId, shopId, plan) {
  const { FieldValue } = require('firebase-admin/firestore');
  const batch = db.batch();
  if (plan.orderOwned && plan.orderId) {
    const orderRef = db.collection('marketplaceOrders').doc(plan.orderId);
    const eventsSnap = await orderRef.collection('events').get();
    eventsSnap.docs.forEach((doc) => batch.delete(doc.ref));
    const refundsSnap = await orderRef.collection('refunds').get();
    refundsSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(orderRef.collection('private').doc('handover'));
    batch.delete(orderRef.collection('private').doc('paymentReport'));
    batch.delete(orderRef);
    if (plan.linkedBookingId) {
      batch.delete(db.collection('bookings').doc(plan.linkedBookingId));
    }
    const { getStorage } = require('../../src/services/firebase');
    const bucket = getStorage().bucket();
    for (const item of plan.evidenceDocs) {
      if (item.path) {
        try {
          await bucket.file(item.path).delete();
        } catch {
          console.error('Evidence file delete failed.');
        }
      }
      batch.delete(db.collection('evidenceUploads').doc(item.id));
    }
  }
  if (plan.deleteLock) {
    batch.delete(db.collection('marketplaceLocks').doc(`${customerId}_${shopId}`));
  }
  plan.registryDocs.forEach((doc) => {
    batch.delete(db.collection('utrRegistry').doc(doc.id));
  });
  if (plan.decrementUnpaid) {
    batch.update(db.collection('users').doc(customerId), {
      'customer.marketplace.unpaidCount': FieldValue.increment(-1)
    });
  }
  await batch.commit();
}

async function utrCancelPreview(db, customerId, shopId, utr, explicitOrderId) {
  const lockSnap = await db.collection('marketplaceLocks').doc(`${customerId}_${shopId}`).get();
  const lockOrderId = lockSnap.exists ? (lockSnap.data() || {}).orderId : null;
  const orderId = explicitOrderId || lockOrderId;
  let order = null;
  let owned = false;
  if (orderId) {
    const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
    if (orderSnap.exists) {
      const data = orderSnap.data() || {};
      owned = data.customerId === customerId && data.shopId === shopId;
      if (owned) {
        order = {
          id: orderId,
          orderStatus: data.orderStatus || null,
          paymentStatus: data.payment ? data.payment.status : null,
          hasCustomerUtr: Boolean(data.payment && data.payment.customerUtr)
        };
      }
    }
  }
  return {
    lockExists: lockSnap.exists,
    order,
    owned,
    explicitOrderId: explicitOrderId || null,
    utr
  };
}

async function printOrderShow(db, customerId, shopId, orderId) {
  const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
  if (!orderSnap.exists) {
    console.log(JSON.stringify({ show: true, wrote: false, orderId, exists: false }, null, 2));
    process.exitCode = 1;
    return;
  }
  const data = orderSnap.data() || {};
  if (data.customerId !== customerId || data.shopId !== shopId) {
    console.error('That order does not belong to this customer and shop. Nothing was written.');
    process.exitCode = 1;
    return;
  }
  const eventsSnap = await db.collection('marketplaceOrders').doc(orderId).collection('events').get();
  const refundsSnap = await db.collection('marketplaceOrders').doc(orderId).collection('refunds').get();
  const lockSnap = await db.collection('marketplaceLocks').doc(`${customerId}_${shopId}`).get();
  const lock = lockSnap.exists ? (lockSnap.data() || {}) : null;
  const items = Array.isArray(data.items) ? data.items : [];
  const products = await productMap(db, items, shopId);

  const delivery = data.delivery && typeof data.delivery === 'object' ? data.delivery : {};
  let booking = null;
  if (data.linkedBookingId) {
    const bookingSnap = await db.collection('bookings').doc(data.linkedBookingId).get();
    if (bookingSnap.exists) {
      const row = bookingSnap.data() || {};
      booking = {
        displayId: row.displayId ?? null,
        status: row.status ?? null,
        totalFare: row.fare && row.fare.totalFare != null ? row.fare.totalFare : null
      };
    }
  }

  console.log(JSON.stringify(buildOrderShow({
    orderId,
    data,
    events: eventsSnap.docs.map((doc) => doc.data()),
    refunds: refundsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
    lock,
    unpaidCount: await readUnpaidCount(db, customerId),
    lines: items.map((line) => stockLineView(line, line.productId ? products.get(line.productId) : null)),
    readyAt: plain(data.readyAt) || null,
    deliveryStage: delivery.stage || null,
    deliveryFare: delivery.fare ?? null,
    deliveryFee: data.deliveryFee ?? null,
    linkedBookingId: data.linkedBookingId || null,
    booking
  }), null, 2));
}

async function main() {
  const customerId = argValue('--customer');
  const shopId = argValue('--shop');
  const apply = process.argv.includes('--apply');
  const cleanup = process.argv.includes('--cleanup');
  if (!customerId || !shopId) {
    console.error('Usage: node scripts/support/test-marketplace-create.js --customer <id> --shop <id> [--apply] [--cleanup] [--order <id>] [--show --order <id>] [--set-stock <n> --product <productId>] [--variant <id>] [--items productId:qty,productId:qty] [--mark-unavailable --order <id> --item-ids line0,line1] [--shop-cancel --order <id> --reason text] [--utr [12-digits]] [--balance-utr <12-digits>] [--cancel] [--confirm] [--full-utr <12-digits>] [--fulfil false] [--payment-not-found] [--evidence <file> --order <id>] [--payment-report --order <id> --utr <12-digits>] [--enforce] [--amount-differs <rupees>] [--tick] [--refund-tick] [--refund-upi <upiId> --refund <refundId> --order <id>] [--save] [--refund-ack yes|no --refund <refundId> --order <id>] [--legacy-refund-sent --order <id>] [--now <ISO>] [--advance-minutes <N>]');
    process.exit(1);
  }
  const pair = assertStagingPair(customerId, shopId);
  if (!pair.ok) {
    console.error(pair.message);
    process.exit(1);
  }

  const { getFirestore } = require('../../src/services/firebase');
  const { isShopOpenNow } = require('../../src/services/marketplace/createCustomerOrder');
  const db = getFirestore();
  assertStagingAdmin();

  if (process.argv.includes('--show')) {
    const orderId = argValue('--order');
    if (!orderId) {
      console.error('--show needs --order <id>. Nothing was written.');
      process.exit(1);
    }
    await printOrderShow(db, customerId, shopId, orderId);
    return;
  }

  if (process.argv.includes('--mark-ready')) {
    const orderId = argValue('--order');
    const notifyDrivers = markReadyNotifiesDrivers(process.argv);
    const data = await requireOwnedOrder(db, customerId, shopId, orderId);
    console.log(JSON.stringify({
      markReady: true,
      apply,
      orderId,
      orderStatus: data.orderStatus || null,
      driverNotify: notifyDrivers ? 'requested' : 'driver notify skipped'
    }, null, 2));
    if (!apply) {
      const skipped = notifyDrivers ? '' : ' driver notify skipped';
      console.log(`Dry run. Re-run with --mark-ready --apply to mark ready.${skipped}`);
      return;
    }
    const shopOrderService = require('../../src/services/shopOrderService');
    try {
      const result = await shopOrderService.markReady(shopId, orderId, { notifyDrivers });
      const delivery = result.order.delivery || {};
      console.log(JSON.stringify({
        markedReady: true,
        alreadyProcessed: result.alreadyProcessed === true,
        orderStatus: result.order.orderStatus,
        linkedBookingId: result.order.linkedBookingId,
        deliveryFee: result.order.deliveryFee,
        stage: delivery.stage || null,
        driverNotify: notifyDrivers ? 'sent' : 'driver notify skipped'
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        markedReady: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--sync-booking')) {
    const orderId = argValue('--order');
    const bookingStatus = argValue('--booking-status');
    if (!orderId || !bookingStatus) {
      console.error('--sync-booking needs --order <id> and --booking-status <status>. Nothing was written.');
      process.exit(1);
    }
    const data = await requireOwnedOrder(db, customerId, shopId, orderId);
    let stored = {};
    if (data.linkedBookingId) {
      const bookingSnap = await db.collection('bookings').doc(data.linkedBookingId).get();
      if (bookingSnap.exists) {
        stored = bookingSnap.data() || {};
      }
    }
    const booking = {
      ...stored,
      status: bookingStatus,
      sourceType: 'marketplace',
      marketplaceOrderId: orderId
    };
    console.log(JSON.stringify({
      syncBooking: true,
      apply,
      orderId,
      bookingStatus,
      writesBooking: false
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --sync-booking --apply. The booking document is not written.');
      return;
    }
    const marketplaceSyncService = require('../../src/services/marketplaceSyncService');
    await marketplaceSyncService.syncBooking({
      bookingId: data.linkedBookingId || null,
      booking
    });
    console.log(JSON.stringify({
      synced: true,
      writesBooking: false,
      bookingStatus
    }, null, 2));
    return;
  }

  if (process.argv.includes('--handover')) {
    const orderId = argValue('--order');
    const data = await requireOwnedOrder(db, customerId, shopId, orderId);
    const privateSnap = await db.collection('marketplaceOrders').doc(orderId).collection('private').doc('handover').get();
    const storedOtp = privateSnap.exists ? (privateSnap.data() || {}).otp : null;
    const delivery = data.delivery && typeof data.delivery === 'object' ? data.delivery : {};
    console.log(JSON.stringify({
      handover: true,
      apply,
      orderId,
      orderStatus: data.orderStatus || null,
      stage: delivery.stage || null,
      displayId: data.displayId ?? null,
      otp: '***'
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --handover --apply to confirm handover. otp: ***');
      return;
    }
    if (storedOtp == null || storedOtp === '') {
      console.error('No handover OTP on this order. Nothing was written. otp: ***');
      process.exit(1);
    }
    const shopOrderService = require('../../src/services/shopOrderService');
    try {
      const result = await shopOrderService.confirmHandover(shopId, orderId, {
        otp: String(storedOtp),
        displayId: data.displayId
      });
      const resultDelivery = result.order.delivery || {};
      console.log(JSON.stringify({
        handedOver: true,
        alreadyProcessed: result.alreadyProcessed === true,
        orderStatus: result.order.orderStatus,
        stage: resultDelivery.stage || null,
        otp: '***'
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        handedOver: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message,
        otp: '***'
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--set-stock')) {
    const raw = argValue('--set-stock');
    const productId = argValue('--product');
    const variantId = argValue('--variant');
    const next = Number(raw);
    if (!productId || raw === '' || !Number.isInteger(next) || next < 0) {
      console.error('--set-stock needs --product <productId> and a whole number 0 or more. Nothing was written.');
      process.exit(1);
    }
    const productSnap = await db.collection('products').doc(productId).get();
    if (!productSnap.exists || (productSnap.data() || {}).shopId !== shopId) {
      console.error('That product does not belong to this shop. Nothing was written.');
      process.exit(1);
    }
    const product = productSnap.data() || {};
    let current = null;
    if (product.hasVariants === true) {
      if (!variantId) {
        console.error('This product has variants. Pass --variant <id>. Nothing was written.');
        process.exit(1);
      }
      const variant = (Array.isArray(product.variants) ? product.variants : []).find((row) => row.id === variantId);
      if (!variant) {
        console.error('Variant not found. Nothing was written.');
        process.exit(1);
      }
      current = variant.stock ?? null;
    } else {
      current = product.stock ?? null;
    }
    console.log(JSON.stringify({
      setStock: true,
      apply,
      productId,
      variantId: variantId || null,
      current,
      next,
      wrote: false
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --set-stock --apply to set stock.');
      return;
    }
    const shopCatalogueService = require('../../src/services/shopCatalogueService');
    const payload = product.hasVariants === true
      ? { variantId, stock: next }
      : { stock: next };
    await shopCatalogueService.updateStock(shopId, productId, payload);
    console.log(JSON.stringify({
      setStock: true,
      apply: true,
      productId,
      variantId: variantId || null,
      stock: next,
      wrote: true
    }, null, 2));
    return;
  }

  if (process.argv.includes('--mark-unavailable')) {
    const orderId = argValue('--order');
    const rawIds = argValue('--item-ids');
    const itemIds = rawIds.split(',').map((id) => id.trim()).filter(Boolean);
    if (!orderId || itemIds.length === 0) {
      console.error('--mark-unavailable needs --order <id> and --item-ids line0,line1. Nothing was written.');
      process.exit(1);
    }
    const data = await requireOwnedOrder(db, customerId, shopId, orderId);
    const items = Array.isArray(data.items) ? data.items : [];
    const products = await productMap(db, items, shopId);
    const lines = items.map((line, index) => {
      const id = line.id || `line${index}`;
      const view = stockLineView(line, line.productId ? products.get(line.productId) : null);
      return { ...view, id, selected: itemIds.includes(id) };
    });
    console.log(JSON.stringify({
      markUnavailable: true,
      apply,
      orderId,
      itemIds,
      lines,
      wrote: false
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --mark-unavailable --apply to mark lines unavailable.');
      return;
    }
    const shopOrderService = require('../../src/services/shopOrderService');
    try {
      const result = await shopOrderService.markUnavailable(shopId, orderId, { itemIds });
      console.log(JSON.stringify({
        markUnavailable: true,
        apply: true,
        alreadyProcessed: result.alreadyProcessed === true,
        orderStatus: result.order.orderStatus,
        stockShort: result.order.stockShort === true,
        wrote: result.alreadyProcessed !== true
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        markUnavailable: true,
        apply: true,
        wrote: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--shop-cancel')) {
    const orderId = argValue('--order');
    const reason = argValue('--reason');
    if (!orderId || !reason) {
      console.error('--shop-cancel needs --order <id> and --reason <text>. Nothing was written.');
      process.exit(1);
    }
    const data = await requireOwnedOrder(db, customerId, shopId, orderId);
    const { cancelRestoresStock } = require('../../src/services/marketplace/stock');
    const stage = data.delivery && data.delivery.stage ? data.delivery.stage : null;
    console.log(JSON.stringify({
      shopCancel: true,
      apply,
      orderId,
      orderStatus: data.orderStatus || null,
      stage,
      restoresStock: cancelRestoresStock(data),
      wrote: false
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --shop-cancel --apply to cancel the order.');
      return;
    }
    const shopOrderService = require('../../src/services/shopOrderService');
    const enforcement = process.argv.includes('--enforce')
      ? { newStatuses: true, utrBlocksReject: true }
      : undefined;
    try {
      const result = await shopOrderService.cancelOrder(shopId, orderId, { reason }, enforcement);
      console.log(JSON.stringify({
        shopCancel: true,
        apply: true,
        wrote: true,
        orderStatus: result.order.orderStatus,
        reason: result.order.cancellation && result.order.cancellation.reason,
        shopReason: result.order.cancellation && result.order.cancellation.shopReason
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        shopCancel: true,
        apply: true,
        wrote: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  const context = await loadContext(db, customerId, shopId, isShopOpenNow);
  let createItems = null;
  if (process.argv.includes('--items')) {
    const resolved = resolveCreateItems(argValue('--items'), context.products);
    if (!resolved.ok) {
      console.error(resolved.message);
      process.exit(1);
    }
    createItems = resolved.lines;
  }
  const jobReport = await paymentJobReport(db, shopId);
  console.log(JSON.stringify({
    dryRun: !apply,
    customerId,
    shopId,
    ...context,
    createItems,
    paymentJob: jobReport
  }, null, 2));

  if (process.argv.includes('--refund-upi')) {
    const upiId = argValue('--refund-upi');
    const refundId = argValue('--refund');
    const orderId = argValue('--order');
    if (!upiId || !refundId || !orderId) {
      console.error('Needs --refund-upi <upiId>, --refund <refundId>, and --order <id>. Nothing was written.');
      process.exit(1);
    }
    await requireOwnedOrder(db, customerId, shopId, orderId);
    const save = process.argv.includes('--save');
    console.log(JSON.stringify({
      refundUpi: true,
      dryRun: !apply,
      orderId,
      refundId,
      upiHandle: maskUpi(upiId),
      save
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --apply to submit the refund UPI.');
      return;
    }
    const { submitCustomerUpi } = require('../../src/services/marketplace/refunds');
    try {
      const result = await submitCustomerUpi({
        customerId,
        orderId,
        refundId,
        idempotencyKey: crypto.randomUUID(),
        upiId,
        upiIdConfirm: upiId,
        save
      });
      const refund = result.body && result.body.data ? result.body.data.refund : null;
      console.log(JSON.stringify({
        applied: true,
        orderId,
        refundId,
        status: refund ? refund.status : null,
        upiHandle: maskUpi(refund && refund.customerUpiId)
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        applied: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--refund-ack')) {
    const answer = argValue('--refund-ack');
    const refundId = argValue('--refund');
    const orderId = argValue('--order');
    if ((answer !== 'yes' && answer !== 'no') || !refundId || !orderId) {
      console.error('Needs --refund-ack yes|no, --refund <refundId>, and --order <id>. Nothing was written.');
      process.exit(1);
    }
    await requireOwnedOrder(db, customerId, shopId, orderId);
    console.log(JSON.stringify({
      refundAck: true,
      dryRun: !apply,
      orderId,
      refundId,
      received: answer === 'yes'
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --apply to acknowledge the refund.');
      return;
    }
    const { acknowledgeRefund } = require('../../src/services/marketplace/refunds');
    try {
      const result = await acknowledgeRefund({
        customerId,
        orderId,
        refundId,
        received: answer === 'yes',
        idempotencyKey: crypto.randomUUID()
      });
      const refund = result.body && result.body.data ? result.body.data.refund : null;
      console.log(JSON.stringify({
        applied: true,
        orderId,
        refundId,
        status: refund ? refund.status : null,
        upiHandle: maskUpi(refund && refund.customerUpiId)
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        applied: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--legacy-refund-sent')) {
    const orderId = argValue('--order');
    if (!orderId) {
      console.error('Needs --legacy-refund-sent --order <id>. Nothing was written.');
      process.exit(1);
    }
    const data = await requireOwnedOrder(db, customerId, shopId, orderId);
    const payment = data.payment && typeof data.payment === 'object' ? data.payment : {};
    console.log(JSON.stringify({
      legacyRefundSent: true,
      dryRun: !apply,
      orderId,
      paymentStatus: payment.status || null,
      hasOpenRefund: data.hasOpenRefund === true
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --apply to record the legacy refund sent.');
      return;
    }
    const shopOrderService = require('../../src/services/shopOrderService');
    try {
      const result = await shopOrderService.refundSent(shopId, orderId);
      console.log(JSON.stringify({
        applied: true,
        alreadyProcessed: result.alreadyProcessed === true,
        orderStatus: result.order ? result.order.orderStatus : null,
        paymentStatus: result.order && result.order.payment ? result.order.payment.status : null,
        hasOpenRefund: result.order ? result.order.hasOpenRefund === true : null
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        applied: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--tick')) {
    const nowArg = argValue('--now');
    const advanceArg = argValue('--advance-minutes');
    if (nowArg && advanceArg) {
      console.error('Pass either --now or --advance-minutes.');
      process.exit(1);
    }
    const tickOptions = {
      dryRun: !apply,
      only: { customerId, shopId }
    };
    if (nowArg) {
      const nowMs = Date.parse(nowArg);
      if (!Number.isFinite(nowMs)) {
        console.error('--now must be an ISO time.');
        process.exit(1);
      }
      tickOptions.nowMs = nowMs;
    } else if (advanceArg) {
      const minutes = Number(advanceArg);
      if (!Number.isFinite(minutes)) {
        console.error('--advance-minutes must be a number.');
        process.exit(1);
      }
      tickOptions.nowMs = Date.now() + (minutes * 60 * 1000);
    }
    if (process.argv.includes('--enforce')) {
      tickOptions.enforcement = { newStatuses: true };
    }
    const marketplacePaymentTimeoutJob = require('../../src/services/marketplacePaymentTimeoutJob');
    const result = await marketplacePaymentTimeoutJob.runTick(tickOptions);
    console.log(JSON.stringify({ tick: true, applied: apply, ...result }, null, 2));
    return;
  }

  if (process.argv.includes('--refund-tick')) {
    const nowArg = argValue('--now');
    const advanceArg = argValue('--advance-minutes');
    if (nowArg && advanceArg) {
      console.error('Pass either --now or --advance-minutes.');
      process.exit(1);
    }
    const tickOptions = {
      dryRun: !apply,
      only: { customerId, shopId }
    };
    if (nowArg) {
      const nowMs = Date.parse(nowArg);
      if (!Number.isFinite(nowMs)) {
        console.error('--now must be an ISO time.');
        process.exit(1);
      }
      tickOptions.nowMs = nowMs;
    } else if (advanceArg) {
      const minutes = Number(advanceArg);
      if (!Number.isFinite(minutes)) {
        console.error('--advance-minutes must be a number.');
        process.exit(1);
      }
      tickOptions.nowMs = Date.now() + (minutes * 60 * 1000);
    }
    if (process.argv.includes('--enforce')) {
      tickOptions.enforcement = { newStatuses: true };
    }
    const marketplaceRefundJob = require('../../src/services/marketplaceRefundJob');
    const result = await marketplaceRefundJob.runTick(tickOptions);
    console.log(JSON.stringify({ refundTick: true, applied: apply, ...result }, null, 2));
    return;
  }

  if (cleanup) {
    const explicitOrderId = argValue('--order');
    const plan = await cleanupPlan(db, customerId, shopId, explicitOrderId);
    if (!plan.orderOwned) {
      const candidates = await recentOrders(db, customerId, shopId);
      const message = explicitOrderId
        ? 'That order does not belong to this customer and shop. Nothing was deleted. Pass --order <id> from the list below.'
        : 'No lock for this customer and shop. Pass --order <id>. Nothing was deleted.';
      console.log(JSON.stringify({
        cleanup: true,
        deleted: false,
        message,
        recentOrders: candidates
      }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({
      cleanup: true,
      apply,
      wouldDelete: {
        lock: plan.deleteLock,
        order: plan.orderOwned,
        events: plan.eventCount,
        refunds: plan.refundCount,
        refundRegistry: plan.refundRegistryCount,
        privateHandover: plan.privateHandoverExists,
        booking: plan.linkedBookingId || null,
        evidenceFiles: plan.evidenceDocs.length,
        utrRegistry: plan.registryDocs.map((doc) => ({
          last4: String(doc.id).slice(-4),
          kind: doc.kind
        })),
        unpaidCountDecrement: plan.decrementUnpaid
      },
      orderNumbersLeftInPlace: plan.orderNumbersExists,
      plan: presentCleanupPlan(plan)
    }, null, 2));
    if (apply) {
      await applyCleanup(db, customerId, shopId, plan);
      console.log('Cleanup applied.');
    } else {
      console.log('Cleanup dry run. Re-run with --cleanup --apply to delete.');
    }
    return;
  }

  if (process.argv.includes('--evidence')) {
    const filePath = argValue('--evidence');
    const orderId = argValue('--order');
    if (!filePath || !orderId) {
      console.error('--evidence needs a local file and --order <id>. Nothing was written.');
      process.exit(1);
    }
    const preview = await utrCancelPreview(db, customerId, shopId, null, orderId);
    if (!preview.owned) {
      console.error('That order does not belong to this customer and shop. Nothing was written.');
      process.exit(1);
    }
    const fs = require('fs/promises');
    const { MAX_BYTES, imageExt, uploadPaymentEvidence } = require('../../src/services/marketplace/paymentEvidence');
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      console.error('Evidence file could not be read. Nothing was written.');
      process.exit(1);
    }
    const header = Buffer.alloc(8);
    const handle = await fs.open(filePath, 'r');
    try {
      await handle.read(header, 0, 8, 0);
    } finally {
      await handle.close();
    }
    const ext = imageExt(header);
    const key = argValue('--idempotency-key') || crypto.randomUUID();
    console.log(JSON.stringify({
      evidence: true,
      apply,
      orderId,
      bytes: stat.size,
      image: ext || 'invalid',
      idempotencyKey: key
    }, null, 2));
    if (!apply && !ext) {
      console.log('Would be rejected: FILE_INVALID. Nothing was written.');
      return;
    }
    if (!apply) {
      console.log('Dry run. Re-run with --evidence --apply to upload. Nothing was written.');
      return;
    }
    if (stat.size > MAX_BYTES || !ext) {
      console.log(JSON.stringify({
        uploaded: false,
        code: 'FILE_INVALID',
        message: 'File must be a jpg or png of 5MB or smaller'
      }, null, 2));
      process.exitCode = 1;
      return;
    }
    try {
      const buffer = await fs.readFile(filePath);
      const result = await uploadPaymentEvidence({
        customerId,
        orderId,
        idempotencyKey: key,
        file: { buffer }
      });
      console.log(JSON.stringify({
        uploaded: true,
        evidenceId: result.evidenceId,
        replay: result.replay === true,
        idempotencyKey: key
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        uploaded: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--payment-report')) {
    const orderId = argValue('--order');
    const utr = argValue('--utr');
    const note = argValue('--note');
    const idArg = argValue('--evidence-ids');
    if (!orderId || !utr) {
      console.error('--payment-report needs --order <id> and --utr <12-digits>. Nothing was written.');
      process.exit(1);
    }
    const preview = await utrCancelPreview(db, customerId, shopId, utr, orderId);
    if (!preview.owned) {
      console.error('That order does not belong to this customer and shop. Nothing was written.');
      process.exit(1);
    }
    const evidenceIds = idArg
      ? idArg.split(',').map((id) => id.trim()).filter(Boolean)
      : [];
    console.log(JSON.stringify({
      paymentReport: true,
      apply,
      order: preview.order,
      utrLast4: utr.slice(-4),
      noteLength: note ? note.length : 0,
      evidenceIdCount: evidenceIds.length
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --payment-report --apply to submit. Nothing was written.');
      return;
    }
    const { submitPaymentReport } = require('../../src/services/marketplace/paymentEvidence');
    const body = { utr };
    if (note) {
      body.note = note;
    }
    if (evidenceIds.length > 0) {
      body.evidenceIds = evidenceIds;
    }
    try {
      const result = await submitPaymentReport({
        customerId,
        orderId,
        idempotencyKey: crypto.randomUUID(),
        body
      });
      console.log(JSON.stringify({
        submitted: true,
        status: result.status,
        orderStatus: result.body.data.order.orderStatus,
        paymentStatus: result.body.data.order.payment.status,
        reviewStatus: result.body.data.order.review && result.body.data.order.review.status,
        customerUtrLast4: typeof result.body.data.order.payment.customerUtr === 'string'
          ? result.body.data.order.payment.customerUtr.slice(-4)
          : null
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        submitted: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--payment-not-found')) {
    const preview = await utrCancelPreview(db, customerId, shopId, null, argValue('--order'));
    if (argValue('--order') && !preview.owned) {
      console.error('That order does not belong to this customer and shop. Nothing was written.');
      process.exit(1);
    }
    console.log(JSON.stringify({
      paymentNotFound: true,
      apply,
      order: preview.order
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --payment-not-found --apply to record it.');
      return;
    }
    if (!preview.order) {
      console.error('No order to mark not found. Pass --order <id> when the lock is gone.');
      process.exit(1);
    }
    const shopOrderService = require('../../src/services/shopOrderService');
    try {
      const result = await shopOrderService.reportNotFound(shopId, preview.order.id);
      console.log(JSON.stringify({
        recorded: true,
        alreadyProcessed: result.alreadyProcessed,
        orderStatus: result.order.orderStatus,
        paymentStatus: result.order.payment.status,
        review: result.order.review
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        recorded: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--amount-differs')) {
    const raw = argValue('--amount-differs');
    const receivedAmount = Number(raw);
    if (!raw || !Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      console.error('--amount-differs needs a positive rupee amount.');
      process.exit(1);
    }
    const preview = await utrCancelPreview(db, customerId, shopId, null, argValue('--order'));
    if (argValue('--order') && !preview.owned) {
      console.error('That order does not belong to this customer and shop. Nothing was written.');
      process.exit(1);
    }
    let utrLast4 = null;
    if (preview.order) {
      const orderSnap = await db.collection('marketplaceOrders').doc(preview.order.id).get();
      const stored = orderSnap.exists && orderSnap.data().payment
        ? orderSnap.data().payment.customerUtr
        : null;
      if (typeof stored === 'string' && stored.length >= 4) {
        utrLast4 = stored.slice(-4);
      }
    }
    const body = { receivedAmount, utrLast4 };
    console.log(JSON.stringify({
      amountDiffers: true,
      apply,
      order: preview.order,
      body
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --amount-differs <rupees> --apply to record the amount.');
      return;
    }
    if (!preview.order || !utrLast4) {
      console.error('No locked order with a customer UTR.');
      process.exit(1);
    }
    const shopOrderService = require('../../src/services/shopOrderService');
    try {
      const result = await shopOrderService.reportAmountDiffers(shopId, preview.order.id, body);
      console.log(JSON.stringify({
        recorded: true,
        alreadyProcessed: result.alreadyProcessed,
        orderStatus: result.order.orderStatus,
        paymentStatus: result.order.payment.status,
        receivedAmount: result.order.payment.receivedAmount
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        recorded: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--balance-utr')) {
    const utr = argValue('--balance-utr');
    const { isValidUtr } = require('../../src/validators/marketplace');
    if (!isValidUtr(utr)) {
      console.error('--balance-utr needs exactly 12 digits.');
      process.exit(1);
    }
    const preview = await utrCancelPreview(db, customerId, shopId, null);
    console.log(JSON.stringify({
      balanceUtr: true,
      apply,
      order: preview.order,
      utrLast4: utr.slice(-4)
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --balance-utr <12 digits> --apply to submit the balance UTR.');
      return;
    }
    if (!preview.order) {
      console.error('No locked order for this customer and shop.');
      process.exit(1);
    }
    const { submitBalanceUtr } = require('../../src/services/marketplace/customerOrderActions');
    try {
      const result = await submitBalanceUtr({
        customerId,
        orderId: preview.order.id,
        idempotencyKey: crypto.randomUUID(),
        utr
      });
      const balance = result.body.data.order.payment.balance;
      console.log(JSON.stringify({
        submitted: true,
        status: result.status,
        orderStatus: result.body.data.order.orderStatus,
        paymentStatus: result.body.data.order.payment.status,
        balanceUtrLast4: balance && balance.utr ? String(balance.utr).slice(-4) : null
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        submitted: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  const confirm = process.argv.includes('--confirm');
  if (process.argv.includes('--full-utr') && !confirm) {
    console.error('--full-utr is only used with --confirm.');
    process.exit(1);
  }
  if (confirm) {
    if (process.argv.includes('--fulfil') && argValue('--fulfil') !== 'false') {
      console.error('--fulfil only accepts false.');
      process.exit(1);
    }
    const preview = await utrCancelPreview(db, customerId, shopId, null, argValue('--order'));
    if (argValue('--order') && !preview.owned) {
      console.error('That order does not belong to this customer and shop. Nothing was written.');
      process.exit(1);
    }
    const fullUtrRaw = process.argv.includes('--full-utr') ? argValue('--full-utr') : '';
    if (process.argv.includes('--full-utr')) {
      const { isValidUtr } = require('../../src/validators/marketplace');
      if (!isValidUtr(fullUtrRaw)) {
        console.error('--full-utr needs exactly 12 digits.');
        process.exit(1);
      }
    }
    let payment = null;
    if (preview.order) {
      const orderSnap = await db.collection('marketplaceOrders').doc(preview.order.id).get();
      payment = orderSnap.exists ? (orderSnap.data().payment || {}) : null;
    }
    const request = confirmRequestBody({ payment, fullUtr: fullUtrRaw });
    if (request.ok && argValue('--fulfil') === 'false') {
      request.body.fulfil = false;
      request.logBody.fulfil = false;
    }
    const enforcement = process.argv.includes('--enforce')
      ? { newStatuses: true, utrBlocksReject: true }
      : undefined;
    const stockPreview = !apply && preview.order
      ? await previewOrderStock(db, preview.order.id, shopId)
      : null;
    console.log(JSON.stringify({
      confirm: true,
      apply,
      enforce: Boolean(enforcement),
      order: preview.order,
      body: request.ok ? request.logBody : null,
      message: request.ok ? null : request.message,
      stockPreview
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --confirm --apply to confirm payment.');
      return;
    }
    if (!preview.order || !request.ok) {
      console.error(request.message || 'No locked order to confirm.');
      process.exit(1);
    }
    const shopOrderService = require('../../src/services/shopOrderService');
    try {
      const result = await shopOrderService.confirmPayment(
        shopId,
        preview.order.id,
        request.body,
        enforcement
      );
      console.log(JSON.stringify({
        confirmed: true,
        alreadyProcessed: result.alreadyProcessed,
        orderStatus: result.order.orderStatus,
        paymentStatus: result.order.payment.status,
        officialUtrLast4: result.order.payment.officialUtr
          ? String(result.order.payment.officialUtr).slice(-4)
          : null,
        balanceOfficialUtrLast4: result.order.payment.balance && result.order.payment.balance.officialUtr
          ? String(result.order.payment.balance.officialUtr).slice(-4)
          : null
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        confirmed: false,
        status: error.status || 500,
        code: error.code || null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  const submitUtr = process.argv.includes('--utr');
  const cancelOrder = process.argv.includes('--cancel');
  if (submitUtr || cancelOrder) {
    const preview = await utrCancelPreview(
      db,
      customerId,
      shopId,
      submitUtr ? (argValue('--utr') || '123456789012') : null,
      argValue('--order')
    );
    if (argValue('--order') && !preview.owned) {
      console.error('That order does not belong to this customer and shop. Nothing was written.');
      process.exit(1);
    }
    let refundAmount = null;
    if (cancelOrder && preview.order) {
      const orderSnap = await db.collection('marketplaceOrders').doc(preview.order.id).get();
      const payment = orderSnap.exists ? (orderSnap.data().payment || {}) : null;
      refundAmount = shortCancelRefundPreview(payment);
    }
    console.log(JSON.stringify({
      utr: submitUtr,
      cancel: cancelOrder,
      apply,
      preview,
      refundAmount
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --apply to submit the UTR or cancel.');
      return;
    }
    const { submitCustomerUtr, cancelCustomerOrder } = require('../../src/services/marketplace/customerOrderActions');
    const { isValidUtr } = require('../../src/validators/marketplace');
    if (!preview.order) {
      console.error('No locked order for this customer and shop.');
      process.exit(1);
    }
    if (submitUtr && !isValidUtr(preview.utr)) {
      console.error('UTR must be exactly 12 digits.');
      process.exit(1);
    }
    if (submitUtr) {
      try {
        const result = await submitCustomerUtr({
          customerId,
          orderId: preview.order.id,
          idempotencyKey: crypto.randomUUID(),
          utr: preview.utr
        });
        console.log(JSON.stringify({
          submitted: true,
          status: result.status,
          orderStatus: result.body.data.order.orderStatus,
          paymentStatus: result.body.data.order.payment.status
        }, null, 2));
      } catch (error) {
        console.log(JSON.stringify({
          submitted: false,
          status: error.status || 500,
          code: error.code || null,
          message: error.message
        }, null, 2));
        process.exitCode = 1;
      }
    }
    if (cancelOrder) {
      try {
        const result = await cancelCustomerOrder({
          customerId,
          orderId: preview.order.id,
          idempotencyKey: crypto.randomUUID()
        });
        console.log(JSON.stringify({
          cancelled: true,
          status: result.status,
          orderStatus: result.body.data.order.orderStatus,
          reason: result.body.data.order.cancellation.reason,
          refund: result.body.data.refund || null
        }, null, 2));
      } catch (error) {
        console.log(JSON.stringify({
          cancelled: false,
          status: error.status || 500,
          code: error.code || null,
          message: error.message
        }, null, 2));
        process.exitCode = 1;
      }
    }
    return;
  }

  if (!apply) {
    console.log('Dry run. Re-run with --apply to create orders.');
    return;
  }

  const { createMarketplaceOrder } = require('../../src/services/marketplace/createCustomerOrder');
  const address = context.addresses[0];
  if (!address) {
    console.error('No saved address. --apply did not create an order.');
    process.exit(1);
  }
  const lines = createItems || (context.line ? [context.line] : []);
  if (lines.length === 0) {
    console.error('No active product with stock. --apply did not create an order.');
    process.exit(1);
  }

  const body = {
    shopId,
    addressId: address.id,
    items: lines
  };
  const wrongLine = { ...lines[0], price: Number(lines[0].price) + 50 };
  const wrongBody = {
    shopId,
    addressId: address.id,
    items: [wrongLine]
  };

  const priceCase = await callCreate(createMarketplaceOrder, customerId, crypto.randomUUID(), wrongBody);
  console.log(JSON.stringify({
    step: 1,
    expected: 'ITEMS_CHANGED',
    status: priceCase.status,
    code: priceCase.code || null,
    lines: priceCase.lines
  }, null, 2));
  if (priceCase.code !== 'ITEMS_CHANGED') {
    process.exit(1);
  }

  const key = crypto.randomUUID();
  const unpaidBefore = await readUnpaidCount(db, customerId);
  const created = await callCreate(createMarketplaceOrder, customerId, key, body);
  const order = created.ok ? created.body.data.order : null;
  console.log(JSON.stringify({
    step: 2,
    expected: 201,
    status: created.status,
    code: created.code || null,
    orderId: order && order.id,
    displayId: order && order.displayId,
    itemsTotal: order && order.itemsTotal,
    expectedAmount: order && order.expectedAmount,
    expectedAmountPaise: order && order.expectedAmountPaise,
    amountAdjustmentPaise: order && order.amountAdjustmentPaise,
    window: order && order.window
  }, null, 2));
  if (!created.ok || created.status !== 201) {
    process.exit(1);
  }

  const unpaidAfterCreate = await readUnpaidCount(db, customerId);
  const replay = await callCreate(createMarketplaceOrder, customerId, key, body);
  const replayOrder = replay.ok ? replay.body.data.order : null;
  const unpaidAfterReplay = await readUnpaidCount(db, customerId);
  console.log(JSON.stringify({
    step: 3,
    expectedStatus: 200,
    status: replay.status,
    sameOrder: Boolean(replayOrder && replayOrder.id === order.id),
    unpaidCountBeforeReplay: unpaidAfterCreate,
    unpaidCountAfterReplay: unpaidAfterReplay,
    unpaidCountUnchanged: unpaidAfterReplay === unpaidAfterCreate,
    unpaidCountBeforeCreate: unpaidBefore
  }, null, 2));

  const conflict = await callCreate(createMarketplaceOrder, customerId, crypto.randomUUID(), body);
  console.log(JSON.stringify({
    step: 4,
    expected: 'UNPAID_ORDER_EXISTS',
    status: conflict.status,
    code: conflict.code || null,
    orderId: conflict.orderId
  }, null, 2));

  await printOutcome(db, customerId, shopId, order.id, order.displayId);
  console.log(JSON.stringify({ paymentJob: await paymentJobReport(db, shopId) }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
