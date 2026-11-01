/**
 * Read-only push token / notification diagnostics (staging only).
 *
 *   node scripts/support/diagnose-push.js
 *
 * No Firestore writes.
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { runDiagnosePush } = require('./lib/diagnosePushActions');

assertStagingEnv();

async function main() {
  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const report = await runDiagnosePush(db);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    diagnosePush: true,
    error: true,
    message: error.message
  }, null, 2));
  process.exit(1);
});
