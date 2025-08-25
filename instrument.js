// Sentry initialization for backend monitoring
const Sentry = require('@sentry/node');

// Initialize Sentry if SENTRY_DSN is available
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 1.0,
  });
  console.log('✅ Sentry initialized');
} else {
  console.log('⚠️  Sentry DSN not found, skipping Sentry initialization');
}

module.exports = Sentry;
