const { isStagingFirebaseProject } = require('../utils/firebaseProject');

/**
 * Allow route only when FIREBASE_PROJECT_ID (or initialized app) is epickup-app-staging.
 */
function requireStagingFirebaseProject(req, res, next) {
  if (!isStagingFirebaseProject()) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Not found'
      },
      timestamp: new Date().toISOString()
    });
  }
  return next();
}

module.exports = {
  requireStagingFirebaseProject
};
