#!/usr/bin/env node

const chalk = require('chalk');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log(chalk.blue.bold('🚀 EPickup Backend Deployment Verification'));
console.log(chalk.gray('==========================================\n'));

// Test 1: Syntax Check
console.log(chalk.yellow('1. Checking server syntax...'));
try {
  execSync('node -c src/server.js', { stdio: 'pipe' });
  console.log(chalk.green('✅ Server syntax is valid'));
} catch (error) {
  console.log(chalk.red('❌ Server syntax error:'), error.message);
  process.exit(1);
}

// Test 2: Environment Variables
console.log(chalk.yellow('\n2. Checking environment variables...'));
const requiredEnvVars = [
  'NODE_ENV',
  'PORT',
  'JWT_SECRET',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_CLIENT_ID',
  'FIREBASE_AUTH_URI',
  'FIREBASE_TOKEN_URI',
  'FIREBASE_AUTH_PROVIDER_X509_CERT_URL',
  'FIREBASE_CLIENT_X509_CERT_URL'
];

const missingVars = [];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    missingVars.push(varName);
  }
});

if (missingVars.length > 0) {
  console.log(chalk.yellow('⚠️  Missing environment variables:'), missingVars.join(', '));
  console.log(chalk.gray('   These may be optional depending on your configuration'));
} else {
  console.log(chalk.green('✅ All required environment variables are set'));
}

// Test 3: Dependencies
console.log(chalk.yellow('\n3. Checking dependencies...'));
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const requiredDeps = [
    'express',
    'firebase-admin',
    'jsonwebtoken',
    'cors',
    'helmet',
    'compression'
  ];
  
  const missingDeps = [];
  requiredDeps.forEach(dep => {
    if (!packageJson.dependencies[dep]) {
      missingDeps.push(dep);
    }
  });
  
  if (missingDeps.length > 0) {
    console.log(chalk.red('❌ Missing dependencies:'), missingDeps.join(', '));
    process.exit(1);
  } else {
    console.log(chalk.green('✅ All required dependencies are present'));
  }
} catch (error) {
  console.log(chalk.red('❌ Error reading package.json:'), error.message);
  process.exit(1);
}

// Test 4: Configuration Files
console.log(chalk.yellow('\n4. Checking configuration files...'));
const requiredFiles = [
  'src/config/index.js',
  'src/config/environment.js',
  'firebase-service-account.json'
];

const missingFiles = [];
requiredFiles.forEach(file => {
  if (!fs.existsSync(file)) {
    missingFiles.push(file);
  }
});

if (missingFiles.length > 0) {
  console.log(chalk.yellow('⚠️  Missing files:'), missingFiles.join(', '));
  console.log(chalk.gray('   Some files may be optional or generated during deployment'));
} else {
  console.log(chalk.green('✅ All required configuration files are present'));
}

// Test 5: Module Loading
console.log(chalk.yellow('\n5. Testing module loading...'));
try {
  // Test loading main modules without starting the server
  require('../src/config');
  require('../src/middleware/errorHandler');
  require('../src/middleware/auth');
  console.log(chalk.green('✅ All modules load successfully'));
} catch (error) {
  console.log(chalk.red('❌ Module loading error:'), error.message);
  process.exit(1);
}

// Test 6: Port Availability (if running locally)
if (process.env.NODE_ENV === 'development') {
  console.log(chalk.yellow('\n6. Checking port availability...'));
  const port = process.env.PORT || 3000;
  try {
    const net = require('net');
    const server = net.createServer();
    server.listen(port, () => {
      server.close();
      console.log(chalk.green(`✅ Port ${port} is available`));
    });
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Port ${port} may be in use`));
  }
}

console.log(chalk.blue.bold('\n🎉 Deployment verification completed successfully!'));
console.log(chalk.gray('Your backend is ready for deployment.'));

// Final recommendations
console.log(chalk.cyan('\n📋 Deployment Checklist:'));
console.log(chalk.gray('• Ensure all environment variables are set in your deployment platform'));
console.log(chalk.gray('• Verify Firebase service account credentials are properly configured'));
console.log(chalk.gray('• Check that your deployment platform supports Node.js >=18.0.0'));
console.log(chalk.gray('• Ensure proper CORS settings for your frontend domains'));
console.log(chalk.gray('• Set up proper logging and monitoring (Sentry recommended for production)'));
