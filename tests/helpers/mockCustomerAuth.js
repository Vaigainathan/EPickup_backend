const authState = { uid: 'customer-test' };

function authMiddleware(req, res, next) {
  req.user = { uid: authState.uid, userType: 'customer' };
  next();
}

function setTestUid(uid) {
  authState.uid = uid;
}

function resetTestUid() {
  authState.uid = 'customer-test';
}

function requireRole() {
  return function roleMiddleware(req, res, next) {
    next();
  };
}

module.exports = {
  authMiddleware,
  authenticateToken: authMiddleware,
  requireRole,
  setTestUid,
  resetTestUid
};
