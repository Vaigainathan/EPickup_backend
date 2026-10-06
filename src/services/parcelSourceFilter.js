function isParcelSourceFilterEnabled() {
  return process.env.FEATURE_PARCEL_SOURCE_FILTER === 'true';
}

function withParcelSource(query) {
  if (!isParcelSourceFilterEnabled()) {
    return query;
  }
  return query.where('sourceType', '==', 'parcel');
}

function marketplaceBookingRejection(data, context = {}) {
  if (!isParcelSourceFilterEnabled()) {
    return null;
  }
  if (!data || data.sourceType !== 'marketplace') {
    return null;
  }
  const bookingId = context.bookingId;
  const route = context.route;
  const customerId = context.customerId;
  console.log(`[ParcelFilter] rejected marketplace booking ${bookingId} on ${route} for customer ${customerId}`);
  return {
    status: 409,
    body: {
      success: false,
      error: 'Not a parcel booking',
      code: 'MARKETPLACE_BOOKING'
    }
  };
}

module.exports = {
  isParcelSourceFilterEnabled,
  withParcelSource,
  marketplaceBookingRejection
};
