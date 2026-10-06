/**
 * Preview or deploy Firestore rules, Storage rules, and Firestore indexes.
 *
 * Deletions are impossible from this script. --apply runs the three firebase
 * deploy commands with --project and --non-interactive, and never passes --force.
 *
 * Usage:
 *   node scripts/deploy-firebase-config.js --project epickup-app-staging
 *   node scripts/deploy-firebase-config.js --project epickup-app-staging --apply
 *   node scripts/deploy-firebase-config.js --project epickup-app --confirm-production --apply
 */

const { execSync } = require('child_process');
const { parseDeployArgs } = require('./deploy-firebase-indexes');

const CONFIG_TARGETS = ['firestore:rules', 'storage', 'firestore:indexes'];

function configCommands(project) {
  return CONFIG_TARGETS.map((only) =>
    `firebase deploy --only ${only} --project ${project} --non-interactive`
  );
}

function planConfigDeploy(argv) {
  const parsed = parseDeployArgs(argv, { allowApply: true });
  if (parsed.error) {
    return parsed;
  }
  return {
    project: parsed.project,
    apply: parsed.apply,
    commands: configCommands(parsed.project)
  };
}

function main(argv = process.argv.slice(2)) {
  const plan = planConfigDeploy(argv);
  if (plan.error) {
    console.error(plan.error);
    process.exit(1);
  }
  if (plan.commands.some((command) => command.includes('--force'))) {
    console.error('Refusing to pass --force');
    process.exit(1);
  }
  if (!plan.apply) {
    plan.commands.forEach((command) => console.log(command));
    return;
  }
  plan.commands.forEach((command) => {
    execSync(command, { stdio: 'inherit' });
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  CONFIG_TARGETS,
  configCommands,
  planConfigDeploy
};
