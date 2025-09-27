#!/usr/bin/env node

/**
 * Enable Testing Mode for Development
 * This script sets the BYPASS_RADIUS_CHECK environment variable to bypass distance filtering
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Enabling testing mode for development...');

// Read current .env file
const envPath = path.join(__dirname, '.env');
let envContent = '';

if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
} else {
  console.log('📝 Creating new .env file...');
  envContent = fs.readFileSync(path.join(__dirname, '.env.example'), 'utf8');
}

// Add or update BYPASS_RADIUS_CHECK
if (envContent.includes('BYPASS_RADIUS_CHECK=')) {
  envContent = envContent.replace(
    /BYPASS_RADIUS_CHECK=.*/,
    'BYPASS_RADIUS_CHECK=true'
  );
  console.log('✅ Updated BYPASS_RADIUS_CHECK=true');
} else {
  envContent += '\n# Testing Configuration\nBYPASS_RADIUS_CHECK=true\n';
  console.log('✅ Added BYPASS_RADIUS_CHECK=true');
}

// Write back to .env file
fs.writeFileSync(envPath, envContent);

console.log('🎉 Testing mode enabled!');
console.log('📋 This will bypass radius filtering and show all bookings regardless of distance');
console.log('⚠️  Remember to disable this in production by setting BYPASS_RADIUS_CHECK=false');
console.log('');
console.log('🚀 Restart your backend server to apply changes:');
console.log('   npm start');
