const { STAGING_SHOP_ID } = require('./marketplaceStagingActions');

function assertStagingShopId(shopId) {
  if (shopId === STAGING_SHOP_ID) {
    return { ok: true };
  }
  return {
    ok: false,
    message: `This script only runs for shop ${STAGING_SHOP_ID}. Nothing was read or written.`
  };
}

function verifiedNameFromBank(bank) {
  const name = bank && bank.upiNameVerification && typeof bank.upiNameVerification.verifiedName === 'string'
    ? bank.upiNameVerification.verifiedName.trim()
    : '';
  return name;
}

function planShopApproval({ approvalStatus, bank }) {
  const verifiedName = verifiedNameFromBank(bank);
  if (!verifiedName) {
    return {
      ok: false,
      message: 'Shop bank.upiNameVerification.verifiedName is required before approval.'
    };
  }

  if (approvalStatus === 'approved') {
    return { ok: true, noop: true };
  }

  return {
    ok: true,
    noop: false,
    verifiedName
  };
}

module.exports = {
  assertStagingShopId,
  verifiedNameFromBank,
  planShopApproval,
  STAGING_SHOP_ID
};
