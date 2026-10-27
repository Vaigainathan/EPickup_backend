const authState = { uid: 'shop-test' };

function authMiddleware(req, res, next) {
  req.user = { uid: authState.uid, userType: 'shop' };
  next();
}

function setTestShopUid(uid) {
  authState.uid = uid;
}

function resetTestShopUid() {
  authState.uid = 'shop-test';
}

function requireRole() {
  return function roleMiddleware(req, res, next) {
    next();
  };
}

module.exports = {
  authMiddleware,
  requireRole,
  setTestShopUid,
  resetTestShopUid
};
