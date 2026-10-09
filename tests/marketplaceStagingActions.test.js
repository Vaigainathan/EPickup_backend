const { spawnSync } = require('child_process');
const path = require('path');
const {
  confirmRequestBody,
  shortCancelRefundPreview,
  refundStubAmount,
  reviewScriptWrites,
  buildOrderShow,
  resolveCreateItems,
  assertStagingPair,
  markReadyNotifiesDrivers,
  STAGING_CUSTOMER_ID,
  STAGING_SHOP_ID
} = require('../scripts/support/marketplaceStagingActions');

describe('staging confirm body', () => {
  test('a short order uses the last 4 of the balance UTR', () => {
    const result = confirmRequestBody({
      payment: {
        status: 'short',
        customerUtr: '123456789012',
        balance: { utr: '555555555555' }
      }
    });
    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ utrLast4: '5555', withinWindowAttested: true });
    expect(result.logBody.source).toBe('balance');
    expect(JSON.stringify(result.logBody)).not.toContain('555555555555');
  });

  test('a short order with no balance UTR requires --full-utr', () => {
    const missing = confirmRequestBody({
      payment: { status: 'short', customerUtr: '123456789012', balance: { utr: null } }
    });
    expect(missing.ok).toBe(false);

    const typed = confirmRequestBody({
      payment: { status: 'short', balance: { utr: null } },
      fullUtr: '999999999999'
    });
    expect(typed.body).toEqual({ fullUtr: '999999999999', withinWindowAttested: true });
    expect(typed.logBody).toEqual({ fullUtrLast4: '9999', withinWindowAttested: true });
    expect(JSON.stringify(typed.logBody)).not.toContain('999999999999');
  });

  test('a normal confirm still uses the customer UTR', () => {
    const result = confirmRequestBody({
      payment: { status: 'customer_claimed', customerUtr: '123456789012' }
    });
    expect(result.body.utrLast4).toBe('9012');
    expect(result.logBody.source).toBe('customer');
  });
});

describe('short cancel refund amount', () => {
  test('dry run shows the received amount and the stored stub is the printed amount', () => {
    expect(shortCancelRefundPreview({ status: 'short', receivedAmount: 40 })).toBe(40);
    expect(shortCancelRefundPreview({ status: 'pending', receivedAmount: 40 })).toBeNull();
    expect(refundStubAmount([
      { reason: 'overpaid', amount: 10 },
      { reason: 'amount_short_cancel', amount: 40 }
    ])).toBe(40);
    expect(refundStubAmount([])).toBeNull();
  });
});

describe('resolve-payment-review writes', () => {
  test('--list and a dry run write nothing', () => {
    expect(reviewScriptWrites({ list: true, apply: true })).toBe(false);
    expect(reviewScriptWrites({ list: true, apply: false })).toBe(false);
    expect(reviewScriptWrites({ list: false, apply: false })).toBe(false);
    expect(reviewScriptWrites({ list: false, apply: true })).toBe(true);
  });

  test('show payload keeps the UTR last 4 and omits the note, evidence ids, and storage path', () => {
    const shown = buildOrderShow({
      orderId: 'order-1',
      data: {
        displayId: 11,
        orderStatus: 'payment_review',
        payment: {
          status: 'under_review',
          customerUtr: '246813579024',
          review: {
            status: 'open',
            trigger: 'customer_report',
            note: 'slip-note-secret',
            evidenceIds: ['ev-secret']
          }
        },
        storagePath: 'marketplaceOrders/order-1/evidence/ev-secret.jpg'
      },
      events: [{
        type: 'utr_submitted',
        actor: { type: 'customer', id: 'cust-1' },
        data: { utr: '246813579024', path: 'marketplaceOrders/order-1/evidence/ev-secret.jpg' },
        at: null
      }, {
        type: 'review_opened',
        actor: { type: 'customer', id: 'cust-1' },
        data: { trigger: 'customer_report' },
        at: null
      }],
      lock: null,
      unpaidCount: 0
    });
    const json = JSON.stringify(shown);
    expect(shown.payment.customerUtrLast4).toBe('9024');
    expect(shown.payment.customerUtr).toBeUndefined();
    expect(shown.review.trigger).toBe('customer_report');
    expect(shown.review.status).toBe('open');
    expect(json).not.toContain('246813579024');
    expect(json).not.toContain('slip-note-secret');
    expect(json).not.toContain('evidenceIds');
    expect(json).not.toContain('ev-secret');
    expect(json).not.toContain('marketplaceOrders/');
  });
});

