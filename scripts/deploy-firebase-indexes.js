#!/usr/bin/env node

/**
 * Deploy Firestore indexes to Firebase
 * This script deploys the indexes defined in firestore.indexes.json
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Deploying Firestore indexes...');

try {
  // Check if firebase CLI is installed
  try {
    execSync('firebase --version', { stdio: 'pipe' });
  } catch {
    console.error('❌ Firebase CLI not found. Please install it first:');
    console.error('   npm install -g firebase-tools');
    process.exit(1);
  }

  // Check if user is logged in
  try {
    execSync('firebase projects:list', { stdio: 'pipe' });
  } catch {
    console.error('❌ Not logged in to Firebase. Please login first:');
    console.error('   firebase login');
    process.exit(1);
  }

  // Deploy indexes
  console.log('📦 Deploying Firestore indexes...');
  execSync('firebase deploy --only firestore:indexes', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });

  console.log('✅ Firestore indexes deployed successfully!');
  console.log('');
  console.log('📋 Deployed indexes:');
  console.log('   - bookings: status + driverId + createdAt (for driver available bookings)');
  console.log('   - bookings: driverId + status + createdAt (for driver trip history)');
  console.log('   - All other existing indexes maintained');
  console.log('');
  console.log('🔍 You can verify the indexes in the Firebase Console:');
  console.log('   https://console.firebase.google.com/project/YOUR_PROJECT/firestore/indexes');

} catch (error) {
  console.error('❌ Error deploying Firestore indexes:', error.message);
  process.exit(1);
}