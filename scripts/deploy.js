#!/usr/bin/env node

const deploymentChecker = require('../src/utils/deploymentChecker');
const fs = require('fs');
const path = require('path');

/**
 * Deployment Script
 * Runs comprehensive checks and prepares the application for production deployment
 */
async function deploy() {
  console.log('🚀 Starting deployment process...');
  console.log('=====================================');

  try {
    // Run deployment checks
    console.log('\n📋 Running deployment checks...');
    const checkResult = await deploymentChecker.runDeploymentCheck();

    if (!checkResult.success) {
      console.log('\n❌ Deployment checks failed!');
      console.log('\nErrors:');
      checkResult.errors.forEach(error => console.log(`  - ${error}`));
      
      if (checkResult.warnings.length > 0) {
        console.log('\nWarnings:');
        checkResult.warnings.forEach(warning => console.log(`  - ${warning}`));
      }

      console.log('\nPlease fix the errors before deploying.');
      process.exit(1);
    }

    console.log('\n✅ All deployment checks passed!');

    if (checkResult.warnings.length > 0) {
      console.log('\n⚠️ Warnings (recommended to fix):');
      checkResult.warnings.forEach(warning => console.log(`  - ${warning}`));
    }

    // Generate deployment report
    console.log('\n📊 Generating deployment report...');
    const report = deploymentChecker.generateDeploymentReport();
    
    const reportPath = path.join(__dirname, '..', 'deployment-report.md');
    fs.writeFileSync(reportPath, report);
    console.log(`📄 Deployment report saved to: ${reportPath}`);

    // Create production environment file
    console.log('\n🔧 Creating production environment file...');
    await createProductionEnvFile();

    // Validate package.json
    console.log('\n📦 Validating package.json...');
    await validatePackageJson();

    // Check for security vulnerabilities
    console.log('\n🔒 Checking for security vulnerabilities...');
    await checkSecurityVulnerabilities();

    console.log('\n🎉 Deployment preparation completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Review the deployment report');
    console.log('2. Set up your production environment variables');
    console.log('3. Deploy to your hosting platform');
    console.log('4. Monitor the health endpoints after deployment');

  } catch (error) {
    console.error('\n❌ Deployment preparation failed:', error.message);
    process.exit(1);
  }
}

/**
 * Create production environment file template
 */
async function createProductionEnvFile() {
  const envTemplate = `# Production Environment Variables
# Copy this file to .env.production and fill in your values

# Server Configuration
NODE_ENV=production
PORT=3000

# JWT Configuration
JWT_SECRET=your-super-secure-jwt-secret-key-here
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# Firebase Configuration
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nYOUR_PRIVATE_KEY_HERE\\n-----END PRIVATE KEY-----\\n"
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com

# Google Maps API
GOOGLE_MAPS_API_KEY=your-google-maps-api-key

# MSG91 Configuration removed - using Firebase Auth

# CORS Configuration
CORS_ORIGIN=https://your-frontend-domain.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# WebSocket Configuration
WEBSOCKET_CORS_ORIGIN=https://your-frontend-domain.com

# Monitoring
ENABLE_MONITORING=true
LOG_LEVEL=info
`;

  const envPath = path.join(__dirname, '..', '.env.production.template');
  fs.writeFileSync(envPath, envTemplate);
  console.log(`📄 Production environment template created: ${envPath}`);
}

/**
 * Validate package.json
 */
async function validatePackageJson() {
  const packagePath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  // Check required scripts
  const requiredScripts = ['start', 'dev', 'test', 'lint'];
  const missingScripts = requiredScripts.filter(script => !packageJson.scripts[script]);
  
  if (missingScripts.length > 0) {
    throw new Error(`Missing required scripts: ${missingScripts.join(', ')}`);
  }

  // Check required dependencies
  const requiredDeps = [
    'express', 'cors', 'helmet', 'morgan', 'compression',
    'express-rate-limit', 'express-slow-down', 'express-validator',
    'jsonwebtoken', 'bcryptjs', 'firebase-admin', 'socket.io'
  ];
  
  const missingDeps = requiredDeps.filter(dep => 
    !packageJson.dependencies[dep] && !packageJson.devDependencies[dep]
  );
  
  if (missingDeps.length > 0) {
    throw new Error(`Missing required dependencies: ${missingDeps.join(', ')}`);
  }

  console.log('✅ Package.json validation passed');
}

/**
 * Check for security vulnerabilities
 */
async function checkSecurityVulnerabilities() {
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);

    // Run npm audit
    const { stdout, stderr } = await execAsync('npm audit --audit-level=moderate');
    
    if (stderr && stderr.includes('found 0 vulnerabilities')) {
      console.log('✅ No security vulnerabilities found');
    } else if (stderr && stderr.includes('found')) {
      console.log('⚠️ Security vulnerabilities found:');
      console.log(stderr);
    } else {
      console.log('✅ Security check completed');
    }
  } catch (error) {
    console.log('⚠️ Could not run security audit (npm audit not available)');
  }
}

/**
 * Create deployment checklist
 */
function createDeploymentChecklist() {
  const checklist = `# Deployment Checklist

## Pre-Deployment
- [ ] All environment variables configured
- [ ] Firebase project configured and accessible
- [ ] Google Maps API key valid and has required permissions
- [ ] Firebase Auth configured for OTP
- [ ] Database indexes created in Firestore
- [ ] Security rules deployed to Firestore
- [ ] SSL certificate configured (if using custom domain)

## Deployment
- [ ] Code deployed to production server
- [ ] Environment variables set on production server
- [ ] Server started successfully
- [ ] Health check endpoint responding
- [ ] Database connectivity verified
- [ ] External API connectivity verified

## Post-Deployment
- [ ] Monitor application logs
- [ ] Test critical user flows
- [ ] Verify real-time features working
- [ ] Check performance metrics
- [ ] Set up monitoring alerts
- [ ] Update DNS records (if applicable)

## Monitoring
- [ ] Health check: /api/health
- [ ] Metrics: /api/health/metrics
- [ ] Logs: /api/health/logs
- [ ] Alerts: /api/health/alerts
`;

  const checklistPath = path.join(__dirname, '..', 'deployment-checklist.md');
  fs.writeFileSync(checklistPath, checklist);
  console.log(`📋 Deployment checklist created: ${checklistPath}`);
}

// Run deployment if called directly
if (require.main === module) {
  deploy().catch(error => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
}

module.exports = { deploy, createDeploymentChecklist };
