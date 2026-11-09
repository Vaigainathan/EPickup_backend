function toNumber(value, defaultValue = 0) {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const GROSS_AMOUNT_SOURCES = [
  (b) => ({ field: 'pricing.totalAmount', value: b.pricing?.totalAmount }),
  (b) => ({ field: 'pricing.total', value: b.pricing?.total }),
  (b) => ({ field: 'pricing.fare', value: b.pricing?.fare }),
  (b) => ({ field: 'pricing.grandTotal', value: b.pricing?.grandTotal }),
  (b) => ({ field: 'pricing.totalFare', value: b.pricing?.totalFare }),
  (b) => ({ field: 'payment.amount', value: b.payment?.amount }),
  (b) => ({ field: 'payment.total', value: b.payment?.total }),
  (b) => ({ field: 'fare.total', value: b.fare?.total }),
  (b) => ({ field: 'fare.grossFare', value: b.fare?.grossFare }),
  (b) => ({ field: 'fare.amount', value: b.fare?.amount }),
  (b) => ({ field: 'fare.totalFare', value: b.fare?.totalFare }),
  (b) => ({ field: 'driverEarnings', value: b.driverEarnings }),
  (b) => ({ field: 'earnings.grossFare', value: b.earnings?.grossFare }),
  (b) => ({ field: 'earnings.totalCollected', value: b.earnings?.totalCollected }),
  (b) => ({ field: 'totalAmount', value: b.totalAmount }),
  (b) => ({ field: 'amount', value: b.amount }),
  (b) => ({ field: 'price', value: b.price })
];

/**
 * Authoritative gross cash fare for a booking document (parcel or marketplace delivery leg).
 */
function resolveGrossOrderAmount(bookingData = {}) {
  const resolved = resolveGrossOrderAmountWithSource(bookingData);
  return resolved.amount;
}

function resolveGrossOrderAmountWithSource(bookingData = {}) {
  for (const pick of GROSS_AMOUNT_SOURCES) {
    const { field, value } = pick(bookingData);
    const amount = toNumber(value, 0);
    if (amount > 0) {
      return { amount, field };
    }
  }
  return { amount: 0, field: null };
}

/**
 * Legacy chain before fare.totalFare was added (for regression comparison in tests).
 */
function resolveGrossOrderAmountLegacy(bookingData = {}) {
  return toNumber(
    bookingData.pricing?.totalAmount ??
      bookingData.pricing?.total ??
      bookingData.pricing?.fare ??
      bookingData.pricing?.grandTotal ??
      bookingData.pricing?.totalFare ??
      bookingData.payment?.amount ??
      bookingData.payment?.total ??
      bookingData.fare?.total ??
      bookingData.fare?.grossFare ??
      bookingData.fare?.amount ??
      bookingData.driverEarnings ??
      bookingData.earnings?.grossFare ??
      bookingData.earnings?.totalCollected ??
      bookingData.totalAmount ??
      bookingData.amount ??
      bookingData.price ??
      0,
    0
  );
}

module.exports = {
  resolveGrossOrderAmount,
  resolveGrossOrderAmountWithSource,
  resolveGrossOrderAmountLegacy,
  toNumber
};
