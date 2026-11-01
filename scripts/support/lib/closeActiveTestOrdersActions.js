const { ONGOING_ORDER_STATUSES } = require('../../../src/services/marketplace/orderStateMachine');
const { DRIVER_GET_ACTIVE_BOOKING_STATUSES } = require('../../../src/constants/bookingStatuses');
const {
  loadReleaseContext,
  planReleaseStuckDriver,
  applyReleaseStuckDriver,
  TERMINAL_CANDIDATE_STATUSES
} = require('./releaseStuckDriverActions');

const USAGE =
  'Usage: node scripts/support/close-active-test-orders.js [--order <id>] [--booking <id>] [--apply]';

const CLEANUP_REASON = 'support_test_cleanup';
const BATCH_LIMIT = 400;

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  const next = argv[index + 1];
  if (!next || next.startsWith('--')) {
    return '';
  }
  return next;
}

function parseCloseActiveTestOrdersArgv(argv = process.argv) {
  return {
    apply: argv.includes('--apply'),
    orderId: argValue(argv, '--order').trim(),
    bookingId: argValue(argv, '--booking').trim()
  };
}

function presentEnforcement(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    newStatuses: source.newStatuses === true,
    utrBlocksReject: source.utrBlocksReject === true
  };
}

function isTerminalBookingStatus(status) {
  return typeof status === 'string' && TERMINAL_CANDIDATE_STATUSES.has(status);
}

function isTerminalOrderStatus(status) {
  return status === 'cancelled' || status === 'completed' || status === 'delivery_failed';
}

async function loadMarketplaceSettings(db) {
  const snap = await db.collection('appSettings').doc('marketplace').get();
  const data = snap.exists ? snap.data() || {} : {};
  const timeoutRaw = data.PAYMENT_TIMEOUT_MS;
  const timeoutNum = Number(timeoutRaw);
  return {
    MARKETPLACE_ENFORCEMENT: presentEnforcement(data.MARKETPLACE_ENFORCEMENT),
    PAYMENT_TIMEOUT_MS: timeoutRaw === undefined || timeoutRaw === null ? null : timeoutRaw,
    paymentTimeoutConfigured: Number.isFinite(timeoutNum) && timeoutNum > 0
  };
}

function orderRowFromDoc(doc, bookingStatusById) {
  const data = doc.data() || {};
  const linkedBookingId = data.linkedBookingId || null;
  let linkedBookingStatus = null;
  if (linkedBookingId) {
    linkedBookingStatus = bookingStatusById[linkedBookingId] ?? 'missing';
  }
  return {
    orderId: doc.id,
    displayId: data.displayId ?? null,
    shopId: data.shopId ?? null,
    orderStatus: data.orderStatus ?? null,
    paymentStatus: data.payment && data.payment.status ? data.payment.status : null,
    linkedBookingId,
    linkedBookingStatus
  };
}

function bookingRowFromDoc(doc) {
  const data = doc.data() || {};
  return {
    bookingId: doc.id,
    status: data.status ?? null,
    driverId: data.driverId ?? null,
    sourceType: data.sourceType ?? null,
    displayId: data.displayId ?? null
  };
}

function matchesOrderFilter(orderIdFilter, row) {
  if (!orderIdFilter) {
    return true;
  }
  return row.orderId === orderIdFilter;
}

function matchesBookingFilter(bookingIdFilter, bookingId) {
  if (!bookingIdFilter) {
    return true;
  }
  return bookingId === bookingIdFilter;
}

function buildReferenceBookingIds({ ongoingOrders, activeBookings }) {
  const ids = new Set();
  for (const row of ongoingOrders) {
    if (row.linkedBookingId) {
      ids.add(row.linkedBookingId);
    }
  }
  for (const row of activeBookings) {
    ids.add(row.bookingId);
  }
  return ids;
}

