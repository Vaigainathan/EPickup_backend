function isDebugLoggingEnabled() {
  if (process.env.LOG_LEVEL === 'debug') {
    return true;
  }
  return (process.env.NODE_ENV || 'development') === 'development';
}

function debugLog(...args) {
  if (isDebugLoggingEnabled()) {
    console.log(...args);
  }
}

module.exports = {
  isDebugLoggingEnabled,
  debugLog
};
