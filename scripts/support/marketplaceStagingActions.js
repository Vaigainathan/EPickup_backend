function last4(value) {
  return typeof value === 'string' && value.length >= 4 ? value.slice(-4) : null;
}

function confirmRequestBody({ payment, fullUtr }) {
  const source = payment && typeof payment === 'object' ? payment : {};
  const balance = source.balance && typeof source.balance === 'object' ? source.balance : {};
  if (typeof fullUtr === 'string' && fullUtr.length > 0) {
    return {
      ok: true,
      body: { fullUtr, withinWindowAttested: true },
      logBody: { fullUtrLast4: last4(fullUtr), withinWindowAttested: true }
    };
  }
  if (source.status === 'short') {
    const utrLast4 = last4(balance.utr);
    if (!utrLast4) {
      return {
        ok: false,
        message: 'Short order has no balance UTR. Re-run with --full-utr <12 digits>.'
      };
    }
    return {
      ok: true,
      body: { utrLast4, withinWindowAttested: true },
      logBody: { utrLast4, withinWindowAttested: true, source: 'balance' }
    };
  }
  const utrLast4 = last4(source.customerUtr);
  if (!utrLast4) {
    return {
      ok: false,
      message: 'No locked order with a customer UTR to confirm.'
    };
  }
  return {
    ok: true,
    body: { utrLast4, withinWindowAttested: true },
    logBody: { utrLast4, withinWindowAttested: true, source: 'customer' }
  };
}

function shortCancelRefundPreview(payment) {
  if (!payment || payment.status !== 'short') {
    return null;
  }
  return payment.receivedAmount != null ? payment.receivedAmount : null;
}

function refundStubAmount(refunds) {
  const list = Array.isArray(refunds) ? refunds : [];
  const stub = list.find((item) => item && item.reason === 'amount_short_cancel');
  if (!stub) {
    return null;
  }
  return stub.amount != null ? stub.amount : null;
}

module.exports = {
  confirmRequestBody,
  shortCancelRefundPreview,
  refundStubAmount
};
