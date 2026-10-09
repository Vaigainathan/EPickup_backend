/**
 * Preview or deploy Firestore rules, Storage rules, and Firestore indexes.
 *
 * Deletions are impossible from this script. --apply runs the three firebase
 * deploy commands with --project and --non-interactive, and never passes --force.
 * Before that, it fetches the live Firestore rules and prints the diff against
 * firestore.rules. A non-empty diff refuses --apply unless --accept-diff is set.
 *
 * Usage:
 *   node scripts/deploy-firebase-config.js --project epickup-app-staging
 *   node scripts/deploy-firebase-config.js --project epickup-app-staging --apply
 *   node scripts/deploy-firebase-config.js --project epickup-app-staging --apply --accept-diff
 *   node scripts/deploy-firebase-config.js --project epickup-app --confirm-production --apply
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseDeployArgs } = require('./deploy-firebase-indexes');

const CONFIG_TARGETS = ['firestore:rules', 'storage', 'firestore:indexes'];
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');

function configCommands(project) {
  return CONFIG_TARGETS.map((only) =>
    `firebase deploy --only ${only} --project ${project} --non-interactive`
  );
}

function planConfigDeploy(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const acceptDiff = args.includes('--accept-diff');
  const parsed = parseDeployArgs(args.filter((arg) => arg !== '--accept-diff'), { allowApply: true });
  if (parsed.error) {
    return parsed;
  }
  return {
    project: parsed.project,
    apply: parsed.apply,
    acceptDiff,
    commands: configCommands(parsed.project)
  };
}

async function main(argv = process.argv.slice(2)) {
  const plan = planConfigDeploy(argv);
  if (plan.error) {
    console.error(plan.error);
    process.exit(1);
  }
  if (plan.commands.some((command) => command.includes('--force'))) {
    console.error('Refusing to pass --force');
    process.exit(1);
  }

  const { fetchDeployedFirestoreRules, textDiff } = require('./firestoreRulesSource');
  const deployed = await fetchDeployedFirestoreRules(plan.project);
  const local = fs.readFileSync(RULES_PATH, 'utf8');
  const diff = textDiff(deployed, local);
  if (diff) {
    console.log(diff);
  } else {
    console.log('Firestore rules: deployed matches local file.');
  }

  if (!plan.apply) {
    plan.commands.forEach((command) => console.log(command));
    if (diff) {
      console.log('Diff is non-empty. --apply will refuse unless --accept-diff is passed.');
    }
    return;
  }
  if (diff && !plan.acceptDiff) {
    console.error('Refusing --apply: deployed Firestore rules differ from firestore.rules. Re-run with --accept-diff to deploy anyway.');
    process.exit(1);
  }
  plan.commands.forEach((command) => {
    execSync(command, { stdio: 'inherit' });
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  CONFIG_TARGETS,
  configCommands,
  planConfigDeploy
};
