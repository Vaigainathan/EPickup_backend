const fs = require('fs');
const path = require('path');

/**
 * Deployment Configuration Checker
 * Validates all required environment variables and configurations for production deployment
 */
class DeploymentChecker {
  constructor() {
    this.requiredEnvVars = [
      'JWT_SECRET',
      'FIREBASE_PROJECT_ID',
      'FIREBASE_PRIVATE_KEY',
      'FIREBASE_CLIENT_EMAIL',
      'GOOGLE_MAPS_API_KEY',
      'MSG91_API_KEY',
      'NODE_ENV'
    ];

    this.optionalEnvVars = [
      'PORT',
      'CORS_ORIGIN',
      'RATE_LIMIT_WINDOW_MS',
      'RATE_LIMIT_MAX_REQUESTS',
      'WEBSOCKET_CORS_ORIGIN'
    ];

    this.errors = [];
    this.warnings = [];
  }

  /**
   * Run comprehensive deployment check
   * @returns {Object} Check results
   */
  async runDeploymentCheck() {
    console.log('🔍 Running deployment configuration check...');

    // Check environment variables
    this.checkEnvironmentVariables();

    // Check Firebase configuration
    await this.checkFirebaseConfiguration();

    // Check Google Maps configuration
    this.checkGoogleMapsConfiguration();

    // Check MSG91 configuration
    this.checkMSG91Configuration();

    // Check file permissions
    this.checkFilePermissions();

    // Check port availability
    this.checkPortAvailability();

    // Check database connectivity
    await this.checkDatabaseConnectivity();

    // Check external service connectivity
    await this.checkExternalServices();

    const result = {
      success: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    };

    if (result.success) {
      console.log('✅ Deployment check passed successfully');
    } else {
      console.log('❌ Deployment check failed with errors');
    }

    return result;
  }

  /**
   * Check required environment variables
   */
  checkEnvironmentVariables() {
    console.log('📋 Checking environment variables...');

    // Check required variables
    for (const envVar of this.requiredEnvVars) {
      if (!process.env[envVar]) {
        this.errors.push(`Missing required environment variable: ${envVar}`);
      }
    }

    // Check optional variables
    for (const envVar of this.optionalEnvVars) {
      if (!process.env[envVar]) {
        this.warnings.push(`Optional environment variable not set: ${envVar}`);
      }
    }

    // Validate specific environment variables
    this.validateJWTSecret();
    this.validateNodeEnv();
    this.validatePort();
  }

