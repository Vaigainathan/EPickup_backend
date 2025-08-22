// Only initialize Sentry if DSN is provided and we're in production
let Sentry = null;

if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
  try {
    Sentry = require("@sentry/node");
    
    // Initialize Sentry with your DSN
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      
      // Environment configuration
      environment: process.env.NODE_ENV || 'development',
      
      // Release version (you can set this via environment variable)
      release: process.env.APP_VERSION || '1.0.0',
      
      // Performance monitoring
      tracesSampleRate: 0.1,
      
      // Profiling
      profilesSampleRate: 0.1,
      
      // Setting this option to true will send default PII data to Sentry
      // For example, automatic IP address collection on events
      sendDefaultPii: true,
      
      // Enable debug mode in development
      debug: false,
      
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
    
    console.log('✅ Sentry initialized in instrument.js');
  } catch (error) {
    console.log('⚠️  Sentry initialization failed in instrument.js:', error.message);
  }
}

// Export Sentry for use in other files
module.exports = Sentry; 