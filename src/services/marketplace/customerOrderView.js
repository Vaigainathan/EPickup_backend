// Customers read marketplace orders through the API. The signal document is the only client-readable change notice.
const { presentCustomerRefund } = require('./refunds');

const PAYMENT_FIELDS = [
  'status',
  'shopUpiId',
  'amount',
  'transactionReference',
  'customerUtr',
  'officialUtr',
  'receivedAmount',
  'receivedAmountPaise',
  'customerUpiId',
  'utrSubmittedAt',
  'initiatedAt',
  'confirmedAt',
  'expiredAt',
  'refundedAt'
];

const PAYMENT_TIME_FIELDS = ['initiatedAt', 'confirmedAt', 'expiredAt', 'refundedAt', 'utrSubmittedAt'];

function toIso(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return null;
}

function copyWindow(window) {
  if (!window || typeof window !== 'object') {
    return null;
  }
  return {
    start: toIso(window.start),
    end: toIso(window.end)
  };
}

function copyPayment(payment) {
  const source = payment && typeof payment === 'object' ? payment : {};
  const copied = {};
  PAYMENT_FIELDS.forEach((field) => {
    const value = source[field] === undefined ? null : source[field];
    copied[field] = PAYMENT_TIME_FIELDS.includes(field) ? toIso(value) : value;
  });
  return copied;
}

function copyBalance(payment) {
  const source = payment && typeof payment === 'object' ? payment : {};
  const balance = source.balance && typeof source.balance === 'object' ? source.balance : null;
  if (!balance) {
    return null;
  }
  return {
    amount: balance.amount ?? null,
    amountPaise: balance.amountPaise ?? null,
    dueBy: toIso(balance.dueBy),
    utr: balance.utr ?? null,
    officialUtr: balance.officialUtr ?? null,
    submittedAt: toIso(balance.submittedAt),
    confirmedAt: toIso(balance.confirmedAt)
  };
}

function presentCustomerRating(rating) {
  if (!rating || typeof rating !== 'object') {
    return null;
  }
  return {
    shopStars: rating.shopStars ?? null,
    driverStars: rating.driverStars ?? null,
    ratedAt: toIso(rating.ratedAt)
  };
}

function refundStatusFromEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  if (typeof entry.status === 'string') {
    return entry.status;
  }
  if (entry.data && typeof entry.data.status === 'string') {
    return entry.data.status;
  }
  return null;
}

/**
 * Customer refund CTA for list rows. Uses order-doc fields or refunds already on `source`
 * (detail load). List queries do not load refunds — returns null unless denormalized.
 */
function deriveCustomerRefundAction(source) {
  const raw = source && typeof source === 'object' ? source : {};
  if (raw.customerRefundAction === 'share_upi' || raw.customerRefundAction === 'confirm_received') {
    return raw.customerRefundAction;
  }
  const refunds = Array.isArray(raw.refunds) ? raw.refunds : null;
  if (!refunds || refunds.length === 0) {
    return null;
  }
  const statuses = refunds.map(refundStatusFromEntry).filter(Boolean);
  if (statuses.includes('upi_needed')) {
    return 'share_upi';
  }
  if (statuses.includes('sent')) {
    return 'confirm_received';
  }
  return null;
}

function balanceUtrSubmitted(payment) {
  const source = payment && typeof payment === 'object' ? payment : {};
  const balance = source.balance && typeof source.balance === 'object' ? source.balance : null;
  if (!balance) {
    return false;
  }
  const utr = balance.utr ?? balance.officialUtr;
  return typeof utr === 'string' && utr.trim() !== '';
}

const DELIVERY_STAGE_TIME_KEYS = ['assigned', 'at_shop', 'picked_up', 'on_the_way', 'delivered'];

function deliveredAtIso(source) {
  const delivery = source && source.delivery && typeof source.delivery === 'object'
    ? source.delivery
    : null;
  return delivery ? toIso(delivery.deliveredAt) : null;
}

function presentDeliveryStageTimes(delivery) {
  const stageTimes = delivery && delivery.stageTimes && typeof delivery.stageTimes === 'object'
    ? delivery.stageTimes
    : {};
  const out = {};
  DELIVERY_STAGE_TIME_KEYS.forEach((key) => {
    out[key] = toIso(stageTimes[key]);
  });
  return out;
}

function presentCustomerDriverInfo(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : null;
  const phone = typeof raw.phone === 'string' && raw.phone.trim() !== '' ? raw.phone : null;
  const vehicle = typeof raw.vehicle === 'string' && raw.vehicle.trim() !== ''
    ? raw.vehicle
    : (typeof raw.vehicleNumber === 'string' && raw.vehicleNumber.trim() !== ''
      ? raw.vehicleNumber
      : null);
  if (!name && !phone && !vehicle) {
    return null;
  }
  return { name, vehicle, phone };
}

function presentShopSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const rawAddress = snapshot.address;
  const address = typeof rawAddress === 'string' ? rawAddress.trim() : '';
  return {
    name: snapshot.name ?? null,
    category: snapshot.category ?? null,
    phone: snapshot.phone ?? null,
    address: address === '' ? null : address
  };
}

