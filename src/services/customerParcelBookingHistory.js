const { withParcelSource } = require('./parcelSourceFilter');

const CUSTOMER_PARCEL_HISTORY_KEYS = [
  'id',
  'displayId',
  'status',
  'createdAt',
  'updatedAt',
  'completedAt',
  'deliveryCompletedAt',
  'deliveredAt',
  'amount',
  'totalFare',
  'sourceType',
  'reorderedFrom',
  'originalBookingId',
  'cancellationReason',
  'cancellationReasonText',
  'cancelledAt',
  'cancellation',
  'pickup',
  'pickupInfo',
  'pickupLocation',
  'dropoff',
  'dropoffInfo',
  'deliveryLocation',
  'package',
  'packageDetails',
  'fare',
  'pricing',
  'payment',
  'paymentMethod',
  'paymentStatus',
  'distance',
  'trip',
  'vehicle',
  'vehicleType',
  'driver',
  'driverInfo',
  'rating',
  'review'
];

const COMPLETED_HISTORY_STATUSES = [
  'delivered',
  'completed',
  'cancelled',
  'customer_cancelled',
  'driver_cancelled'
];

function toHistoryDate(value) {
  if (value == null) {
    return value;
  }
  if (typeof value.toDate === 'function') {
    return value.toDate();
  }
  return value;
}

function normalizeHistoryTimestamps(id, data) {
  const source = data || {};
  const createdAt = toHistoryDate(source.createdAt);
  const updatedAt = toHistoryDate(source.updatedAt);
  const completedAt = toHistoryDate(source.completedAt) || source.completedAt
    || toHistoryDate(source.deliveredAt) || source.deliveredAt
    || toHistoryDate(source.cancelledAt) || source.cancelledAt
    || updatedAt;

  return {
    id,
    ...source,
    createdAt,
    updatedAt,
    completedAt
  };
}

function rowFromDoc(doc) {
  return normalizeHistoryTimestamps(doc.id, doc.data());
}

function presentFare(fare, pricing, topLevelTotalFare) {
  const src = fare && typeof fare === 'object' ? fare : {};
  const pr = pricing && typeof pricing === 'object' ? pricing : {};
  const totalFare = src.totalFare != null ? src.totalFare
    : (topLevelTotalFare != null ? topLevelTotalFare : pr.totalFare);
  const total = src.total != null ? src.total : totalFare;
  const currency = src.currency != null ? src.currency : (pr.currency != null ? pr.currency : 'INR');
  const out = {};
  if (total != null) {
    out.total = total;
  }
  if (totalFare != null) {
    out.totalFare = totalFare;
  }
  if (currency != null) {
    out.currency = currency;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function presentPricing(pricing, fare, topLevelTotalFare) {
  const pr = pricing && typeof pricing === 'object' ? pricing : {};
  const fareSrc = fare && typeof fare === 'object' ? fare : {};
  const totalFare = pr.totalFare != null ? pr.totalFare
    : (topLevelTotalFare != null ? topLevelTotalFare : fareSrc.totalFare);
  const currency = pr.currency != null ? pr.currency : (fareSrc.currency != null ? fareSrc.currency : 'INR');
  const out = {};
  if (totalFare != null) {
    out.totalFare = totalFare;
  }
  if (currency != null) {
    out.currency = currency;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function presentCustomerParcelBookingHistory(row) {
  const normalized = row && row.id ? row : normalizeHistoryTimestamps(row.id, row);
  const presented = { id: normalized.id };

  CUSTOMER_PARCEL_HISTORY_KEYS.forEach((key) => {
    if (key === 'id' || key === 'fare' || key === 'pricing') {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(normalized, key) && normalized[key] !== undefined) {
      presented[key] = normalized[key];
    }
  });

  const fare = presentFare(normalized.fare, normalized.pricing, normalized.totalFare);
  if (fare !== undefined) {
    presented.fare = fare;
  }
  const pricing = presentPricing(normalized.pricing, normalized.fare, normalized.totalFare);
  if (pricing !== undefined) {
    presented.pricing = pricing;
  }

  return presented;
}

async function listCustomerParcelBookings(db, userId, options = {}) {
  const { status, limit = 20, offset = 0 } = options;
  const limitNum = parseInt(limit, 10) || 20;
  const offsetNum = parseInt(offset, 10) || 0;

  if (!status) {
    const fetchLimit = Math.max(limitNum * 3, 50);
    const query = withParcelSource(db.collection('bookings')
      .where('customerId', '==', userId))
      .orderBy('createdAt', 'desc')
      .limit(fetchLimit);

    const snapshot = await query.get();
    const allBookings = [];
    snapshot.forEach((doc) => {
      allBookings.push(rowFromDoc(doc));
    });

    const filteredBookings = allBookings.filter((b) => {
      const bookingStatus = (b.status || '').toLowerCase();
      return COMPLETED_HISTORY_STATUSES.some((s) => bookingStatus === s.toLowerCase());
    });

    filteredBookings.sort((a, b) => {
      const dateA = a.completedAt ? new Date(a.completedAt).getTime() : new Date(a.createdAt).getTime();
      const dateB = b.completedAt ? new Date(b.completedAt).getTime() : new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    const totalCount = filteredBookings.length;
    const paginatedBookings = filteredBookings.slice(offsetNum, offsetNum + limitNum);

    return {
      data: paginatedBookings,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        total: totalCount,
        hasMore: (offsetNum + paginatedBookings.length) < totalCount
      }
    };
  }

  const query = withParcelSource(db.collection('bookings')
    .where('customerId', '==', userId)
    .where('status', '==', status))
    .orderBy('createdAt', 'desc');

  const snapshot = await query.limit(limitNum + offsetNum).get();
  const allBookings = [];
  snapshot.forEach((doc) => {
    allBookings.push(rowFromDoc(doc));
  });

  const paginatedBookings = allBookings.slice(offsetNum, offsetNum + limitNum);

  return {
    data: paginatedBookings,
    pagination: {
      limit: limitNum,
      offset: offsetNum,
      total: allBookings.length,
      hasMore: (offsetNum + paginatedBookings.length) < allBookings.length
    }
  };
}

module.exports = {
  CUSTOMER_PARCEL_HISTORY_KEYS,
  normalizeHistoryTimestamps,
  presentCustomerParcelBookingHistory,
  listCustomerParcelBookings
};
