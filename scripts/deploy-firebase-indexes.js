/**
 * Preview or deploy Firestore indexes.
 *
 * Deletions are impossible from this script. --apply runs
 * firebase deploy --only firestore:indexes --project <id> --non-interactive
 * and never passes --force. Indexes and field overrides that exist in the
 * project but are missing from the file are left in place.
 *
 * Usage:
 *   node scripts/deploy-firebase-indexes.js --project epickup-app-staging
 *   node scripts/deploy-firebase-indexes.js --project epickup-app-staging --apply
 *   node scripts/deploy-firebase-indexes.js --project epickup-app --confirm-production --apply
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STAGING_PROJECT = 'epickup-app-staging';
const PRODUCTION_PROJECT = 'epickup-app';

function parseDeployArgs(argv, options = {}) {
  const allowApply = options.allowApply === true;
  const args = Array.isArray(argv) ? argv : [];
  let project = null;
  let apply = false;
  let confirmProduction = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--project') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        return { error: 'Missing --project <id>' };
      }
      project = value;
      i += 1;
    } else if (arg === '--apply') {
      if (!allowApply) {
        return { error: 'Unknown argument --apply' };
      }
      apply = true;
    } else if (arg === '--confirm-production') {
      confirmProduction = true;
    } else {
      return { error: `Unknown argument ${arg}` };
    }
  }

  if (!project) {
    return { error: 'Missing --project <id>' };
  }
  if (project === STAGING_PROJECT) {
    return { project, apply, confirmProduction };
  }
  if (project === PRODUCTION_PROJECT) {
    if (!confirmProduction) {
      return { error: 'Refusing project epickup-app without --confirm-production' };
    }
    return { project, apply, confirmProduction };
  }
  return { error: `Refusing project ${project}` };
}

function indexKey(spec) {
  const fields = (spec.fields || [])
    .filter((field) => field.fieldPath !== '__name__')
    .map((field) => `${field.fieldPath} ${field.order || field.arrayConfig || ''}`)
    .join(' | ');
  return `${spec.collectionGroup} :: ${spec.queryScope || ''} :: ${fields}`;
}

function overrideKey(spec) {
  const modes = (spec.indexes || []).map((index) => {
    const mode = index.order || index.arrayConfig || '';
    return `${mode} ${index.queryScope || ''}`;
  }).sort();
  return `${spec.collectionGroup} :: ${spec.fieldPath} :: ttl=${spec.ttl} :: ${modes.join(',')}`;
}

function diffDefinitions(fileItems, remoteItems, keyFn) {
  const fileKeys = new Set((fileItems || []).map(keyFn));
  const remoteKeys = new Set((remoteItems || []).map(keyFn));
  const toAdd = [...fileKeys].filter((key) => !remoteKeys.has(key)).sort();
  const present = [...fileKeys].filter((key) => remoteKeys.has(key)).sort();
  const remoteOnly = [...remoteKeys].filter((key) => !fileKeys.has(key)).sort();
  return { toAdd, present, remoteOnly };
}

function compareFirestoreSpecs(fileSpec, remoteSpec) {
  const file = fileSpec || {};
  const remote = remoteSpec || {};
  return {
    indexes: diffDefinitions(file.indexes, remote.indexes, indexKey),
    fieldOverrides: diffDefinitions(file.fieldOverrides, remote.fieldOverrides, overrideKey)
  };
}

function formatComparison(comparison) {
  const lines = [];
  const section = (title, items) => {
    lines.push(title);
    if (!items.length) {
      lines.push('  (none)');
      return;
    }
    items.forEach((item) => lines.push(`  ${item}`));
  };
  section('Indexes to be added:', comparison.indexes.toAdd);
  section('Indexes already present:', comparison.indexes.present);
  section(
    'Indexes present remotely but missing from the file (these will NOT be deleted):',
    comparison.indexes.remoteOnly
  );
  section('Field overrides to be added:', comparison.fieldOverrides.toAdd);
  section('Field overrides already present:', comparison.fieldOverrides.present);
  section(
    'Field overrides present remotely but missing from the file (these will NOT be deleted):',
    comparison.fieldOverrides.remoteOnly
  );
  return lines.join('\n');
}

function parseIndexesStdout(stdout) {
  const text = String(stdout || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) {
    throw new Error('firebase firestore:indexes did not return JSON');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function planIndexDeploy(argv) {
  const parsed = parseDeployArgs(argv, { allowApply: true });
  if (parsed.error) {
    return parsed;
  }
  const project = parsed.project;
  return {
    project,
    apply: parsed.apply,
    indexFile: path.join(__dirname, '..', 'firestore.indexes.json'),
    listCommand: `firebase firestore:indexes --project ${project}`,
    deployCommand: `firebase deploy --only firestore:indexes --project ${project} --non-interactive`
  };
}

function main(argv = process.argv.slice(2)) {
  const plan = planIndexDeploy(argv);
  if (plan.error) {
    console.error(plan.error);
    process.exit(1);
  }
  if (plan.deployCommand.includes('--force') || plan.listCommand.includes('--force')) {
    console.error('Refusing to pass --force');
    process.exit(1);
  }
  if (!plan.apply) {
    const remoteText = execSync(plan.listCommand, { encoding: 'utf8' });
    const remote = parseIndexesStdout(remoteText);
    const fileSpec = JSON.parse(fs.readFileSync(plan.indexFile, 'utf8'));
    console.log(formatComparison(compareFirestoreSpecs(fileSpec, remote)));
    return;
  }
  execSync(plan.deployCommand, { stdio: 'inherit' });
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
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  parseDeployArgs,
  compareFirestoreSpecs,
  formatComparison,
  parseIndexesStdout,
  planIndexDeploy
};
