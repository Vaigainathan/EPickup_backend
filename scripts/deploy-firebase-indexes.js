const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Automatic Firebase Index and Rules Deployment Script
 * Deploys Firestore indexes and security rules automatically
 */

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : '📋';
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function checkFirebaseCLI() {
  try {
    execSync('firebase --version', { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

function checkFirebaseProject() {
  try {
    const result = execSync('firebase projects:list', { stdio: 'pipe', encoding: 'utf8' });
    return result.includes('No projects found') ? false : true;
  } catch (error) {
    return false;
  }
}

function checkFirebaseLogin() {
  try {
    const result = execSync('firebase login:list', { stdio: 'pipe', encoding: 'utf8' });
    return result.includes('No authorized accounts') ? false : true;
  } catch (error) {
    return false;
  }
}

function initializeFirebase() {
  log('🚀 Initializing Firebase project...');
  
  try {
    // Check if firebase.json already exists
    if (fs.existsSync(path.join(__dirname, '../firebase.json'))) {
      log('✅ Firebase configuration already exists');
      return true;
    }
    
    // Initialize Firebase
    execSync('firebase init firestore --yes', { 
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
    
    log('✅ Firebase project initialized successfully');
    return true;
  } catch (error) {
    log(`❌ Failed to initialize Firebase: ${error.message}`, 'error');
    return false;
  }
}

function deployFirestoreIndexes() {
  log('🔥 Deploying Firestore indexes...');
  
  try {
    // Deploy only Firestore indexes and rules
    execSync('firebase deploy --only firestore:indexes,firestore:rules', { 
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
    
    log('✅ Firestore indexes and rules deployed successfully');
    return true;
  } catch (error) {
    log(`❌ Failed to deploy Firestore indexes: ${error.message}`, 'error');
    return false;
  }
}

function checkIndexStatus() {
  log('📊 Checking index build status...');
  
  try {
    // List operations to check index build status
    const result = execSync('gcloud firestore operations list --limit=10', { 
      stdio: 'pipe',
      encoding: 'utf8'
    });
    
    console.log('\n📋 Recent Firestore Operations:');
    console.log(result);
    
    return true;
  } catch (error) {
    log(`⚠️  Could not check index status: ${error.message}`, 'warning');
    return false;
  }
}

function displayManualInstructions() {
  console.log('\n📋 MANUAL FIREBASE SETUP (if automatic deployment fails):');
  console.log('========================================================');
  console.log('');
  console.log('1. 🔥 INSTALL FIREBASE CLI:');
  console.log('   npm install -g firebase-tools');
  console.log('');
  console.log('2. 🔐 LOGIN TO FIREBASE:');
  console.log('   firebase login');
  console.log('');
  console.log('3. 🏗️  INITIALIZE PROJECT:');
  console.log('   firebase init firestore');
  console.log('');
  console.log('4. 🚀 DEPLOY INDEXES:');
  console.log('   firebase deploy --only firestore:indexes,firestore:rules');
  console.log('');
  console.log('5. 📊 CHECK STATUS:');
  console.log('   gcloud firestore operations list');
  console.log('');
  console.log('📝 ALTERNATIVE: Use Firebase Console');
  console.log('   • Go to: https://console.firebase.google.com');
  console.log('   • Navigate to Firestore Database → Indexes');
  console.log('   • Create indexes manually using the configurations in firestore.indexes.json');
  console.log('');
}

async function main() {
  console.log('🚀 Automatic Firebase Index Deployment');
  console.log('======================================\n');
  
  try {
    // Check prerequisites
    log('🔍 Checking prerequisites...');
    
    if (!checkFirebaseCLI()) {
      log('❌ Firebase CLI not installed. Installing...', 'error');
      try {
        execSync('npm install -g firebase-tools', { stdio: 'inherit' });
        log('✅ Firebase CLI installed successfully');
      } catch (error) {
        log('❌ Failed to install Firebase CLI', 'error');
        displayManualInstructions();
        return;
      }
    } else {
      log('✅ Firebase CLI is installed');
    }
    
    if (!checkFirebaseLogin()) {
      log('❌ Not logged into Firebase. Please login first.', 'error');
      try {
        execSync('firebase login', { stdio: 'inherit' });
        log('✅ Firebase login successful');
      } catch (error) {
        log('❌ Firebase login failed', 'error');
        displayManualInstructions();
        return;
      }
    } else {
      log('✅ Firebase login verified');
    }
    
    // Initialize Firebase project
    if (!initializeFirebase()) {
      displayManualInstructions();
      return;
    }
    
    // Deploy indexes and rules
    if (!deployFirestoreIndexes()) {
      displayManualInstructions();
      return;
    }
    
    // Check index status
    checkIndexStatus();
    
    console.log('\n🎉 AUTOMATIC DEPLOYMENT COMPLETED SUCCESSFULLY!');
    console.log('===============================================');
    console.log('');
    console.log('✅ Firestore indexes created');
    console.log('✅ Security rules deployed');
    console.log('✅ Database ready for production');
    console.log('');
    console.log('📊 Monitor index build progress:');
    console.log('   gcloud firestore operations list');
    console.log('');
    console.log('🌐 View in Firebase Console:');
    console.log('   https://console.firebase.google.com');
    console.log('');
    
  } catch (error) {
    log(`❌ Deployment failed: ${error.message}`, 'error');
    displayManualInstructions();
  }
}

// Run deployment if called directly
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n🏁 Index deployment script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Index deployment script failed:', error);
      process.exit(1);
    });
}

module.exports = {
  checkFirebaseCLI,
  checkFirebaseLogin,
  initializeFirebase,
  deployFirestoreIndexes,
  checkIndexStatus
};