async function loadBookingStatusMap(db, bookingIds) {
  const map = {};
  const list = [...bookingIds];
  await Promise.all(list.map(async (id) => {
    const snap = await db.collection('bookings').doc(id).get();
    map[id] = snap.exists ? ((snap.data() || {}).status ?? null) : 'missing';
  }));
  return map;
}

async function queryOngoingMarketplaceOrders(db) {
  const snap = await db.collection('marketplaceOrders')
    .where('orderStatus', 'in', [...ONGOING_ORDER_STATUSES])
    .get();
  return snap.docs;
}

async function queryActiveBookingsForReport(db) {
  const docs = [];
  const driverSnap = await db.collection('bookings')
    .where('status', 'in', [...DRIVER_GET_ACTIVE_BOOKING_STATUSES])
    .get();
  docs.push(...driverSnap.docs);
  const pendingSnap = await db.collection('bookings')
    .where('status', '==', 'pending')
    .get();
  docs.push(...pendingSnap.docs);
  const byId = new Map();
  for (const doc of docs) {
    byId.set(doc.id, doc);
  }
  return [...byId.values()];
}

async function loadAffectedDrivers(db, referenceBookingIds, bookingExistsById) {
  const driversSnap = await db.collection('users').where('userType', '==', 'driver').get();
  const rows = [];
  for (const userDoc of driversSnap.docs) {
    const userData = userDoc.data() || {};
    const driver = userData.driver && typeof userData.driver === 'object' ? userData.driver : {};
    const locationSnap = await db.collection('driverLocations').doc(userDoc.id).get();
    const loc = locationSnap.exists ? locationSnap.data() || {} : {};
    const pointerIds = [];
    if (typeof driver.currentBookingId === 'string' && driver.currentBookingId.trim() !== '') {
      pointerIds.push(driver.currentBookingId.trim());
    }
    if (typeof loc.currentTripId === 'string' && loc.currentTripId.trim() !== '') {
      pointerIds.push(loc.currentTripId.trim());
    }
    const relevantPointers = [...new Set(pointerIds)].filter((id) => {
      if (referenceBookingIds.has(id)) {
        return true;
      }
      return bookingExistsById[id] === false;
    });
    if (relevantPointers.length === 0) {
      continue;
    }
    rows.push({
      driverId: userDoc.id,
      currentBookingId: driver.currentBookingId ?? null,
      currentTripId: loc.currentTripId ?? null,
      pointerBookingIds: relevantPointers
    });
  }
  return rows;
}

async function findParcelLocksForBookings(db, bookingIds) {
  const target = new Set(bookingIds);
  if (target.size === 0) {
    return [];
  }
  const snap = await db.collection('customerParcelLocks').get();
  return snap.docs
    .filter((doc) => {
      const bid = (doc.data() || {}).bookingId;
      return typeof bid === 'string' && target.has(bid);
    })
    .map((doc) => ({
      customerId: doc.id,
      bookingId: (doc.data() || {}).bookingId
    }));
}

