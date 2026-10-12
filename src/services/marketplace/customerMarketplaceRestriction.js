const { httpError } = require('./httpError');

/**
 * Blueprint §3.5 / §5.2: restriction blocks placing new marketplace orders only.
 * Customers remain able to pay, cancel, refund, and help on existing orders.
 */
function assertMarketplaceProfileNotRestricted(marketplaceProfile) {
  const profile = marketplaceProfile && typeof marketplaceProfile === 'object'
    ? marketplaceProfile
    : {};
  if (profile.restriction && profile.restriction.active === true) {
    throw httpError(403, 'ACCOUNT_RESTRICTED', 'This account cannot place marketplace orders');
  }
}

module.exports = {
  assertMarketplaceProfileNotRestricted
};