function presentCustomerReview(review) {
  if (!review || typeof review !== 'object') {
    return null;
  }
  const outcome = review.outcome && typeof review.outcome === 'object' ? review.outcome : null;
  return {
    status: review.status ?? null,
    openedAt: toIso(review.openedAt),
    outcome: { result: outcome && outcome.result ? outcome.result : null }
  };
}

function presentCustomerOrder(order) {
  const source = order && typeof order === 'object' ? order : {};
  const cancellation = source.cancellation && typeof source.cancellation === 'object'
    ? source.cancellation
    : {};
  return {
    id: source.id ?? null,
    shopId: source.shopId ?? null,
    customerId: source.customerId ?? null,
    items: Array.isArray(source.items) ? source.items : [],
    itemsTotal: source.itemsTotal ?? null,
    itemsTotalPaise: source.itemsTotalPaise ?? null,
    amountAdjustmentPaise: source.amountAdjustmentPaise ?? null,
    expectedAmount: source.expectedAmount ?? null,
    expectedAmountPaise: source.expectedAmountPaise ?? null,
    deliveryFee: source.deliveryFee ?? null,
    readyAt: toIso(source.readyAt),
    delivery: {
      stage: source.delivery && typeof source.delivery.stage === 'string' ? source.delivery.stage : null,
      fare: source.delivery && typeof source.delivery.fare === 'number' ? source.delivery.fare : null,
      deliveredAt: source.delivery && source.delivery.deliveredAt != null
        ? toIso(source.delivery.deliveredAt)
        : null,
      stageTimes: presentDeliveryStageTimes(source.delivery)
    },
    deliveryAddress: source.deliveryAddress ?? null,
    window: copyWindow(source.window),
    verifiedPayeeName: source.verifiedPayeeName ?? null,
    policyGroup: source.policyGroup ?? null,
    shopSnapshot: presentShopSnapshot(source.shopSnapshot),
    notes: {
      customerNote: source.customerNote ?? null,
      riderNotes: source.riderNotes ?? null,
      riderNoteText: source.riderNoteText ?? null
    },
    orderStatus: source.orderStatus ?? null,
    displayId: source.displayId ?? null,
    linkedBookingId: source.linkedBookingId ?? null,
    driverInfo: presentCustomerDriverInfo(source.driverInfo),
    payment: {
      ...copyPayment(source.payment),
      balance: copyBalance(source.payment)
    },
    review: presentCustomerReview(source.payment && source.payment.review),
    cancellation: {
      reason: cancellation.reason ?? null,
      shopReason: typeof cancellation.shopReason === 'string' ? cancellation.shopReason : null,
      cancelledAt: toIso(cancellation.cancelledAt),
      cancelledBy: cancellation.cancelledBy ?? null,
      paidCheck: typeof cancellation.paidCheck === 'string' ? cancellation.paidCheck : null,
      paidCheckAt: toIso(cancellation.paidCheckAt)
    },
    createdAt: toIso(source.createdAt),
    updatedAt: toIso(source.updatedAt),
    hasOpenRefund: source.hasOpenRefund === true,
    hasOpenHelp: source.hasOpenHelp === true,
    help: source.help && typeof source.help === 'object' ? source.help : null,
    rating: presentCustomerRating(source.rating),
    refunds: (Array.isArray(source.refunds) ? source.refunds : []).map(presentCustomerRefund)
  };
}

function presentCustomerOrderSummary(order) {
  const source = order && typeof order === 'object' ? order : {};
  const view = presentCustomerOrder(order);
  const items = Array.isArray(view.items) ? view.items : [];
  const first = items[0] || null;
  const snapshot = view.shopSnapshot && typeof view.shopSnapshot === 'object' ? view.shopSnapshot : {};
  const payment = view.payment && typeof view.payment === 'object' ? view.payment : {};
  return {
    id: view.id,
    displayId: view.displayId,
    orderStatus: view.orderStatus,
    shopSnapshot: { name: snapshot.name ?? null },
    itemsCount: items.length,
    firstItemName: first && typeof first.name === 'string' ? first.name : null,
    expectedAmount: view.expectedAmount,
    expectedAmountPaise: view.expectedAmountPaise,
    createdAt: view.createdAt,
    window: view.window,
    rating: view.rating,
    hasOpenHelp: view.hasOpenHelp === true,
    paymentStatus: payment.status ?? null,
    balanceSubmitted: balanceUtrSubmitted(source.payment),
    deliveryStage: view.delivery && typeof view.delivery.stage === 'string' ? view.delivery.stage : null,
    hasOpenRefund: view.hasOpenRefund === true,
    refundAction: deriveCustomerRefundAction(source),
    policyGroup: view.policyGroup ?? null,
    deliveredAt: deliveredAtIso(source)
  };
}

module.exports = {
  copyWindow,
  DELIVERY_STAGE_TIME_KEYS,
  presentCustomerOrder,
  presentCustomerOrderSummary,
  presentCustomerDriverInfo,
  presentShopSnapshot,
  presentDeliveryStageTimes,
  deriveCustomerRefundAction
};
