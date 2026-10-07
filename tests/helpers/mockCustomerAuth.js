function authMiddleware(req, res, next) {
  req.user = { uid: 'customer-test', userType: 'customer' };
  next();
}

function requireRole() {
  return function roleMiddleware(req, res, next) {
    next();
  };
}

module.exports = {
  authMiddleware,
  requireRole
};