  /**
   * Validate JWT secret
   */
  validateJWTSecret() {
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
      if (jwtSecret.length < 32) {
        this.errors.push('JWT_SECRET must be at least 32 characters long');
      }
      if (jwtSecret === 'your-secret-key' || jwtSecret === 'secret') {
        this.errors.push('JWT_SECRET must not be a default/weak value');
      }
    }
  }

  /**
   * Validate NODE_ENV
   */
  validateNodeEnv() {
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv && !['development', 'staging', 'production'].includes(nodeEnv)) {
      this.warnings.push(`NODE_ENV should be one of: development, staging, production. Current: ${nodeEnv}`);
    }
  }

  /**
   * Validate port
   */
  validatePort() {
    const port = process.env.PORT;
    if (port) {
      const portNum = parseInt(port);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        this.errors.push('PORT must be a valid port number (1-65535)');
      }
    }
  }

  /**
   * Check Firebase configuration
   */
  async checkFirebaseConfiguration() {
    console.log('🔥 Checking Firebase configuration...');

    try {
      const { getFirestore } = require('../services/firebase');
      const db = getFirestore();

      // Test basic connectivity
      await db.collection('health').doc('test').get();

      console.log('✅ Firebase connection successful');
    } catch (error) {
      this.errors.push(`Firebase configuration error: ${error.message}`);
    }
  }

  /**
   * Check Google Maps configuration
   */
  checkGoogleMapsConfiguration() {
    console.log('🗺️ Checking Google Maps configuration...');

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      this.errors.push('GOOGLE_MAPS_API_KEY is required for location services');
      return;
    }

    // Basic API key format validation
    if (!apiKey.startsWith('AIza')) {
      this.warnings.push('GOOGLE_MAPS_API_KEY format appears invalid');
    }
  }

  /**
   * Check MSG91 configuration
   */
  checkMSG91Configuration() {
    console.log('📱 Checking MSG91 configuration...');

    const apiKey = process.env.MSG91_API_KEY;
    if (!apiKey) {
      this.errors.push('MSG91_API_KEY is required for OTP services');
      return;
    }

    // Basic API key format validation
    if (apiKey.length < 20) {
      this.warnings.push('MSG91_API_KEY format appears invalid');
    }
  }

  /**
   * Check file permissions
   */
  checkFilePermissions() {
    console.log('📁 Checking file permissions...');

    const criticalFiles = [
      'package.json',
      'src/app.js',
      'src/services/firebase.js',
      'firestore.rules',
      'firestore.indexes.json'
    ];

    for (const file of criticalFiles) {
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        try {
          fs.accessSync(filePath, fs.constants.R_OK);
        } catch {
          this.errors.push(`Cannot read file: ${file}`);
        }
      } else {
        this.errors.push(`Missing critical file: ${file}`);
      }
    }
  }

  /**
   * Check port availability
   */
  checkPortAvailability() {
    console.log('🔌 Checking port availability...');

    const port = process.env.PORT || 3000;
    const net = require('net');

    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, () => {
        server.once('close', () => {
          console.log(`✅ Port ${port} is available`);
          resolve();
        });
        server.close();
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          this.errors.push(`Port ${port} is already in use`);
        } else {
          this.warnings.push(`Port ${port} check failed: ${err.message}`);
        }
        resolve();
      });
    });
  }

  /**
   * Check database connectivity
   */
  async checkDatabaseConnectivity() {
    console.log('🗄️ Checking database connectivity...');

    try {
      const { getFirestore } = require('../services/firebase');
      const db = getFirestore();

      // Test read operation
      await db.collection('health').doc('test').get();

      // Test write operation
      await db.collection('health').doc('test').set({
        timestamp: new Date(),
        test: true
      });

      // Test delete operation
      await db.collection('health').doc('test').delete();

      console.log('✅ Database connectivity successful');
    } catch (error) {
      this.errors.push(`Database connectivity error: ${error.message}`);
    }
  }

  /**
   * Check external services
   */
  async checkExternalServices() {
    console.log('🌐 Checking external services...');

    // Check Google Maps API
    await this.checkGoogleMapsAPI();

    // Check MSG91 API
    await this.checkMSG91API();
  }

  /**
   * Check Google Maps API
   */
  async checkGoogleMapsAPI() {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;

    try {
      const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${apiKey}`);
      const data = await response.json();

      if (data.status === 'OK') {
        console.log('✅ Google Maps API accessible');
      } else {
        this.warnings.push(`Google Maps API error: ${data.status}`);
      }
    } catch (error) {
      this.warnings.push(`Google Maps API check failed: ${error.message}`);
    }
  }

  /**
   * Check MSG91 API
   */
  async checkMSG91API() {
    const apiKey = process.env.MSG91_API_KEY;
    if (!apiKey) return;

    try {
      const response = await fetch(`https://api.msg91.com/api/v5/otp?template_id=test&mobile=9999999999&authkey=${apiKey}`);
      
      if (response.ok) {
        console.log('✅ MSG91 API accessible');
      } else {
        this.warnings.push(`MSG91 API error: ${response.status}`);
      }
    } catch (error) {
      this.warnings.push(`MSG91 API check failed: ${error.message}`);
    }
  }

  /**
   * Generate deployment report
   * @returns {string} Deployment report
   */
  generateDeploymentReport() {
    const report = [];
    
    report.push('# Deployment Configuration Report');
    report.push(`Generated: ${new Date().toISOString()}`);
    report.push(`Environment: ${process.env.NODE_ENV || 'development'}`);
    report.push('');

    if (this.errors.length > 0) {
      report.push('## ❌ Errors (Must Fix)');
      this.errors.forEach(error => report.push(`- ${error}`));
      report.push('');
    }

    if (this.warnings.length > 0) {
      report.push('## ⚠️ Warnings (Recommended to Fix)');
      this.warnings.forEach(warning => report.push(`- ${warning}`));
      report.push('');
    }

    if (this.errors.length === 0 && this.warnings.length === 0) {
      report.push('## ✅ All Checks Passed');
      report.push('Your deployment configuration is ready for production!');
    }

    return report.join('\n');
  }
}

module.exports = new DeploymentChecker();
