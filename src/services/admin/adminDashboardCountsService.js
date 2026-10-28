const { getFirestore } = require('firebase-admin/firestore');
const { ONGOING_ORDER_STATUSES } = require('../marketplace/orderStateMachine');

/** Same statuses as GET /api/admin/bookings/active (admin list view). */
const ADMIN_LIST_ACTIVE_BOOKING_STATUSES = [
  'pending',
  'driver_assigned',
  'accepted',
  'driver_enroute',
  'driver_arrived',
  'picked_up',
  'in_transit'
];

function getISTDayBounds(now = new Date()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth();
  const day = istNow.getUTCDate();
  const startOfDay = new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  return { startOfDay, endOfDay };
}

async function firestoreCount(query) {
  const snapshot = await query.count().get();
  return snapshot.data().count;
}

async function fetchDashboardCounts({ now = new Date(), db = getFirestore() } = {}) {
  const { startOfDay, endOfDay } = getISTDayBounds(now);

  const users = db.collection('users');
  const bookings = db.collection('bookings');
  const marketplaceOrders = db.collection('marketplaceOrders');

  const [
    driversTotal,
    driversOnline,
    driversVerified,
    customersTotal,
    bookingsTotal,
    bookingsActive,
    bookingsToday,
    shopsTotal,
    shopsApproved,
    shopsPending,
    marketplaceOrdersToday,
    marketplaceOrdersActive
  ] = await Promise.all([
    firestoreCount(users.where('userType', '==', 'driver')),
    firestoreCount(users.where('userType', '==', 'driver').where('driver.isOnline', '==', true)),
    firestoreCount(users.where('userType', '==', 'driver').where('isVerified', '==', true)),
    firestoreCount(users.where('userType', '==', 'customer')),
    firestoreCount(bookings),
    firestoreCount(bookings.where('status', 'in', ADMIN_LIST_ACTIVE_BOOKING_STATUSES)),
    firestoreCount(
      bookings.where('createdAt', '>=', startOfDay).where('createdAt', '<', endOfDay)
    ),
    firestoreCount(users.where('userType', '==', 'shop')),
    firestoreCount(users.where('userType', '==', 'shop').where('shop.approvalStatus', '==', 'approved')),
    firestoreCount(users.where('userType', '==', 'shop').where('shop.approvalStatus', '==', 'pending')),
    firestoreCount(
      marketplaceOrders.where('createdAt', '>=', startOfDay).where('createdAt', '<', endOfDay)
    ),
    firestoreCount(marketplaceOrders.where('orderStatus', 'in', ONGOING_ORDER_STATUSES))
  ]);

  return {
    drivers: {
      total: driversTotal,
      online: driversOnline,
      verified: driversVerified
    },
    customers: { total: customersTotal },
    bookings: {
      total: bookingsTotal,
      active: bookingsActive,
      today: bookingsToday
    },
    shops: {
      total: shopsTotal,
      approved: shopsApproved,
      pending: shopsPending
    },
    marketplaceOrders: {
      today: marketplaceOrdersToday,
      active: marketplaceOrdersActive
    }
  };
}

function buildAdminDriversFilterQuery(db, { status, verificationStatus, online } = {}) {
  let query = db.collection('users').where('userType', '==', 'driver');
  if (status) {
    query = query.where('isActive', '==', status === 'active');
  }
  if (verificationStatus) {
    query = query.where('isVerified', '==', verificationStatus === 'verified');
  }
  if (online === true || online === 'true') {
    query = query.where('driver.isOnline', '==', true);
  }
  return query;
}

function buildAdminBookingsFilterQuery(db, { status, dateFrom, dateTo, sourceType } = {}) {
  let query = db.collection('bookings');
  if (sourceType === 'marketplace' || String(sourceType).toLowerCase() === 'marketplace') {
    query = query.where('sourceType', '==', 'marketplace');
  }
  if (status) {
    query = query.where('status', '==', status);
  }
  if (dateFrom) {
    query = query.where('createdAt', '>=', new Date(dateFrom));
  }
  if (dateTo) {
    query = query.where('createdAt', '<=', new Date(dateTo));
  }
  return query;
}

module.exports = {
  ADMIN_LIST_ACTIVE_BOOKING_STATUSES,
  getISTDayBounds,
  fetchDashboardCounts,
  buildAdminDriversFilterQuery,
  buildAdminBookingsFilterQuery,
  firestoreCount
};
