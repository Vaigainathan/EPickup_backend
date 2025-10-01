#!/usr/bin/env node

/**
 * Setup Admin User Script
 * Creates admin users in Firebase Auth with proper custom claims
 * Usage: node scripts/setup-admin-user.js <email> <password> [role]
 */

const { getAuth } = require('firebase-admin/auth');
const { initializeFirebase } = require('../src/services/firebase');

async function setupAdminUser(email, password, role = 'super_admin') {
  try {
    // Initialize Firebase
    initializeFirebase();
    const auth = getAuth();

    console.log(`🔧 Setting up admin user: ${email}`);

    // Check if user already exists
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
      console.log(`✅ User already exists: ${userRecord.uid}`);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Create new user
        userRecord = await auth.createUser({
          email: email,
          password: password,
          displayName: 'Admin User',
          emailVerified: true
        });
        console.log(`✅ Created new user: ${userRecord.uid}`);
      } else {
        throw error;
      }
    }

    // Set custom claims for admin privileges
    await auth.setCustomUserClaims(userRecord.uid, {
      userType: 'admin',
      role: role,
      permissions: ['all'],
      adminLevel: 'super_admin'
    });

    console.log(`✅ Set admin custom claims for user: ${userRecord.uid}`);
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Role: ${role}`);
    console.log(`🎯 Permissions: all`);

    // Verify the claims were set
    const updatedUser = await auth.getUser(userRecord.uid);
    console.log(`✅ Custom claims verified:`, updatedUser.customClaims);

    console.log(`\n🎉 Admin user setup complete!`);
    console.log(`📝 The user can now login to the admin dashboard with:`);
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);

  } catch (error) {
    console.error('❌ Error setting up admin user:', error);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node scripts/setup-admin-user.js <email> <password> [role]');
  console.log('Example: node scripts/setup-admin-user.js admin@yourdomain.com SecurePassword123! super_admin');
  process.exit(1);
}

const [email, password, role] = args;

// Validate email format
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  console.error('❌ Invalid email format');
  process.exit(1);
}

// Validate password strength
if (password.length < 8) {
  console.error('❌ Password must be at least 8 characters long');
  process.exit(1);
}

// Run the setup
setupAdminUser(email, password, role);
