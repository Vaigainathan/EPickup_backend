const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function deployFirebaseConfig() {
  try {
    console.log('🚀 Deploying Firebase configuration...');
    
    // Check if Firebase CLI is installed
    try {
      execSync('firebase --version', { stdio: 'pipe' });
    } catch (error) {
      console.error('❌ Firebase CLI not found. Please install it first:');
      console.error('   npm install -g firebase-tools');
      process.exit(1);
    }
    
    // Check if user is logged in
    try {
      execSync('firebase projects:list', { stdio: 'pipe' });
    } catch (error) {
      console.error('❌ Not logged in to Firebase. Please run:');
      console.error('   firebase login');
      process.exit(1);
    }
    
    console.log('📋 Deploying Firestore rules...');
    execSync('firebase deploy --only firestore:rules', { stdio: 'inherit' });
    
    console.log('📋 Deploying Storage rules...');
    execSync('firebase deploy --only storage', { stdio: 'inherit' });
    
    console.log('📋 Deploying Firestore indexes...');
    execSync('firebase deploy --only firestore:indexes', { stdio: 'inherit' });
    
    console.log('✅ Firebase configuration deployed successfully!');
    
  } catch (error) {
    console.error('❌ Error deploying Firebase configuration:', error.message);
    process.exit(1);
  }
}

async function main() {
  console.log('🔧 Starting Firebase configuration deployment...');
  await deployFirebaseConfig();
  console.log('✅ Deployment completed!');
}

if (require.main === module) {
  main();
}

module.exports = { deployFirebaseConfig };
