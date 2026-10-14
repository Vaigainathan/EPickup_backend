const {
  parseBackfillArgv,
  DEFAULT_LIMIT
} = require('../scripts/support/lib/backfillCatalogueThumbnailsArgs');

describe('backfill-catalogue-thumbnails argv', () => {
  it('defaults to dry-run with limit 20 and both entity types', () => {
    const opts = parseBackfillArgv([]);
    expect(opts).toEqual({
      apply: false,
      shopId: null,
      limit: DEFAULT_LIMIT,
      includeProducts: true,
      includeStorefronts: true
    });
  });

  it('parses --apply, --shop, --limit, and scope flags', () => {
    const opts = parseBackfillArgv([
      '--apply',
      '--shop',
      'shop-1',
      '--limit',
      '5',
      '--products-only'
    ]);
    expect(opts.apply).toBe(true);
    expect(opts.shopId).toBe('shop-1');
    expect(opts.limit).toBe(5);
    expect(opts.includeProducts).toBe(true);
    expect(opts.includeStorefronts).toBe(false);
  });

  it('rejects conflicting scope flags', () => {
    expect(() => parseBackfillArgv(['--products-only', '--storefronts-only'])).toThrow(
      /only one/
    );
  });
});
