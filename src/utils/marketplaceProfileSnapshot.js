const fs = require('fs');
const path = require('path');

const DEFAULT_SNAPSHOT_DIR = path.join(__dirname, '..', '..', 'tmp', 'marketplace-profile-snapshots');

function getSnapshotDir() {
  const override = process.env.MARKETPLACE_SNAPSHOT_DIR;
  if (typeof override === 'string' && override.trim()) {
    return path.resolve(override.trim());
  }
  return DEFAULT_SNAPSHOT_DIR;
}

function snapshotPath(customerId) {
  return path.join(getSnapshotDir(), `${customerId}.json`);
}

function ensureDir() {
  const dir = getSnapshotDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function saveMarketplaceSnapshot(customerId, marketplace) {
  ensureDir();
  const file = snapshotPath(customerId);
  const payload = {
    customerId,
    savedAt: new Date().toISOString(),
    marketplace: marketplace && typeof marketplace === 'object' ? marketplace : {}
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
}

function loadMarketplaceSnapshot(customerId) {
  const file = snapshotPath(customerId);
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function deleteMarketplaceSnapshot(customerId) {
  const file = snapshotPath(customerId);
  if (!fs.existsSync(file)) {
    return false;
  }
  fs.unlinkSync(file);
  return true;
}

function prepareRestrictSnapshot(customerId, marketplace, { force = false } = {}) {
  const existing = loadMarketplaceSnapshot(customerId);
  if (existing && !force) {
    return { ok: false, code: 'SNAPSHOT_EXISTS' };
  }
  const file = saveMarketplaceSnapshot(customerId, marketplace);
  return {
    ok: true,
    file,
    overwritten: Boolean(existing && force)
  };
}

module.exports = {
  DEFAULT_SNAPSHOT_DIR,
  getSnapshotDir,
  saveMarketplaceSnapshot,
  loadMarketplaceSnapshot,
  deleteMarketplaceSnapshot,
  prepareRestrictSnapshot
};
