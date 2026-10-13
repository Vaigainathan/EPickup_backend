const { execFileSync } = require('child_process');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const sanitizeProbeScript = path.join(__dirname, 'helpers/sanitizeQueryProbe.js');
const marketplaceProbeScript = path.join(__dirname, 'helpers/marketplaceShopsCategoryProbe.js');

function runSanitizeQueryProbe(mountPath, category) {
  const stdout = execFileSync(process.execPath, [sanitizeProbeScript, mountPath, category], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return JSON.parse(stdout);
}

function runMarketplaceShopsProbe(category, lat = '12.9', lng = '77.6') {
  const stdout = execFileSync(process.execPath, [marketplaceProbeScript, category, lat, lng], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return JSON.parse(stdout);
}

describe('GET /api/customer/marketplace/shops category query (real sanitize-html via Node probe)', () => {
  test('accepts URL-encoded Gifts, Flowers & Accessories', () => {
    const { status, body } = runMarketplaceShopsProbe('Gifts, Flowers & Accessories');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ shops: [], nextCursor: null });
  });

  test('accepts Food & Restaurants with ampersand in category', () => {
    const { status, body } = runMarketplaceShopsProbe('Food & Restaurants');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test('rejects partial category name Gifts, Flowers', () => {
    const { status, body } = runMarketplaceShopsProbe('Gifts, Flowers');
    expect(status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: {
        code: 'INVALID_CATEGORY',
        message: 'category is not a marketplace shop type'
      }
    });
  });
});

describe('sanitizeInput category query exemption scope (real sanitize-html via Node probe)', () => {
  test('non-marketplace routes still encode ampersand in category query param', () => {
    const body = runSanitizeQueryProbe('/api/support/faq', 'Food & Restaurants');
    expect(body.category).toBe('Food &amp; Restaurants');
  });
});
