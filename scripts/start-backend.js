#!/usr/bin/env node

/**
 * EPickup Backend Startup Script
 * Demonstrates the new configuration system and provides a clean startup process
 */

const path = require('path');
const { spawn } = require('child_process');

console.log('🚀 EPickup Backend Startup');
console.log('==========================\n');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, description) {
  console.log(`\n${colors.cyan}${step}${colors.reset} ${description}`);
}

async function runCommand(command, args, description) {
  return new Promise((resolve, reject) => {
    logStep('▶️', description);
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        log(`✅ ${description} completed successfully`, 'green');
        resolve();
      } else {
        log(`❌ ${description} failed with code ${code}`, 'red');
        reject(new Error(`Command failed with code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      log(`❌ ${description} error: ${error.message}`, 'red');
      reject(error);
    });
  });
}

async function checkPrerequisites() {
  logStep('🔍', 'Checking prerequisites...');
  
  // Check if .env file exists
  const envPath = path.join(__dirname, '..', '.env');
  const fs = require('fs');
  
  if (!fs.existsSync(envPath)) {
    log('❌ .env file not found!', 'red');
    log('Please copy .env.example to .env and configure your environment variables.', 'yellow');
    process.exit(1);
  }
  
  log('✅ .env file found', 'green');
  
  // Check if node_modules exists
  const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    log('⚠️  node_modules not found. Installing dependencies...', 'yellow');
    await runCommand('npm', ['install'], 'Installing dependencies');
  } else {
    log('✅ Dependencies already installed', 'green');
  }
}

async function validateConfiguration() {
  logStep('⚙️', 'Validating configuration...');
  
  try {
    await runCommand('npm', ['run', 'validate:config'], 'Configuration validation');
  } catch (error) {
    log('❌ Configuration validation failed!', 'red');
    log('Please fix the configuration issues before starting the backend.', 'yellow');
    process.exit(1);
  }
}

async function setupDatabase() {
  logStep('🗄️', 'Setting up database...');
  
  try {
    await runCommand('npm', ['run', 'migrate'], 'Database migration');
  } catch (error) {
    log('❌ Database setup failed!', 'red');
    log('Please check the database connection and try again.', 'yellow');
    process.exit(1);
  }
}

async function testServices() {
  logStep('🧪', 'Testing services...');
  
  try {
    await runCommand('npm', ['run', 'test:all'], 'Service testing');
  } catch (error) {
    log('⚠️  Some service tests failed!', 'yellow');
    log('The backend may still work, but some features might be limited.', 'yellow');
    
    // Ask user if they want to continue
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise((resolve) => {
      rl.question('Do you want to continue starting the backend? (y/N): ', resolve);
    });
    
    rl.close();
    
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      log('Backend startup cancelled by user.', 'yellow');
      process.exit(0);
    }
  }
}

async function startBackend() {
  logStep('🚀', 'Starting backend server...');
  
  try {
    // Start the backend in development mode
    const child = spawn('npm', ['run', 'dev'], {
      stdio: 'inherit',
      shell: true
    });
    
    log('✅ Backend server started successfully!', 'green');
    log('📱 Server is running in development mode', 'cyan');
    log('🌐 API endpoints available at: http://localhost:3000', 'cyan');
    log('📊 Monitor logs above for real-time information', 'cyan');
    log('\n🛑 Press Ctrl+C to stop the server', 'yellow');
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      log('\n\n🛑 Shutting down backend server...', 'yellow');
      child.kill('SIGINT');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      log('\n\n🛑 Shutting down backend server...', 'yellow');
      child.kill('SIGTERM');
      process.exit(0);
    });
    
    // Handle child process exit
    child.on('exit', (code) => {
      if (code !== 0) {
        log(`❌ Backend server exited with code ${code}`, 'red');
        process.exit(code);
      }
    });
    
  } catch (error) {
    log(`❌ Failed to start backend server: ${error.message}`, 'red');
    process.exit(1);
  }
}

async function main() {
  try {
    log('Welcome to EPickup Backend!', 'bright');
    log('This script will help you get your backend up and running.\n', 'cyan');
    
    // Check prerequisites
    await checkPrerequisites();
    
    // Validate configuration
    await validateConfiguration();
    
    // Setup database
    await setupDatabase();
    
    // Test services
    await testServices();
    
    // Start backend
    await startBackend();
    
  } catch (error) {
    log(`\n💥 Startup failed: ${error.message}`, 'red');
    log('Please check the error messages above and try again.', 'yellow');
    process.exit(1);
  }
}

// Run startup if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  main,
  checkPrerequisites,
  validateConfiguration,
  setupDatabase,
  testServices,
  startBackend
};
