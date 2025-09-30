#!/usr/bin/env node

/**
 * Deploy Optimized Firestore Configuration
 * 
 * This script deploys the optimized Firestore rules and indexes
 * with all missing indexes and duplicate removals.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'your-project-id';
const FIREBASE_CLI_VERSION = '>= 12.0.0';

console.log('🚀 Deploying Optimized Firestore Configuration');
console.log('===============================================');

// Check if Firebase CLI is installed
function checkFirebaseCLI() {
  try {
    const version = execSync('firebase --version', { encoding: 'utf8' }).trim();
    console.log(`✅ Firebase CLI version: ${version}`);
    return true;
  } catch (error) {
    console.error('❌ Firebase CLI not found. Please install it first:');
    console.error('   npm install -g firebase-tools');
    return false;
  }
}

// Check if user is logged in
function checkFirebaseAuth() {
  try {
    execSync('firebase projects:list', { stdio: 'pipe' });
    console.log('✅ Firebase authentication verified');
    return true;
  } catch (error) {
    console.error('❌ Not authenticated with Firebase. Please run:');
    console.error('   firebase login');
    return false;
  }
}

// Deploy Firestore rules
function deployRules() {
  console.log('\n📋 Deploying Firestore Rules...');
  
  const rulesFile = path.join(__dirname, '..', 'firestore.rules.optimized');
  const targetRulesFile = path.join(__dirname, '..', 'firestore.rules');
  
  if (!fs.existsSync(rulesFile)) {
    console.error(`❌ Rules file not found: ${rulesFile}`);
    return false;
  }
  
  try {
    // Copy optimized rules to main rules file
    fs.copyFileSync(rulesFile, targetRulesFile);
    console.log('✅ Rules file copied');
    
    // Deploy rules
    execSync(`firebase deploy --only firestore:rules --project ${PROJECT_ID}`, { 
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
    
    console.log('✅ Firestore rules deployed successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to deploy Firestore rules:', error.message);
    return false;
  }
}

// Deploy Firestore indexes
function deployIndexes() {
  console.log('\n📊 Deploying Firestore Indexes...');
  
  const indexesFile = path.join(__dirname, '..', 'firestore.indexes.optimized.json');
  const targetIndexesFile = path.join(__dirname, '..', 'firestore.indexes.json');
  
  if (!fs.existsSync(indexesFile)) {
    console.error(`❌ Indexes file not found: ${indexesFile}`);
    return false;
  }
  
  try {
    // Copy optimized indexes to main indexes file
    fs.copyFileSync(indexesFile, targetIndexesFile);
    console.log('✅ Indexes file copied');
    
    // Deploy indexes
    execSync(`firebase deploy --only firestore:indexes --project ${PROJECT_ID}`, { 
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
    
    console.log('✅ Firestore indexes deployed successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to deploy Firestore indexes:', error.message);
    return false;
  }
}

// Validate configuration
function validateConfiguration() {
  console.log('\n🔍 Validating Configuration...');
  
  const rulesFile = path.join(__dirname, '..', 'firestore.rules.optimized');
  const indexesFile = path.join(__dirname, '..', 'firestore.indexes.optimized.json');
  
  // Check if files exist
  if (!fs.existsSync(rulesFile)) {
    console.error(`❌ Rules file not found: ${rulesFile}`);
    return false;
  }
  
  if (!fs.existsSync(indexesFile)) {
    console.error(`❌ Indexes file not found: ${indexesFile}`);
    return false;
  }
  
  // Validate JSON syntax
  try {
    const indexesContent = fs.readFileSync(indexesFile, 'utf8');
    JSON.parse(indexesContent);
    console.log('✅ Indexes JSON syntax is valid');
  } catch (error) {
    console.error('❌ Invalid JSON syntax in indexes file:', error.message);
    return false;
  }
  
  // Check for required collections
  const requiredCollections = [
    'users', 'bookings', 'workSlots', 'chat_messages', 
    'driverLocations', 'payments', 'notifications'
  ];
  
  const indexesContent = JSON.parse(fs.readFileSync(indexesFile, 'utf8'));
  const collections = new Set(indexesContent.indexes.map(idx => idx.collectionGroup));
  
  const missingCollections = requiredCollections.filter(col => !collections.has(col));
  if (missingCollections.length > 0) {
    console.error(`❌ Missing indexes for collections: ${missingCollections.join(', ')}`);
    return false;
  }
  
  console.log('✅ Configuration validation passed');
  return true;
}

// Show deployment summary
function showSummary() {
  console.log('\n📈 Deployment Summary');
  console.log('=====================');
  console.log('✅ Firestore Rules: Optimized with comprehensive security');
  console.log('✅ Firestore Indexes: Added missing indexes, removed duplicates');
  console.log('✅ Collections Covered: users, bookings, workSlots, chat_messages, etc.');
  console.log('✅ Security: Role-based access control with field validation');
  console.log('✅ Performance: Optimized for all query patterns');
  
  console.log('\n🎯 Key Improvements:');
  console.log('• Added chat_messages indexes for real-time messaging');
  console.log('• Added driverLocations indexes for location-based queries');
  console.log('• Added notifications indexes for user-specific notifications');
  console.log('• Removed duplicate indexes to reduce costs');
  console.log('• Enhanced security rules with comprehensive validation');
  console.log('• Added support for all collections used in the app');
  
  console.log('\n📋 Next Steps:');
  console.log('1. Test the deployed configuration in Firebase Console');
  console.log('2. Monitor query performance and costs');
  console.log('3. Verify all app functionality works correctly');
  console.log('4. Set up Firestore monitoring and alerts');
}

// Main deployment function
async function main() {
  console.log(`🎯 Target Project: ${PROJECT_ID}`);
  console.log(`📁 Working Directory: ${process.cwd()}`);
  
  // Pre-deployment checks
  if (!checkFirebaseCLI()) {
    process.exit(1);
  }
  
  if (!checkFirebaseAuth()) {
    process.exit(1);
  }
  
  if (!validateConfiguration()) {
    process.exit(1);
  }
  
  // Deploy configuration
  const rulesSuccess = deployRules();
  const indexesSuccess = deployIndexes();
  
  if (rulesSuccess && indexesSuccess) {
    showSummary();
    console.log('\n🎉 Deployment completed successfully!');
  } else {
    console.error('\n❌ Deployment failed. Please check the errors above.');
    process.exit(1);
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});

// Run deployment
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
}

module.exports = {
  checkFirebaseCLI,
  checkFirebaseAuth,
  deployRules,
  deployIndexes,
  validateConfiguration
};
