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

function reviewScriptWrites({ list, apply }) {
  if (list) {
    return false;
  }
  return apply === true;
}

function toIso(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

function flagTimes(source) {
  if (!source || typeof source !== 'object') {
    return null;
  }
  const out = {};
  Object.keys(source).forEach((key) => {
    out[key] = toIso(source[key]);
  });
  return out;
}

function presentBalance(balance) {
  if (!balance || typeof balance !== 'object') {
    return null;
  }
  return {
    status: balance.status ?? null,
    dueBy: toIso(balance.dueBy),
    officialUtrLast4: last4(balance.officialUtr)
  };
}

function presentReview(payment) {
  const review = payment && payment.review;
  if (!review || typeof review !== 'object') {
    return null;
  }
  const response = review.shopResponse && typeof review.shopResponse === 'object' ? review.shopResponse : null;
  const outcome = review.outcome && typeof review.outcome === 'object' ? review.outcome : null;
  return {
    status: review.status ?? null,
    openedAt: toIso(review.openedAt),
    escalatedAt: toIso(review.escalatedAt),
    trigger: review.trigger ?? review.reason ?? null,
    shopResponse: response
      ? { result: response.result ?? null, receivedAmount: response.receivedAmount ?? null }
      : null,
    outcome: outcome ? { result: outcome.result ?? null } : null
  };
}

function presentCancellation(cancellation) {
  const source = cancellation && typeof cancellation === 'object' ? cancellation : {};
  return {
    reason: source.reason ?? null,
    shopReason: typeof source.shopReason === 'string' ? source.shopReason : null,
    cancelledAt: toIso(source.cancelledAt),
    cancelledBy: source.cancelledBy ?? null,
    paidCheck: source.paidCheck ?? null,
    paidCheckAt: toIso(source.paidCheckAt),
    paidCheckEscalatedAt: toIso(source.paidCheckEscalatedAt)
  };
}

function presentRefund(refund) {
  const source = refund && typeof refund === 'object' ? refund : {};
  const row = {
    id: source.id ?? null,
    reason: source.reason ?? null,
    status: source.status ?? null,
    amount: source.amount ?? null,
    dueBy: toIso(source.dueBy),
    refundUtrLast4: last4(source.refundUtr),
    createdAt: toIso(source.createdAt)
  };
  if (typeof source.closedBy === 'string' && source.closedBy) {
    row.closedBy = source.closedBy;
  }
  return row;
}

function presentEvent(data) {
  const event = data && typeof data === 'object' ? data : {};
  const actor = event.actor && typeof event.actor === 'object' ? event.actor : {};
  const shown = {
    type: event.type ?? null,
    actor: {
      type: actor.type ?? null,
      id: actor.id ?? null
    },
    at: toIso(event.at)
  };
  if (event.data && typeof event.data === 'object') {
    if (event.data.mode != null) {
      shown.mode = event.data.mode;
    }
    if (event.data.trigger != null) {
      shown.trigger = event.data.trigger;
    }
    if (event.data.hoursOpen != null) {
      shown.hoursOpen = event.data.hoursOpen;
    }
    if (event.data.result != null) {
      shown.result = event.data.result;
    }
    if (event.data.legacy === true) {
      shown.legacy = true;
    }
    if (event.data.stockShort === true) {
      shown.stockShort = true;
    }
    if (Array.isArray(event.data.lines)) {
      shown.lines = event.data.lines.map((line) => {
        const row = {
          id: line.id ?? null,
          productId: line.productId ?? null,
          variantId: line.variantId ?? null
        };
        if (line.qty != null) {
          row.qty = line.qty;
        }
        if (line.stockDeducted != null) {
          row.stockDeducted = line.stockDeducted;
        }
        if (line.units != null) {
          row.units = line.units;
        }
        if (line.missing === true) {
          row.missing = true;
        }
        return row;
      });
    }
  }
  return shown;
}

function buildOrderShow({ orderId, data, events, lock, unpaidCount, refunds, lines }) {
  const source = data && typeof data === 'object' ? data : {};
  const payment = source.payment && typeof source.payment === 'object' ? source.payment : {};
  const shownEvents = (Array.isArray(events) ? events : []).map(presentEvent);
  shownEvents.sort((left, right) => String(left.at || '').localeCompare(String(right.at || '')));
  const lockData = lock && typeof lock === 'object' ? lock : null;
  return {
    show: true,
    wrote: false,
    orderId,
    displayId: source.displayId ?? null,
    orderStatus: source.orderStatus ?? null,
    closedReason: source.closedReason ?? null,
    stockShort: source.stockShort === true,
    lines: Array.isArray(lines) ? lines : [],
    payment: {
      status: payment.status ?? null,
      receivedAmount: payment.receivedAmount ?? null,
      customerUtrLast4: last4(payment.customerUtr),
      officialUtrLast4: last4(payment.officialUtr),
      balance: presentBalance(payment.balance),
      nudges: flagTimes(payment.nudges),
      remindersSent: flagTimes(payment.remindersSent)
    },
    review: presentReview(payment),
    cancellation: presentCancellation(source.cancellation),
    hasOpenRefund: source.hasOpenRefund === true,
    refunds: (Array.isArray(refunds) ? refunds : []).map(presentRefund),
    events: shownEvents,
    lock: {
      exists: Boolean(lockData),
      orderId: lockData && lockData.orderId ? lockData.orderId : null
    },
    unpaidCount: unpaidCount ?? null
  };
}

const STAGING_CUSTOMER_ID = 'Ue51a7afbc981f1b92cf30be32ab';
const STAGING_SHOP_ID = 'b7302f5d6343c1641d63811306eb';

function assertStagingPair(customerId, shopId) {
  if (customerId === STAGING_CUSTOMER_ID && shopId === STAGING_SHOP_ID) {
    return { ok: true };
  }
  return {
    ok: false,
    message: 'This script only runs for shop b7302f5d6343c1641d63811306eb and customer Ue51a7afbc981f1b92cf30be32ab. Nothing was read or written.'
  };
}

function parseItemsFlag(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {
      ok: false,
      message: '--items needs productId:qty,productId:qty. Nothing was written.'
    };
  }
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return {
      ok: false,
      message: '--items needs productId:qty,productId:qty. Nothing was written.'
    };
  }
  const specs = [];
  for (let index = 0; index < parts.length; index += 1) {
    const spec = parts[index];
    const splitAt = spec.lastIndexOf(':');
    const productId = splitAt > 0 ? spec.slice(0, splitAt).trim() : '';
    const qtyText = splitAt > 0 ? spec.slice(splitAt + 1).trim() : '';
    if (!productId || !/^[1-9][0-9]*$/.test(qtyText)) {
      return {
        ok: false,
        message: '--items needs productId:qty,productId:qty. Nothing was written.'
      };
    }
    specs.push({ productId, qty: Number(qtyText) });
  }
  return { ok: true, specs };
}

