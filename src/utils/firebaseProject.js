const admin = require('firebase-admin');

/** Same project id guard as scripts/assertStagingFirebase.js */
const STAGING_FIREBASE_PROJECT_ID = 'epickup-app-staging';

function resolveFirebaseProjectId() {
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  try {
    if (admin.apps.length > 0) {
      return admin.app().options.projectId || null;
    }
  } catch {
    // ignore
  }
  return null;
}

function isStagingFirebaseProject() {
  return resolveFirebaseProjectId() === STAGING_FIREBASE_PROJECT_ID;
}

module.exports = {
  STAGING_FIREBASE_PROJECT_ID,
  resolveFirebaseProjectId,
  isStagingFirebaseProject
};
