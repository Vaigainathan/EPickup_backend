const { buildSystemAvailabilityUpdate } = require('../../../src/utils/driverAvailabilityMetadata');

const STAGING_TEST_DRIVER_UID = 'stage2testdriver00000000000001';
const RECONCILED_BY = 'staging-reconcile-script';

const LIVE_STAGES = new Set(['assigned', 'at_shop', 'picked_up', 'on_the_way']);

const OPEN_BOOKING_TERMINAL = new Set(['completed', 'cancelled', 'rejected']);

const SIM_STEPS = new Set(['assign', 'arrive', 'pickup', 'transit', 'deliver']);

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

function isOpenBookingStatus(status) {
  return typeof status === 'string' && status !== '' && !OPEN_BOOKING_TERMINAL.has(status);
}

function coordinatesFromSnapshot(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const latitude = typeof value.latitude === 'number' ? value.latitude : value.lat;
  const longitude = typeof value.longitude === 'number' ? value.longitude : value.lng;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

function driverInfoFromUser(userData) {
  const data = userData && typeof userData === 'object' ? userData : {};
  const driver = data.driver && typeof data.driver === 'object' ? data.driver : {};
  const vehicleDetails = driver.vehicleDetails && typeof driver.vehicleDetails === 'object'
    ? driver.vehicleDetails
    : {};
  const name = typeof data.name === 'string' ? data.name : '';
  const phone = typeof data.phone === 'string' ? data.phone : '';
  let vehicle = '';
  if (typeof vehicleDetails.vehicleNumber === 'string' && vehicleDetails.vehicleNumber) {
    vehicle = vehicleDetails.vehicleNumber;
  } else if (typeof vehicleDetails.vehicleModel === 'string' && vehicleDetails.vehicleModel) {
    vehicle = vehicleDetails.vehicleModel;
  }
  return { name, phone, vehicle };
}

function assertTestDriverFixture(userData, uid) {
  if (uid !== STAGING_TEST_DRIVER_UID) {
    return { ok: false, message: 'Refusing: driver UID is not the staging test driver constant.' };
  }
  if (!userData || userData.testFixture !== true) {
    return {
      ok: false,
      message: `Refusing: users/${uid} is not flagged testFixture === true. Nothing was written.`
    };
  }
  return { ok: true };
}

function buildDriverReleasePatch(driverData) {
  const driver = driverData && driverData.driver && typeof driverData.driver === 'object'
    ? driverData.driver
    : {};
  const active = driver.activeBookings;
  return {
    ...buildSystemAvailabilityUpdate(true),
    'driver.currentBookingId': null,
    'driver.activeBookings': Math.max((active || 1) - 1, 0)
  };
}

function mergeBookingAfterPatch(booking, patch) {
  const base = booking && typeof booking === 'object' ? booking : {};
  const timing = { ...(base.timing || {}), ...(patch.timing || {}) };
  return {
    ...base,
    ...patch,
    timing
  };
}

function bookingMatchesOrderForReconcile(orderStatus, bookingStatus) {
  if (orderStatus === 'completed') {
    return bookingStatus === 'delivered' || bookingStatus === 'completed';
  }
  if (orderStatus === 'cancelled') {
    return bookingStatus === 'cancelled';
  }
  return false;
}

function evaluateSyncPreflight(order, proposedBooking, planDeliverySync, planWrites) {
  const plan = planDeliverySync(order, proposedBooking);
  const writes = planWrites(plan, order);
  const push = plan && plan.push ? plan.push : null;
  const complete = plan && plan.complete === true;
  const ok = writes === false && !push && !complete;
  return {
    ok,
    plan,
    writes,
    push,
    complete
  };
}

function planReconcileBooking(order, booking) {
  const orderStatus = order && order.orderStatus;
  const bookingStatus = booking && booking.status;
  const result = {
    action: null,
    refused: false,
    refuseReason: null,
    noWrite: false,
    bookingPatch: null,
    driverRelease: null
  };

  if (bookingMatchesOrderForReconcile(orderStatus, bookingStatus)) {
    result.action = 'none';
    result.noWrite = true;
    result.refuseReason = 'Booking already matches order.';
    return result;
  }

  if (!isOpenBookingStatus(bookingStatus)) {
    result.noWrite = true;
    result.refuseReason = 'Booking is already in a terminal reconcile state.';
    return result;
  }

  if (orderStatus === 'completed') {
    result.action = 'delivered';
    const at = new Date();
    result.bookingPatch = {
      status: 'delivered',
      reconciledBy: RECONCILED_BY,
      reconciledAt: at,
      updatedAt: at,
      timing: {
        ...(booking.timing || {}),
        deliveredAt: at
      }
    };
    return result;
  }

  if (orderStatus === 'cancelled') {
    result.action = 'cancelled';
    const at = new Date();
    result.bookingPatch = {
      status: 'cancelled',
      cancellationReason: 'Marketplace order cancelled',
      cancelledBy: 'support',
      cancelledAt: at,
      reconciledBy: RECONCILED_BY,
      reconciledAt: at,
      updatedAt: at
    };
    if (booking.driverId) {
      result.driverRelease = { driverId: booking.driverId };
    }
    return result;
  }

  result.refused = true;
  result.refuseReason = `Unsupported orderStatus for reconcile: ${orderStatus ?? 'null'}.`;
  return result;
}

function planSimStepPatch(step, booking, driverUser) {
  if (!SIM_STEPS.has(step)) {
    return { ok: false, message: `Unknown step: ${step}` };
  }
  const at = new Date();
  const patch = { updatedAt: at };

  switch (step) {
    case 'assign': {
      const info = driverInfoFromUser(driverUser);
      patch.status = 'driver_assigned';
      patch.driverId = STAGING_TEST_DRIVER_UID;
      patch.driverInfo = info;
      patch['timing.assignedAt'] = at;
      break;
    }
    case 'arrive':
      patch.status = 'driver_arrived';
      patch['timing.driverArrivedAt'] = at;
      break;
    case 'pickup':
      patch.status = 'picked_up';
      patch['timing.pickedUpAt'] = at;
      break;
    case 'transit':
      patch.status = 'in_transit';
      patch['timing.inTransitAt'] = at;
      break;
    case 'deliver':
      patch.status = 'delivered';
      patch['timing.deliveredAt'] = at;
      break;
    default:
      break;
  }

  return { ok: true, patch };
}

function flattenTimingPatch(patch) {
  const out = { ...patch };
  const timingKeys = Object.keys(out).filter((key) => key.startsWith('timing.'));
  if (timingKeys.length === 0) {
    return out;
  }
  const timing = { ...(out.timing || {}) };
  timingKeys.forEach((key) => {
    const field = key.slice('timing.'.length);
    timing[field] = out[key];
    delete out[key];
  });
  out.timing = timing;
  return out;
}

function interpolateRoute(start, end, progress01) {
  const p = Number(progress01);
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    return null;
  }
  const from = coordinatesFromSnapshot(start);
  const to = coordinatesFromSnapshot(end);
  if (!from || !to) {
    return null;
  }
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * p,
    longitude: from.longitude + (to.longitude - from.longitude) * p
  };
}

