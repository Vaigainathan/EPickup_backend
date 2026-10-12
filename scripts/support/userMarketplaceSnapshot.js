const fs = require('fs');
const path = require('path');

const SNAPSHOT_DIR = path.join(__dirname, '..', '..', 'tmp', 'marketplace-profile-snapshots');

function snapshotPath(customerId) {
  return path.join(SNAPSHOT_DIR, `${customerId}.json`);
}

function ensureDir() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
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

module.exports = {
  SNAPSHOT_DIR,
  saveMarketplaceSnapshot,
  loadMarketplaceSnapshot
};
