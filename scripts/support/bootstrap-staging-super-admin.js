/**
 * Create the first staging super_admin (Firebase Auth + adminUsers + users + claims).
 * Dry run by default. Human must pass --apply.
 *
 *   node scripts/support/bootstrap-staging-super-admin.js --email you@example.com --displayName "Admin" --password 'TempPass123!'
 *   node scripts/support/bootstrap-staging-super-admin.js ... --apply
 *   node scripts/support/bootstrap-staging-super-admin.js ... --apply --force
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) {
    return '';
  }
  return next;
}

async function countSuperAdmins(db) {
  const snap = await db.collection('adminUsers').where('role', '==', 'super_admin').limit(5).get();
  return snap.size;
}

async function main() {
  const email = argValue('--email');
  const displayName = argValue('--displayName');
  const password = argValue('--password');
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  if (!email || !displayName || !password) {
    console.error('Usage: bootstrap-staging-super-admin.js --email <e> --displayName <name> --password <pw> [--apply] [--force]');
    process.exit(1);
  }

  assertStagingEnv();
  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const { getAuth } = require('firebase-admin/auth');
  const { createAdminStaff } = require('../../src/services/adminStaffService');

  const superAdminCount = await countSuperAdmins(db);
  const preview = {
    dryRun: !apply,
    projectId: process.env.FIREBASE_PROJECT_ID,
    email,
    displayName,
    existingSuperAdmins: superAdminCount,
    force: force === true
  };

  let authExists = false;
  try {
    await getAuth().getUserByEmail(email);
    authExists = true;
  } catch (err) {
    if (err.code !== 'auth/user-not-found') {
      throw err;
    }
  }
  preview.authUserExists = authExists;

  if (superAdminCount > 0 && !force) {
    preview.blocked = true;
    preview.reason = 'A super_admin already exists. Use --force to add another.';
    console.log(JSON.stringify(preview, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(preview, null, 2));

  if (!apply) {
    console.log('Dry run. Re-run with --apply to create the super_admin. Nothing was written.');
    return;
  }

  const result = await createAdminStaff({
    email,
    displayName,
    role: 'super_admin',
    temporaryPassword: password,
    createdBy: 'bootstrap-staging-super-admin'
  });

  console.log(JSON.stringify({
    applied: true,
    uid: result.uid,
    created: result.created,
    alreadyExists: result.created === false
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