function filterReportScope({ ongoingOrders, activeBookings, affectedDrivers, orderIdFilter, bookingIdFilter }) {
  let orders = ongoingOrders.filter((row) => matchesOrderFilter(orderIdFilter, row));
  let bookings = activeBookings.filter((row) => matchesBookingFilter(bookingIdFilter, row.bookingId));

  if (bookingIdFilter) {
    orders = orders.filter((row) => row.linkedBookingId === bookingIdFilter);
    const orderLinked = new Set(orders.map((o) => o.linkedBookingId).filter(Boolean));
    if (!bookings.some((b) => b.bookingId === bookingIdFilter)) {
      bookings = bookings.filter((b) => b.bookingId === bookingIdFilter);
      if (bookings.length === 0 && orderLinked.has(bookingIdFilter)) {
        bookings = [{ bookingId: bookingIdFilter, status: null, driverId: null, sourceType: null, displayId: null }];
      }
    }
  }

  if (orderIdFilter) {
    const order = orders.find((o) => o.orderId === orderIdFilter);
    if (order && order.linkedBookingId) {
      const linked = order.linkedBookingId;
      if (!bookings.some((b) => b.bookingId === linked)) {
        bookings.push({
          bookingId: linked,
          status: order.linkedBookingStatus === 'missing' ? null : order.linkedBookingStatus,
          driverId: null,
          sourceType: null,
          displayId: null
        });
      }
    }
  }

  const referenceBookingIds = buildReferenceBookingIds({ ongoingOrders: orders, activeBookings: bookings });
  const drivers = affectedDrivers.filter((d) =>
    d.pointerBookingIds.some((id) => referenceBookingIds.has(id) || matchesBookingFilter(bookingIdFilter, id))
  );

  if (bookingIdFilter) {
    const scopedDrivers = affectedDrivers.filter((d) =>
      d.pointerBookingIds.includes(bookingIdFilter)
    );
    return { orders, bookings, affectedDrivers: scopedDrivers.length ? scopedDrivers : drivers, referenceBookingIds };
  }

  if (orderIdFilter) {
    const linked = orders.find((o) => o.orderId === orderIdFilter)?.linkedBookingId;
    if (linked) {
      const scopedDrivers = affectedDrivers.filter((d) => d.pointerBookingIds.includes(linked));
      return {
        orders,
        bookings,
        affectedDrivers: scopedDrivers,
        referenceBookingIds
      };
    }
    return { orders, bookings, affectedDrivers: [], referenceBookingIds };
  }

  return { orders, bookings, affectedDrivers: drivers, referenceBookingIds };
}

async function runCloseActiveTestOrdersReport(db, options = {}) {
  const orderIdFilter = options.orderId || '';
  const bookingIdFilter = options.bookingId || '';

  const settings = await loadMarketplaceSettings(db);
  const orderDocs = await queryOngoingMarketplaceOrders(db);
  const bookingDocs = await queryActiveBookingsForReport(db);

  const preliminaryLinked = new Set();
  for (const doc of orderDocs) {
    const linked = (doc.data() || {}).linkedBookingId;
    if (linked) {
      preliminaryLinked.add(linked);
    }
  }
  for (const doc of bookingDocs) {
    preliminaryLinked.add(doc.id);
  }

  const bookingStatusById = await loadBookingStatusMap(db, preliminaryLinked);

  const ongoingOrders = orderDocs.map((doc) => orderRowFromDoc(doc, bookingStatusById));
  const activeBookings = bookingDocs.map((doc) => bookingRowFromDoc(doc));

  const referenceBookingIds = buildReferenceBookingIds({ ongoingOrders, activeBookings });
  const bookingExistsById = {};
  for (const id of referenceBookingIds) {
    bookingExistsById[id] = bookingStatusById[id] !== 'missing';
  }
  for (const id of referenceBookingIds) {
    if (bookingStatusById[id] === 'missing') {
      bookingExistsById[id] = false;
    }
  }

  const affectedDrivers = await loadAffectedDrivers(db, referenceBookingIds, bookingExistsById);

  const scoped = filterReportScope({
    ongoingOrders,
    activeBookings,
    affectedDrivers,
    orderIdFilter,
    bookingIdFilter
  });

  const scopedBookingIds = [...scoped.referenceBookingIds];
  const parcelLocks = await findParcelLocksForBookings(db, scopedBookingIds);

  return {
    closeActiveTestOrders: true,
    dryRun: options.apply !== true,
    filters: {
      orderId: orderIdFilter || null,
      bookingId: bookingIdFilter || null
    },
    settings,
    ongoingOrders: scoped.orders,
    activeBookings: scoped.bookings,
    affectedDrivers: scoped.affectedDrivers,
    customerParcelLocks: parcelLocks,
    referenceBookingIds: scopedBookingIds
  };
}

