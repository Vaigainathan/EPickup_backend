/**
 * Backend Admin Data Creation Script
 * Uses Firebase Admin SDK to create admin data
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // You'll need to download this

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'epickup-app'
});

const db = admin.firestore();

async function createAdminData() {
  try {
    console.log('🔧 Creating admin data using Firebase Admin SDK...');
    
    const userId = 'pLYsn6pWS1b5VORROWC1jqqZbCS2';
    
    const adminUserData = {
      uid: userId,
      id: userId,
      email: 'admin@epickup.com', // Update with actual email
      name: 'EPickup Admin',
      displayName: 'EPickup Admin',
      role: 'super_admin',
      permissions: ['all'],
      userType: 'admin',
      isEmailVerified: true,
      isActive: true,
      accountStatus: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    
    // Create in adminUsers collection
    await db.collection('adminUsers').doc(userId).set(adminUserData);
    console.log('✅ Created in adminUsers collection');
    
    // Create in users collection
    await db.collection('users').doc(userId).set(adminUserData);
    console.log('✅ Created in users collection');
    
    console.log('🎉 Admin data created successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

createAdminData();