function planMoveWrites({ order, bookingId, seconds, every, baseMs }) {
  const stage = order.delivery && typeof order.delivery.stage === 'string'
    ? order.delivery.stage
    : null;
  if (!LIVE_STAGES.has(stage)) {
    return {
      ok: false,
      message: `Driver location move refused: delivery.stage must be one of ${[...LIVE_STAGES].join(', ')} (got ${stage ?? 'null'}).`
    };
  }
  const start = coordinatesFromSnapshot(
    order.shopSnapshot && order.shopSnapshot.coordinates
  );
  const end = coordinatesFromSnapshot(
    order.deliveryAddress && order.deliveryAddress.coordinates
  );
  if (!start) {
    return { ok: false, message: 'Driver location move refused: order.shopSnapshot.coordinates missing.' };
  }
  if (!end) {
    return { ok: false, message: 'Driver location move refused: order.deliveryAddress.coordinates missing.' };
  }

  const totalSec = Number(seconds);
  const intervalSec = Number(every);
  if (!Number.isFinite(totalSec) || totalSec <= 0) {
    return { ok: false, message: '--seconds must be a positive number.' };
  }
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    return { ok: false, message: '--every must be a positive number.' };
  }

  const steps = Math.max(1, Math.ceil(totalSec / intervalSec));
  const startMs = Number.isFinite(Number(baseMs)) ? Number(baseMs) : Date.now();
  const intervalMs = intervalSec * 1000;
  const writes = [];
  for (let index = 0; index < steps; index += 1) {
    const progress = steps === 1 ? 1 : index / (steps - 1);
    const point = interpolateRoute(start, end, progress);
    if (!point) {
      return { ok: false, message: 'Failed to interpolate route.' };
    }
    writes.push({
      bookingId,
      latitude: point.latitude,
      longitude: point.longitude,
      lastUpdated: new Date(startMs + index * intervalMs)
    });
  }

  return { ok: true, writes, stage, intervalSec };
}

function planSeedDriverDoc() {
  return {
    id: STAGING_TEST_DRIVER_UID,
    userType: 'driver',
    name: 'Stage2 Test Driver',
    phone: '+919000333801',
    isActive: true,
    isVerified: true,
    testFixture: true,
    driver: {
      isOnline: false,
      isAvailable: false,
      isVerified: true,
      verificationStatus: 'approved',
      rating: 4.8,
      currentBookingId: null,
      vehicleDetails: {
        vehicleNumber: 'TN20ST1234',
        vehicleModel: 'Honda Activa',
        vehicleType: '2_wheeler',
        vehicleColor: 'Black'
      }
    }
  };
}

function assertNoAvailabilityFlagsInWrite(payload) {
  const violations = [];
  function walk(value, path) {
    if (value == null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    Object.keys(value).forEach((key) => {
      const nextPath = path ? `${path}.${key}` : key;
      if ((key === 'isOnline' || key === 'isAvailable') && value[key] === true) {
        violations.push(nextPath);
      }
      walk(value[key], nextPath);
    });
  }
  walk(payload, '');
  return violations;
}

module.exports = {
  STAGING_TEST_DRIVER_UID,
  RECONCILED_BY,
  LIVE_STAGES,
  SIM_STEPS,
  argValue,
  isOpenBookingStatus,
  coordinatesFromSnapshot,
  driverInfoFromUser,
  assertTestDriverFixture,
  buildDriverReleasePatch,
  mergeBookingAfterPatch,
  evaluateSyncPreflight,
  bookingMatchesOrderForReconcile,
  planReconcileBooking,
  planSimStepPatch,
  flattenTimingPatch,
  interpolateRoute,
  planMoveWrites,
  planSeedDriverDoc,
  assertNoAvailabilityFlagsInWrite
};
