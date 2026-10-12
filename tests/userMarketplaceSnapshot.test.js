const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getSnapshotDir,
  saveMarketplaceSnapshot,
  loadMarketplaceSnapshot,
  deleteMarketplaceSnapshot,
  prepareRestrictSnapshot,
  DEFAULT_SNAPSHOT_DIR
} = require('../scripts/support/userMarketplaceSnapshot');

describe('userMarketplaceSnapshot', () => {
  let tempDir;
  const originalEnv = process.env.MARKETPLACE_SNAPSHOT_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketplace-snap-test-'));
    process.env.MARKETPLACE_SNAPSHOT_DIR = tempDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MARKETPLACE_SNAPSHOT_DIR;
    } else {
      process.env.MARKETPLACE_SNAPSHOT_DIR = originalEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('defaults to tmp/marketplace-profile-snapshots when env unset', () => {
    delete process.env.MARKETPLACE_SNAPSHOT_DIR;
    expect(getSnapshotDir()).toBe(DEFAULT_SNAPSHOT_DIR);
  });

  test('prepareRestrictSnapshot refuses overwrite without force', () => {
    const customerId = 'cust-snap-1';
    saveMarketplaceSnapshot(customerId, { restriction: { active: false } });
    const outcome = prepareRestrictSnapshot(customerId, { stats: { orders: 1 } }, { force: false });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('SNAPSHOT_EXISTS');
    expect(loadMarketplaceSnapshot(customerId).marketplace).toEqual({ restriction: { active: false } });
  });

  test('prepareRestrictSnapshot overwrites with force', () => {
    const customerId = 'cust-snap-2';
    saveMarketplaceSnapshot(customerId, { old: true });
    const outcome = prepareRestrictSnapshot(customerId, { new: true }, { force: true });
    expect(outcome.ok).toBe(true);
    expect(outcome.overwritten).toBe(true);
    expect(loadMarketplaceSnapshot(customerId).marketplace).toEqual({ new: true });
  });

  test('deleteMarketplaceSnapshot removes the file', () => {
    const customerId = 'cust-snap-3';
    saveMarketplaceSnapshot(customerId, {});
    expect(fs.existsSync(path.join(tempDir, `${customerId}.json`))).toBe(true);
    expect(deleteMarketplaceSnapshot(customerId)).toBe(true);
    expect(loadMarketplaceSnapshot(customerId)).toBeNull();
    expect(deleteMarketplaceSnapshot(customerId)).toBe(false);
  });
});
