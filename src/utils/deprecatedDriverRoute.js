function resolveRequestAppVersion(req) {
  return (
    req.headers?.['x-app-version'] ||
    req.body?.appVersion ||
    req.query?.appVersion ||
    null
  );
}

function logDeprecatedDriverRouteHit(route, req) {
  const payload = {
    route,
    uid: req.user?.uid ?? null,
    appVersion: resolveRequestAppVersion(req),
    timestamp: new Date().toISOString()
  };
  console.warn('[DEPRECATED_DRIVER_ROUTE_HIT]', JSON.stringify(payload));
  return payload;
}

function respondDeprecatedDriverRoute(res, { message, details, replacement }) {
  return res.status(410).json({
    success: false,
    error: {
      code: 'DEPRECATED_FEATURE',
      message,
      details,
      replacement
    },
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  logDeprecatedDriverRouteHit,
  respondDeprecatedDriverRoute,
  resolveRequestAppVersion
};