function planDriverReleaseAfterCleanup(context, cancellingBookingIds) {
  const cancelSet = new Set(cancellingBookingIds);
  const bookingsById = { ...context.bookingsById };
  for (const id of cancelSet) {
    const entry = bookingsById[id];
    if (entry && entry.exists) {
      bookingsById[id] = {
        exists: true,
        data: { ...(entry.data || {}), status: 'cancelled' }
      };
    }
  }
  const adjusted = {
    ...context,
    bookingsById,
    driverActiveBookings: (context.driverActiveBookings || []).filter((row) => !cancelSet.has(row.id))
  };
  return planReleaseStuckDriver(adjusted);
}

function planCloseActiveTestOrdersApply(report) {
  const endedAt = new Date();
  const orderUpdates = [];
  const bookingUpdates = [];
  const tripTrackingUpdates = [];
  const lockDeletes = [];
  const parcelLockDeletes = [];
  const driverPlans = [];

  for (const row of report.ongoingOrders || []) {
    if (isTerminalOrderStatus(row.orderStatus)) {
      continue;
    }
    orderUpdates.push({
      orderId: row.orderId,
      patch: {
        orderStatus: 'cancelled',
        cancellation: {
          cancelledAt: endedAt,
          cancelledBy: 'support',
          reason: CLEANUP_REASON
        },
        updatedAt: endedAt
      }
    });
  }

  const bookingIdsToCancel = new Set();
  for (const row of report.activeBookings || []) {
    if (row.status && isTerminalBookingStatus(row.status)) {
      continue;
    }
    bookingIdsToCancel.add(row.bookingId);
  }
  for (const row of report.ongoingOrders || []) {
    if (row.linkedBookingId && row.linkedBookingStatus !== 'missing') {
      if (!isTerminalBookingStatus(row.linkedBookingStatus)) {
        bookingIdsToCancel.add(row.linkedBookingId);
      }
    } else if (row.linkedBookingId && row.linkedBookingStatus === 'missing') {
      bookingIdsToCancel.add(row.linkedBookingId);
    }
  }

  for (const bookingId of bookingIdsToCancel) {
    bookingUpdates.push({
      bookingId,
      patch: {
        status: 'cancelled',
        cancelledAt: endedAt,
        cancelledBy: 'support',
        cancellationReason: CLEANUP_REASON,
        updatedAt: endedAt
      }
    });
    tripTrackingUpdates.push({
      bookingId,
      patch: {
        isActive: false,
        endedAt,
        endReason: CLEANUP_REASON,
        lastUpdated: endedAt,
        updatedAt: endedAt
      },
      onlyIfExists: true
    });
    lockDeletes.push({ bookingId });
  }

  for (const lock of report.customerParcelLocks || []) {
    parcelLockDeletes.push({ customerId: lock.customerId, bookingId: lock.bookingId });
  }

  return {
    endedAt,
    orderUpdates,
    bookingUpdates,
    tripTrackingUpdates,
    lockDeletes,
    parcelLockDeletes,
    driverPlans,
    cancellingBookingIds: [...bookingIdsToCancel]
  };
}

async function planDriverReleases(db, report, cancellingBookingIds) {
  const plans = [];
  const seen = new Set();
  for (const row of report.affectedDrivers || []) {
    if (seen.has(row.driverId)) {
      continue;
    }
    seen.add(row.driverId);
    const context = await loadReleaseContext(db, row.driverId, '');
    const plan = planDriverReleaseAfterCleanup(context, cancellingBookingIds);
    plans.push({
      driverId: row.driverId,
      plan,
      refused: plan.refused,
      refuseReason: plan.refuseReason
    });
  }
  return plans;
}

async function commitBatches(db, buildBatchFn) {
  const ops = buildBatchFn();
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const chunk = ops.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const op of chunk) {
      op.apply(batch, db);
    }
    await batch.commit();
  }
}

