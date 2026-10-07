/**
 * Staging test for marketplace order create. Calls createMarketplaceOrder
 * directly. Dry run is the default and writes nothing.
 *
 * Usage:
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id>
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --apply
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --cleanup [--order <id>]
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --cleanup --apply [--order <id>]
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --utr [12-digits]
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --cancel
 *   node scripts/support/test-marketplace-create.js --customer <id> --shop <id> --confirm [--enforce]
 *
 * --utr and --cancel use the order on marketplaceLocks/{customer}_{shop}.
 * --utr without a value uses 123456789012. Dry run prints that order and
 * does not write. Add --apply to call submitCustomerUtr or cancelCustomerOrder.
 * --confirm dry run prints utrLast4 from the stored customer UTR and
 * withinWindowAttested true. --confirm --apply calls confirmPayment.
 * --enforce passes { newStatuses: true, utrBlocksReject: true } into that
 * call only. It does not write appSettings.
 *
 * --apply case order. The price case is first, on this shop, so the unpaid
 * lock is not written yet:
 *   1. new key, wrong price → ITEMS_CHANGED reason price
 *   2. new key, qty 1, current price (variantId when the product has one) → 201
 *   3. same key → 200, same order, unpaidCount unchanged
 *   4. new key, same shop → UNPAID_ORDER_EXISTS
 *
 * --cleanup prints the lock, order, events, private/handover, and every
 * utrRegistry doc whose orderId is this order. Lookup is --order <id>,
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

assertStagingEnv();

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
  const openingHours = shop && shop.storefront && shop.storefront.openingHours !== undefined
    ? shop.storefront.openingHours
    : null;
  const isOpen = identity.isOpen === true;
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
    utrRegistry: plan.registryDocs.map((doc) => ({
      last4: String(doc.id).slice(-4),
      kind: doc.kind
    })),
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
  const privateSnap = owned ? await orderRef.collection('private').doc('handover').get() : null;
  const displayId = owned ? order.displayId : null;
  const registrySnap = displayId == null
    ? null
    : await db.collection('orderNumbers').doc(String(displayId)).get();
  const registryDocs = owned ? await registryDocsForOrder(db, orderId) : [];
  const unpaidCount = await readUnpaidCount(db, customerId);
  const deleteLock = Boolean(owned && lockOrderId && lockOrderId === orderId);

  return {
    foundBy,
    lockExists: lockSnap.exists,
    deleteLock,
    orderId,
    orderOwned: owned,
    orderStatus: owned ? (order.orderStatus || null) : null,
    eventCount: eventsSnap ? eventsSnap.size : 0,
    privateHandoverExists: Boolean(privateSnap && privateSnap.exists),
    displayId: displayId == null ? null : displayId,
    orderNumbersExists: Boolean(registrySnap && registrySnap.exists),
    registryDocs,
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
    batch.delete(orderRef.collection('private').doc('handover'));
    batch.delete(orderRef);
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

async function utrCancelPreview(db, customerId, shopId, utr) {
  const lockSnap = await db.collection('marketplaceLocks').doc(`${customerId}_${shopId}`).get();
  const orderId = lockSnap.exists ? (lockSnap.data() || {}).orderId : null;
  let order = null;
  if (orderId) {
    const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
    if (orderSnap.exists) {
      const data = orderSnap.data() || {};
      order = {
        id: orderId,
        orderStatus: data.orderStatus || null,
        paymentStatus: data.payment ? data.payment.status : null,
        hasCustomerUtr: Boolean(data.payment && data.payment.customerUtr)
      };
    }
  }
  return {
    lockExists: lockSnap.exists,
    order,
    utr
  };
}

async function main() {
  const customerId = argValue('--customer');
  const shopId = argValue('--shop');
  const apply = process.argv.includes('--apply');
  const cleanup = process.argv.includes('--cleanup');
  if (!customerId || !shopId) {
    console.error('Usage: node scripts/support/test-marketplace-create.js --customer <id> --shop <id> [--apply] [--cleanup] [--order <id>] [--utr [12-digits]] [--cancel] [--confirm] [--enforce]');
    process.exit(1);
  }

  const { getFirestore } = require('../../src/services/firebase');
  const { isShopOpenNow } = require('../../src/services/marketplace/createCustomerOrder');
  const db = getFirestore();
  assertStagingAdmin();

  const context = await loadContext(db, customerId, shopId, isShopOpenNow);
  const jobReport = await paymentJobReport(db, shopId);
  console.log(JSON.stringify({
    dryRun: !apply,
    customerId,
    shopId,
    ...context,
    paymentJob: jobReport
  }, null, 2));

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
        privateHandover: plan.privateHandoverExists,
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

  const confirm = process.argv.includes('--confirm');
  if (confirm) {
    const preview = await utrCancelPreview(db, customerId, shopId, null);
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
    const enforcement = process.argv.includes('--enforce')
      ? { newStatuses: true, utrBlocksReject: true }
      : undefined;
    console.log(JSON.stringify({
      confirm: true,
      apply,
      enforce: Boolean(enforcement),
      order: preview.order,
      body: { utrLast4, withinWindowAttested: true }
    }, null, 2));
    if (!apply) {
      console.log('Dry run. Re-run with --confirm --apply to confirm payment.');
      return;
    }
    if (!preview.order || !utrLast4) {
      console.error('No locked order with a customer UTR to confirm.');
      process.exit(1);
    }
    const shopOrderService = require('../../src/services/shopOrderService');
    try {
      const result = await shopOrderService.confirmPayment(
        shopId,
        preview.order.id,
        { utrLast4, withinWindowAttested: true },
        enforcement
      );
      console.log(JSON.stringify({
        confirmed: true,
        alreadyProcessed: result.alreadyProcessed,
        orderStatus: result.order.orderStatus,
        paymentStatus: result.order.payment.status,
        officialUtrLast4: result.order.payment.officialUtr
          ? String(result.order.payment.officialUtr).slice(-4)
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
      submitUtr ? (argValue('--utr') || '123456789012') : null
    );
    console.log(JSON.stringify({
      utr: submitUtr,
      cancel: cancelOrder,
      apply,
      preview
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
          reason: result.body.data.order.cancellation.reason
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
  if (!context.line) {
    console.error('No active product with stock. --apply did not create an order.');
    process.exit(1);
  }

  const body = {
    shopId,
    addressId: address.id,
    items: [context.line]
  };
  const wrongBody = {
    shopId,
    addressId: address.id,
    items: [context.wrongPriceLine]
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
