// The customer app can read the main marketplaceOrders document directly via Firestore rules; never store shop-internal or secret data on it — use private/ subdocuments.

const PAYMENT_FIELDS = [
  'status',
  'shopUpiId',
  'amount',
  'transactionReference',
  'customerUtr',
  'customerUpiId',
  'initiatedAt',
  'confirmedAt',
  'expiredAt',
  'refundedAt'
];

function copyPayment(payment) {
  const source = payment && typeof payment === 'object' ? payment : {};
  const copied = {};
  PAYMENT_FIELDS.forEach((field) => {
    copied[field] = source[field] === undefined ? null : source[field];
  });
  return copied;
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
    window: source.window ?? null,
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
    payment: copyPayment(source.payment),
    cancellation: {
      reason: cancellation.reason ?? null,
      cancelledAt: cancellation.cancelledAt ?? null,
      cancelledBy: cancellation.cancelledBy ?? null
    },
    createdAt: source.createdAt ?? null,
    updatedAt: source.updatedAt ?? null
  };
}

module.exports = {
  presentCustomerOrder
};
