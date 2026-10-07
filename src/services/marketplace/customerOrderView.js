// The customer app can read the main marketplaceOrders document directly via Firestore rules; never store shop-internal or secret data on it — use private/ subdocuments.

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
    deliveryAddress: source.deliveryAddress ?? null,
    window: copyWindow(source.window),
    verifiedPayeeName: source.verifiedPayeeName ?? null,
    policyGroup: source.policyGroup ?? null,
    shopSnapshot: source.shopSnapshot ?? null,
    notes: {
      customerNote: source.customerNote ?? null,
      riderNotes: source.riderNotes ?? null,
      riderNoteText: source.riderNoteText ?? null
    },
    orderStatus: source.orderStatus ?? null,
    displayId: source.displayId ?? null,
    linkedBookingId: source.linkedBookingId ?? null,
    driverInfo: source.driverInfo ?? null,
    payment: {
      ...copyPayment(source.payment),
      balance: copyBalance(source.payment)
    },
    cancellation: {
      reason: cancellation.reason ?? null,
      cancelledAt: toIso(cancellation.cancelledAt),
      cancelledBy: cancellation.cancelledBy ?? null,
      paidCheck: typeof cancellation.paidCheck === 'string' ? cancellation.paidCheck : null,
      paidCheckAt: toIso(cancellation.paidCheckAt)
    },
    createdAt: toIso(source.createdAt),
    updatedAt: toIso(source.updatedAt)
  };
}

function presentCustomerOrderSummary(order) {
  const view = presentCustomerOrder(order);
  const items = Array.isArray(view.items) ? view.items : [];
  const first = items[0] || null;
  const snapshot = view.shopSnapshot && typeof view.shopSnapshot === 'object' ? view.shopSnapshot : {};
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
    window: view.window
  };
}

module.exports = {
  presentCustomerOrder,
  presentCustomerOrderSummary
};
