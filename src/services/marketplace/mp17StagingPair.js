const STAGING_TEST_CUSTOMER_ID = 'Ue51a7afbc981f1b92cf30be32ab';
const STAGING_TEST_SHOP_ID = 'b7302f5d6343c1641d63811306eb';

const STAGING_TEST_PAIR = {
  customerId: STAGING_TEST_CUSTOMER_ID,
  shopId: STAGING_TEST_SHOP_ID
};

const SKIP_NOT_TEST_PAIR = 'not_test_pair';

function orderMatchesStagingTestPair(orderData, pair) {
  const source = orderData && typeof orderData === 'object' ? orderData : null;
  const target = pair && pair.customerId && pair.shopId ? pair : STAGING_TEST_PAIR;
  if (!source) {
    return false;
  }
  return source.customerId === target.customerId && source.shopId === target.shopId;
}

function ticketMatchesStagingTestPair(ticket, pair) {
  const source = ticket && typeof ticket === 'object' ? ticket : null;
  const target = pair && pair.customerId && pair.shopId ? pair : STAGING_TEST_PAIR;
  if (!source) {
    return false;
  }
  return source.customerId === target.customerId && source.shopId === target.shopId;
}

function refundMatchesStagingTestPair(refund, orderData, pair) {
  const target = pair && pair.customerId && pair.shopId ? pair : STAGING_TEST_PAIR;
  if (orderData && orderMatchesStagingTestPair(orderData, target)) {
    return true;
  }
  const source = refund && typeof refund === 'object' ? refund : null;
  if (!source) {
    return false;
  }
  return source.customerId === target.customerId && source.shopId === target.shopId;
}

function stagingApplyBlocked(orderData, options) {
  if (!options || options.stagingApplyLock !== true) {
    return false;
  }
  const pair = options.only || options.stagingPair || STAGING_TEST_PAIR;
  return !orderMatchesStagingTestPair(orderData, pair);
}

function recordStagingSkip(skipped, entry) {
  if (!Array.isArray(skipped)) {
    return;
  }
  skipped.push({ ...entry, reason: SKIP_NOT_TEST_PAIR });
}

module.exports = {
  SKIP_NOT_TEST_PAIR,
  STAGING_TEST_CUSTOMER_ID,
  STAGING_TEST_PAIR,
  STAGING_TEST_SHOP_ID,
  orderMatchesStagingTestPair,
  recordStagingSkip,
  refundMatchesStagingTestPair,
  stagingApplyBlocked,
  ticketMatchesStagingTestPair
};
