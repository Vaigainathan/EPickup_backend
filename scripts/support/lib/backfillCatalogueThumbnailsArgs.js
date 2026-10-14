const DEFAULT_LIMIT = 20;

function parseBackfillArgv(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const apply = args.includes('--apply');
  const productsOnly = args.includes('--products-only');
  const storefrontsOnly = args.includes('--storefronts-only');

  let shopId = null;
  const shopIndex = args.indexOf('--shop');
  if (shopIndex >= 0) {
    const value = args[shopIndex + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('--shop requires a shop id');
    }
    shopId = value.trim();
  }

  let limit = DEFAULT_LIMIT;
  const limitIndex = args.indexOf('--limit');
  if (limitIndex >= 0) {
    const raw = args[limitIndex + 1];
    if (!raw || raw.startsWith('--')) {
      throw new Error('--limit requires a number');
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error('--limit must be a positive number');
    }
    limit = Math.floor(n);
  }

  if (productsOnly && storefrontsOnly) {
    throw new Error('Use only one of --products-only or --storefronts-only');
  }

  const includeProducts = !storefrontsOnly;
  const includeStorefronts = !productsOnly;

  return {
    apply,
    shopId,
    limit,
    includeProducts,
    includeStorefronts
  };
}

module.exports = {
  DEFAULT_LIMIT,
  parseBackfillArgv
};
