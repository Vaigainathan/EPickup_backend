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

const { planShopApproval, verifiedNameFromBank } = require('../../src/services/admin/shopApprovalPlan');

module.exports = {
  assertStagingShopId,
  verifiedNameFromBank,
  planShopApproval,
  STAGING_SHOP_ID
};