describe('create --items', () => {
  const products = [
    { id: 'statue', name: 'Balaji', price: 1540, stock: 5, hasVariants: false, isActive: true, variants: [] },
    {
      id: 'lamp',
      name: 'Lamp',
      price: 100,
      stock: 0,
      hasVariants: true,
      isActive: true,
      variants: [{ id: 'v1', stock: 2, priceOverride: 80 }]
    }
  ];

  test('two product:qty pairs become two lines at the current price', () => {
    const resolved = resolveCreateItems('statue:1,lamp:2', products);
    expect(resolved.ok).toBe(true);
    expect(resolved.lines).toEqual([
      { productId: 'statue', qty: 1, price: 1540 },
      { productId: 'lamp', variantId: 'v1', qty: 2, price: 80 }
    ]);
  });

  test('a bad spec or an unknown product writes nothing', () => {
    expect(resolveCreateItems('statue', products).ok).toBe(false);
    expect(resolveCreateItems('statue:0', products).ok).toBe(false);
    expect(resolveCreateItems('missing:1', products).ok).toBe(false);
  });
});

describe('handover script', () => {
  test('the OTP is masked and is not printed', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join('scripts', 'support', 'test-marketplace-create.js'), 'utf8');
    const start = source.indexOf("includes('--handover')");
    const end = source.indexOf("includes('--set-stock')", start);
    const handover = source.slice(start, end);
    expect(handover).toContain("otp: '***'");
    expect(handover).not.toContain('${storedOtp}');
    expect(handover).not.toContain('otp: storedOtp');
  });
});

describe('cancel-order script', () => {
  test('dry run is the default and the script does not print an OTP or UTR', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join('scripts', 'support', 'cancel-order.js'), 'utf8');
    expect(source).toContain('assertStagingEnv');
    expect(source).toContain('assertStagingPair');
    expect(source).toContain("includes('--apply')");
    expect(source).toContain('supportCancelBeforeHandover');
    expect(source).toContain('Nothing was written.');
    expect(source).not.toContain('handoverOtp');
    expect(source).not.toContain('officialUtr');
    expect(source).not.toContain('customerUtr');
    const applyAt = source.indexOf('if (!apply)');
    const callAt = source.indexOf('supportCancelBeforeHandover');
    expect(applyAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(applyAt);
  });
});

describe('mark-ready driver notify', () => {
  test('the default does not call notifyDriversOfNewBooking', () => {
    expect(markReadyNotifiesDrivers(['node', 'script', '--mark-ready', '--order', 'abc', '--apply'])).toBe(false);
    expect(markReadyNotifiesDrivers(['--mark-ready', '--notify-drivers', '--apply'])).toBe(true);
  });
});

describe('staging actor lock', () => {
  test('only the staging shop and customer are accepted', () => {
    expect(assertStagingPair(STAGING_CUSTOMER_ID, STAGING_SHOP_ID).ok).toBe(true);
    expect(assertStagingPair(STAGING_CUSTOMER_ID, 'other-shop').ok).toBe(false);
    expect(assertStagingPair('other-customer', STAGING_SHOP_ID).ok).toBe(false);
  });

  test('another shop id exits before Firestore', () => {
    const result = spawnSync(process.execPath, [
      path.join('scripts', 'support', 'test-marketplace-create.js'),
      '--customer', STAGING_CUSTOMER_ID,
      '--shop', 'other-shop'
    ], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        FIREBASE_PROJECT_ID: 'epickup-app-staging',
        FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@epickup-app-staging.iam.gserviceaccount.com',
        FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n'
      }
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    expect(result.status).toBe(1);
    expect(output).toContain('only runs for shop b7302f5d6343c1641d63811306eb');
    expect(output).toContain('Nothing was read or written.');
    expect(output).not.toContain('Initializing Firebase');
  });
});
