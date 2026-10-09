/**
 * Read-only compare of deployed staging Firestore rules against firestore.rules.
 * Exits 0 only when the files match, or the only difference is the
 * marketplaceOrders block. Any other difference exits 1.
 *
 *   node scripts/support/diff-firestore-rules.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { assertStagingEnv } = require('../assertStagingFirebase');
const {
  textDiff,
  marketplaceRulesDiff,
  fetchDeployedFirestoreRules
} = require('../firestoreRulesSource');

assertStagingEnv();

const LOCAL_PATH = path.join(__dirname, '..', '..', 'firestore.rules');

async function main() {
  const local = fs.readFileSync(LOCAL_PATH, 'utf8');
  const deployed = await fetchDeployedFirestoreRules('epickup-app-staging');
  const verdict = marketplaceRulesDiff(deployed, local);
  if (!verdict.ok) {
    console.error(verdict.reason);
    console.log(textDiff(deployed, local));
    process.exit(1);
  }
  if (!verdict.blockChanged) {
    console.log('Deployed staging rules match firestore.rules.');
    return;
  }
  console.log('Only the marketplaceOrders block differs.');
  console.log(textDiff(deployed, local));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  marketplaceRulesDiff
};
