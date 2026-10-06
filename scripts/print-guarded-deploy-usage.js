const USAGE_MESSAGE = 'Use node scripts/deploy-firebase-config.js --project <id> --apply';

function printGuardedDeployUsage() {
  console.error(USAGE_MESSAGE);
}

if (require.main === module) {
  printGuardedDeployUsage();
  process.exit(1);
}

module.exports = {
  USAGE_MESSAGE,
  printGuardedDeployUsage
};
