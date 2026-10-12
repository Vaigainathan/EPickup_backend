/**
 * Guards and argv parsing for one-time migration scripts.
 * Staging: same rules as assertStagingFirebase.
 * Production: FIREBASE_PROJECT_ID epickup-app + --confirm-production + production service account.
 */

const {
  STAGING_PROJECT,
  assertStagingEnv,
  assertStagingAdmin,
  assertStagingFirebase
} = require('./assertStagingFirebase');

const PRODUCTION_PROJECT = 'epickup-app';
function clientEmailLooksStaging(email) {
  return typeof email === 'string' && email.includes('epickup-app-staging');
}

function clientEmailLooksProduction(email) {
  return typeof email === 'string'
    && /@epickup-app\.iam/.test(email)
    && !email.includes('epickup-app-staging');
}

function readAdminClientEmail(app) {
  if (process.env.FIREBASE_CLIENT_EMAIL) {
    return process.env.FIREBASE_CLIENT_EMAIL;
  }
  try {
    const cred = app.options && app.options.credential;
    if (cred && typeof cred.getCertificate === 'function') {
      const cert = cred.getCertificate();
      if (cert && cert.clientEmail) {
        return cert.clientEmail;
      }
    }
  } catch {
    // fall through
  }
  return '';
}

function assertProductionEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (projectId !== PRODUCTION_PROJECT) {
    throw new Error(
      `Refusing to run: FIREBASE_PROJECT_ID is ${projectId || '(empty)'}, expected ${PRODUCTION_PROJECT}`
    );
  }

  const email = process.env.FIREBASE_CLIENT_EMAIL || '';
  if (!email) {
    throw new Error('Refusing to run: FIREBASE_CLIENT_EMAIL is missing; production Admin env init is required');
  }
  if (clientEmailLooksStaging(email)) {
    throw new Error('Refusing to run: FIREBASE_CLIENT_EMAIL is staging, not production epickup-app');
  }
  if (!clientEmailLooksProduction(email)) {
    throw new Error('Refusing to run: FIREBASE_CLIENT_EMAIL is not a production epickup-app service account');
  }

  const privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
    throw new Error('Refusing to run: FIREBASE_PRIVATE_KEY is missing or incomplete');
  }

}

function assertProductionAdmin() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    throw new Error('Refusing to run: Firebase Admin is not initialized');
  }

  const app = admin.app();
  const projectId = (app.options && app.options.projectId) || process.env.FIREBASE_PROJECT_ID;
  if (projectId !== PRODUCTION_PROJECT) {
    throw new Error(
      `Refusing to run: Admin projectId is ${projectId || '(empty)'}, expected ${PRODUCTION_PROJECT}`
    );
  }

  const clientEmail = readAdminClientEmail(app);
  if (clientEmailLooksStaging(clientEmail)) {
    throw new Error('Refusing to run: Admin credential is staging');
  }
  if (clientEmail && !clientEmailLooksProduction(clientEmail)) {
    throw new Error('Refusing to run: Admin client_email is not production epickup-app');
  }
}

function migrationTargetFromEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (projectId === STAGING_PROJECT) {
    return 'staging';
  }
  if (projectId === PRODUCTION_PROJECT) {
    return 'production';
  }
  return null;
}

/**
 * @param {{ confirmProduction?: boolean }} options
 */
function assertMigrationEnv(options = {}) {
  const target = migrationTargetFromEnv();
  if (target === 'staging') {
    assertStagingEnv();
    return { target: 'staging' };
  }
  if (target === 'production') {
    if (!options.confirmProduction) {
      throw new Error('Refusing to run on production without --confirm-production');
    }
    assertProductionEnv();
    return { target: 'production' };
  }
  throw new Error(
    `Refusing to run: FIREBASE_PROJECT_ID must be ${STAGING_PROJECT} or ${PRODUCTION_PROJECT}`
  );
}

function assertMigrationAdmin(options = {}) {
  const target = migrationTargetFromEnv();
  if (target === 'staging') {
    assertStagingAdmin();
    return;
  }
  if (target === 'production') {
    if (!options.confirmProduction) {
      throw new Error('Refusing to run on production without --confirm-production');
    }
    assertProductionAdmin();
    return;
  }
  throw new Error('Refusing to run: unknown migration target');
}

function parseMigrationArgv(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let apply = false;
  let confirmProduction = false;
  let stripLegacy = false;
  let limit = null;
  let startAfter = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--confirm-production') {
      confirmProduction = true;
    } else if (arg === '--strip-legacy') {
      stripLegacy = true;
    } else if (arg === '--limit') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        return { error: 'Missing --limit <n>' };
      }
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) {
        return { error: '--limit must be a positive integer' };
      }
      limit = n;
      i += 1;
    } else if (arg === '--start-after') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        return { error: 'Missing --start-after <docId>' };
      }
      startAfter = value;
      i += 1;
    } else {
      return { error: `Unknown argument ${arg}` };
    }
  }

  return {
    apply,
    confirmProduction,
    stripLegacy,
    limit,
    startAfter
  };
}

module.exports = {
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  assertMigrationEnv,
  assertMigrationAdmin,
  assertStagingFirebase,
  parseMigrationArgv,
  migrationTargetFromEnv
};