async function applyCloseActiveTestOrders(db, report, options = {}) {
  const basePlan = planCloseActiveTestOrdersApply(report);
  const driverPlans = await planDriverReleases(db, report, basePlan.cancellingBookingIds);

  const orderExists = {};
  await Promise.all(basePlan.orderUpdates.map(async (entry) => {
    const snap = await db.collection('marketplaceOrders').doc(entry.orderId).get();
    orderExists[entry.orderId] = snap.exists;
  }));

  const bookingExists = {};
  await Promise.all(basePlan.bookingUpdates.map(async (entry) => {
    const snap = await db.collection('bookings').doc(entry.bookingId).get();
    bookingExists[entry.bookingId] = snap.exists;
  }));

  const tripExists = {};
  await Promise.all(basePlan.tripTrackingUpdates.map(async (entry) => {
    const snap = await db.collection('tripTracking').doc(entry.bookingId).get();
    tripExists[entry.bookingId] = snap.exists;
  }));

  const lockExists = {};
  await Promise.all(basePlan.lockDeletes.map(async (entry) => {
    const snap = await db.collection('booking_locks').doc(entry.bookingId).get();
    lockExists[entry.bookingId] = snap.exists;
  }));

  const operations = [];

  for (const entry of basePlan.orderUpdates) {
    if (!orderExists[entry.orderId]) {
      continue;
    }
    operations.push({
      apply(batch, database) {
        batch.update(database.collection('marketplaceOrders').doc(entry.orderId), entry.patch);
      }
    });
  }

  for (const entry of basePlan.bookingUpdates) {
    if (!bookingExists[entry.bookingId]) {
      continue;
    }
    operations.push({
      apply(batch, database) {
        batch.update(database.collection('bookings').doc(entry.bookingId), entry.patch);
      }
    });
  }

  for (const entry of basePlan.tripTrackingUpdates) {
    if (entry.onlyIfExists && !tripExists[entry.bookingId]) {
      continue;
    }
    operations.push({
      apply(batch, database) {
        batch.set(
          database.collection('tripTracking').doc(entry.bookingId),
          entry.patch,
          { merge: true }
        );
      }
    });
  }

  for (const entry of basePlan.lockDeletes) {
    if (!lockExists[entry.bookingId]) {
      continue;
    }
    operations.push({
      apply(batch, database) {
        batch.delete(database.collection('booking_locks').doc(entry.bookingId));
      }
    });
  }

  for (const entry of basePlan.parcelLockDeletes) {
    operations.push({
      apply(batch, database) {
        batch.delete(database.collection('customerParcelLocks').doc(entry.customerId));
      }
    });
  }

  if (operations.length > 0) {
    await commitBatches(db, () => operations);
  }

  const driverResults = [];
  for (const item of driverPlans) {
    if (item.refused) {
      driverResults.push({
        driverId: item.driverId,
        released: false,
        refuseReason: item.refuseReason
      });
      continue;
    }
    await applyReleaseStuckDriver(db, item.plan);
    driverResults.push({ driverId: item.driverId, released: true });
  }

  return {
    wrote: true,
    ordersCancelled: basePlan.orderUpdates.length,
    bookingsCancelled: basePlan.bookingUpdates.length,
    parcelLocksCleared: basePlan.parcelLockDeletes.length,
    driverResults
  };
}

async function runCloseActiveTestOrders(db, options = {}) {
  const report = await runCloseActiveTestOrdersReport(db, options);
  if (!options.apply) {
    return {
      ...report,
      applyPlan: planCloseActiveTestOrdersApply(report),
      wrote: false
    };
  }

  const applyResult = await applyCloseActiveTestOrders(db, report, options);
  return {
    ...report,
    apply: true,
    ...applyResult
  };
}

module.exports = {
  USAGE,
  CLEANUP_REASON,
  BATCH_LIMIT,
  parseCloseActiveTestOrdersArgv,
  presentEnforcement,
  runCloseActiveTestOrdersReport,
  planCloseActiveTestOrdersApply,
  planDriverReleaseAfterCleanup,
  applyCloseActiveTestOrders,
  runCloseActiveTestOrders,
  findParcelLocksForBookings,
  filterReportScope,
  isTerminalBookingStatus,
  isTerminalOrderStatus
};
