const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Production Deployment Script
 * Handles the complete deployment process for EPickup Backend
 */

const DEPLOYMENT_STEPS = [
  {
    name: 'Environment Validation',
    command: 'npm run validate:config',
    description: 'Validate environment configuration'
  },
  {
    name: 'Database Migration',
    command: 'npm run migrate',
    description: 'Run database migrations'
  },
  {
    name: 'Security Validation',
    command: 'npm run validate:security',
    description: 'Validate security configurations'
  },
  {
    name: 'Test Suite',
    command: 'npm test',
    description: 'Run all tests'
  },
  {
    name: 'Linting',
    command: 'npm run lint',
    description: 'Check code quality'
  },
  {
    name: 'Build Process',
    command: 'npm run build',
    description: 'Build for production'
  }
];

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : '📋';
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function checkPrerequisites() {
  log('🔍 Checking deployment prerequisites...');
  
  // Check if .env file exists
  if (!fs.existsSync(path.join(__dirname, '../.env'))) {
    throw new Error('❌ .env file not found. Please create one with your environment variables.');
  }
  
  // Check if Firebase service account key exists
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!serviceAccountPath || !fs.existsSync(serviceAccountPath)) {
    log('⚠️  Firebase service account key not found. Make sure GOOGLE_APPLICATION_CREDENTIALS is set correctly.', 'warning');
  }
  
  // Check Node.js version
  const nodeVersion = process.version;
  const requiredVersion = '18.0.0';
  if (nodeVersion < requiredVersion) {
    throw new Error(`❌ Node.js version ${requiredVersion} or higher is required. Current version: ${nodeVersion}`);
  }
  
  log('✅ Prerequisites check completed');
}

function runStep(step, index) {
  log(`🚀 Step ${index + 1}/${DEPLOYMENT_STEPS.length}: ${step.name}`);
  log(`📝 ${step.description}`);
  
  try {
    execSync(step.command, { 
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
    log(`✅ ${step.name} completed successfully`);
    return true;
  } catch (error) {
    log(`❌ ${step.name} failed: ${error.message}`, 'error');
    return false;
  }
}

function generateDeploymentReport(results) {
  const report = {
    timestamp: new Date().toISOString(),
    totalSteps: DEPLOYMENT_STEPS.length,
    successfulSteps: results.filter(r => r.success).length,
    failedSteps: results.filter(r => !r.success).length,
    results: results
  };
  
  const reportPath = path.join(__dirname, '../deployment-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  log(`📊 Deployment report saved to: ${reportPath}`);
  return report;
}

function displayNextSteps() {
  console.log('\n🎯 NEXT STEPS FOR PRODUCTION DEPLOYMENT:');
  console.log('==========================================');
  console.log('');
  console.log('1. 🔥 FIREBASE CONSOLE SETUP:');
  console.log('   • Go to: https://console.firebase.google.com');
  console.log('   • Select your project');
  console.log('   • Navigate to Firestore Database → Indexes');
  console.log('   • Create the composite indexes listed in the migration output');
  console.log('');
  console.log('2. 🔒 SECURITY RULES:');
  console.log('   • Copy the contents of firestore.rules');
  console.log('   • Go to Firestore Database → Rules');
  console.log('   • Paste and publish the security rules');
  console.log('');
  console.log('3. 🌐 DEPLOY TO HOSTING PLATFORM:');
  console.log('   • Choose your hosting platform (Heroku, AWS, Google Cloud, etc.)');
  console.log('   • Set up environment variables');
  console.log('   • Deploy the backend code');
  console.log('');
  console.log('4. 📱 MOBILE APP DEPLOYMENT:');
  console.log('   • Build and deploy Customer App');
  console.log('   • Build and deploy Driver App');
  console.log('');
  console.log('5. 🔧 POST-DEPLOYMENT:');
  console.log('   • Test all API endpoints');
  console.log('   • Verify real-time features');
  console.log('   • Monitor logs and performance');
  console.log('');
}

async function main() {
  console.log('🚀 EPickup Backend Production Deployment');
  console.log('=========================================\n');
  
  try {
    // Check prerequisites
    checkPrerequisites();
    console.log('');
    
    // Run deployment steps
    const results = [];
    for (let i = 0; i < DEPLOYMENT_STEPS.length; i++) {
      const step = DEPLOYMENT_STEPS[i];
      const success = runStep(step, i);
      results.push({ step: step.name, success });
      
      if (!success) {
        log(`❌ Deployment failed at step: ${step.name}`, 'error');
        break;
      }
      
      console.log('');
    }
    
    // Generate deployment report
    const report = generateDeploymentReport(results);
    
    // Display results
    console.log('\n📊 DEPLOYMENT SUMMARY:');
    console.log('======================');
    console.log(`✅ Successful steps: ${report.successfulSteps}/${report.totalSteps}`);
    console.log(`❌ Failed steps: ${report.failedSteps}/${report.totalSteps}`);
    
    if (report.failedSteps === 0) {
      console.log('\n🎉 DEPLOYMENT PREPARATION COMPLETED SUCCESSFULLY!');
      displayNextSteps();
    } else {
      console.log('\n⚠️  DEPLOYMENT PREPARATION FAILED');
      console.log('Please fix the failed steps before proceeding to production.');
    }
    
  } catch (error) {
    log(`❌ Deployment preparation failed: ${error.message}`, 'error');
    process.exit(1);
  }
}

// Run deployment if called directly
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n🏁 Deployment script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Deployment script failed:', error);
      process.exit(1);
    });
}

module.exports = {
  DEPLOYMENT_STEPS,
  checkPrerequisites,
  runStep,
  generateDeploymentReport,
  displayNextSteps
};
