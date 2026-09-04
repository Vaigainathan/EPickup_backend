/**
 * Hard guard for marketplace seed/test scripts.
 * Refuses to run against any Firebase project other than epickup-app-staging,
 * including production (epickup-app), even by accident.
 *
 * Call assertStagingEnv() immediately after dotenv.
 * Call assertStagingAdmin() after Firebase Admin has initialized.
 * Do not overwrite FIREBASE_PROJECT_ID — if .env is wrong, refuse.
 */

const STAGING_PROJECT = 'epickup-app-staging';
const PRODUCTION_RAILWAY = 'epickupbackend-production';

function clientEmailLooksStaging(email) {
  return typeof email === 'string' && email.includes('epickup-app-staging');
}

function clientEmailLooksProduction(email) {
  return typeof email === 'string'
    && /@epickup-app\.iam/.test(email)
    && !email.includes('epickup-app-staging');
}

function backendUrls() {
  return [
    process.env.STAGING_BACKEND_URL,
    process.env.BACKEND_URL,
    process.env.BASE_URL
  ].filter(Boolean);
}

function assertStagingEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (projectId !== STAGING_PROJECT) {
    throw new Error(
      `Refusing to run: FIREBASE_PROJECT_ID is ${projectId || '(empty)'}, expected ${STAGING_PROJECT}`
    );
  }

  const email = process.env.FIREBASE_CLIENT_EMAIL || '';
  if (!email) {
    throw new Error('Refusing to run: FIREBASE_CLIENT_EMAIL is missing; staging Admin env init is required');
  }
  if (clientEmailLooksProduction(email)) {
    throw new Error('Refusing to run: FIREBASE_CLIENT_EMAIL is production (epickup-app), not epickup-app-staging');
  }
  if (!clientEmailLooksStaging(email)) {
    throw new Error('Refusing to run: FIREBASE_CLIENT_EMAIL is not the epickup-app-staging service account');
  }

  const privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
    throw new Error('Refusing to run: FIREBASE_PRIVATE_KEY is missing or incomplete');
  }

  for (const url of backendUrls()) {
    if (String(url).includes(PRODUCTION_RAILWAY)) {
      throw new Error('Refusing to run: backend URL points at production Railway');
    }
  }
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

function assertStagingAdmin() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    throw new Error('Refusing to run: Firebase Admin is not initialized');
  }

  const app = admin.app();
  const projectId = (app.options && app.options.projectId) || process.env.FIREBASE_PROJECT_ID;
  if (projectId !== STAGING_PROJECT) {
    throw new Error(
      `Refusing to run: Admin projectId is ${projectId || '(empty)'}, expected ${STAGING_PROJECT}`
    );
  }

  const clientEmail = readAdminClientEmail(app);
  if (clientEmailLooksProduction(clientEmail)) {
    throw new Error('Refusing to run: Admin credential is production epickup-app');
  }
  if (clientEmail && !clientEmailLooksStaging(clientEmail)) {
    throw new Error('Refusing to run: Admin client_email is not epickup-app-staging');
  }
}

function assertStagingFirebase() {
  assertStagingEnv();
  const admin = require('firebase-admin');
  if (admin.apps.length) {
    assertStagingAdmin();
  }
}

module.exports = {
  STAGING_PROJECT,
  assertStagingEnv,
  assertStagingAdmin,
  assertStagingFirebase
};
