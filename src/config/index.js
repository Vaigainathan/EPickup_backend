/**
 * Configuration Index
 * Central export point for all configuration modules
 */

const environmentConfig = require('./environment');

module.exports = {
  env: environmentConfig,
  // Export individual configs for convenience
  firebase: environmentConfig.get('firebase'),
  firestoreSession: environmentConfig.get('firestoreSession'),
  jwt: environmentConfig.get('jwt'),
  payment: environmentConfig.get('payment'),
  googleMaps: environmentConfig.get('googleMaps'),
  notifications: environmentConfig.get('notifications'),
  server: environmentConfig.get('server'),
  cors: environmentConfig.get('cors'),
  urls: environmentConfig.get('urls'),
  fileUpload: environmentConfig.get('fileUpload'),
  rateLimit: environmentConfig.get('rateLimit'),
  logging: environmentConfig.get('logging'),
  security: environmentConfig.get('security'),
  monitoring: environmentConfig.get('monitoring'),
  development: environmentConfig.get('development')
};