function resolveCreateItems(raw, products) {
  const parsed = parseItemsFlag(raw);
  if (!parsed.ok) {
    return parsed;
  }
  const catalogue = Array.isArray(products) ? products : [];
  const lines = [];
  for (let index = 0; index < parsed.specs.length; index += 1) {
    const spec = parsed.specs[index];
    const product = catalogue.find((row) => row && row.id === spec.productId && row.isActive !== false);
    if (!product) {
      return {
        ok: false,
        message: `Product ${spec.productId} is not an active product of this shop. Nothing was written.`
      };
    }
    let price = product.price;
    let variantId = null;
    if (product.hasVariants === true) {
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const variant = variants.find((row) => Number(row.stock) >= spec.qty) || variants[0];
      if (!variant || !variant.id) {
        return {
          ok: false,
          message: `Product ${spec.productId} has no variant. Nothing was written.`
        };
      }
      variantId = variant.id;
      if (typeof variant.priceOverride === 'number') {
        price = variant.priceOverride;
      }
    }
    const line = {
      productId: spec.productId,
      qty: spec.qty,
      price
    };
    if (variantId) {
      line.variantId = variantId;
    }
    lines.push(line);
  }
  return { ok: true, lines };
}

module.exports = {
  confirmRequestBody,
  shortCancelRefundPreview,
  refundStubAmount,
  parseItemsFlag,
  resolveCreateItems,
  assertStagingPair,
  STAGING_CUSTOMER_ID,
  STAGING_SHOP_ID,
  reviewScriptWrites,
  buildOrderShow
};
