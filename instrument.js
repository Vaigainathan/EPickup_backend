const Sentry = require("@sentry/node");

// Initialize Sentry with your DSN
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  
  // Environment configuration
  environment: process.env.NODE_ENV || 'development',
  
  // Release version (you can set this via environment variable)
  release: process.env.APP_VERSION || '1.0.0',
  
  // Performance monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Profiling
  profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Setting this option to true will send default PII data to Sentry
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
  
  // Enable debug mode in development
  debug: process.env.NODE_ENV === 'development',
  
  // Configure beforeSend to filter sensitive data
  beforeSend(event, hint) {
    // Filter out sensitive information
    if (event.request && event.request.headers) {
      // Remove sensitive headers
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
      delete event.request.headers['x-api-key'];
    }
    
    // Filter out sensitive user data
    if (event.user) {
      delete event.user.ip_address;
    }
    
    return event;
  },
  
  // Configure beforeSendTransaction for performance monitoring
  beforeSendTransaction(event) {
    // Filter out health check and static file requests
    if (event.transaction === '/health' || event.transaction.startsWith('/uploads/')) {
      return null;
    }
    return event;
  },
  
  // Configure sampling for different types of events
  initialScope: {
    tags: {
      service: 'epickup-backend',
      component: 'api-server'
    }
  }
});

// Export Sentry for use in other files
module.exports = Sentry; 