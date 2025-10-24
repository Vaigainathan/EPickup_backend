#!/usr/bin/env node

/**
 * Comprehensive Database Cleanup Script
 * 
 * This script will clean up all booking data and reset the system to a fresh state.
 * 
 * WARNING: This will delete ALL data from the following collections:
 * - bookings
 * - activeBookings
 * - bookingHistory
 * - driverLocations
 * - trackingData
 * - notifications
 * - supportTickets
 * - emergencyAlerts
 * - systemLogs
 * - photoVerifications
 * 
 * Usage: node scripts/cleanup-all-data.js
 */

const { getFirestore } = require('firebase-admin/firestore');
const { getFirebaseApp } = require('../src/services/firebase');

class DatabaseCleanup {
  constructor() {
    this.db = null;
    this.cleanupStats = {
      collections: {},
      totalDeleted: 0,
      errors: []
    };
  }

  async initialize() {
    try {
      console.log('🔥 Initializing Firebase connection...');
      const app = getFirebaseApp();
      
      if (!app) {
        console.error('❌ Firebase app is null. Cannot proceed with cleanup.');
        console.log('💡 Make sure Firebase service account file exists or environment variables are set.');
        return false;
      }
      
      this.db = getFirestore(app);
      console.log('✅ Firebase connection established');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Firebase:', error);
      console.log('💡 Make sure Firebase service account file exists or environment variables are set.');
      return false;
    }
  }

  async cleanupCollection(collectionName, batchSize = 100) {
    try {
      console.log(`🧹 Cleaning up collection: ${collectionName}`);
      
      let totalDeleted = 0;
      let hasMore = true;
      
      while (hasMore) {
        const snapshot = await this.db.collection(collectionName).limit(batchSize).get();
        
        if (snapshot.empty) {
          hasMore = false;
          break;
        }
        
        const batch = this.db.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        totalDeleted += snapshot.docs.length;
        
        console.log(`  📊 Deleted ${snapshot.docs.length} documents from ${collectionName} (Total: ${totalDeleted})`);
        
        // If we got fewer documents than batch size, we're done
        if (snapshot.docs.length < batchSize) {
          hasMore = false;
        }
      }
      
      this.cleanupStats.collections[collectionName] = totalDeleted;
      this.cleanupStats.totalDeleted += totalDeleted;
      
      console.log(`✅ Completed cleanup of ${collectionName}: ${totalDeleted} documents deleted`);
      return totalDeleted;
      
    } catch (error) {
      console.error(`❌ Error cleaning up ${collectionName}:`, error);
      this.cleanupStats.errors.push({
        collection: collectionName,
        error: error.message
      });
      return 0;
    }
  }

  async cleanupUserData() {
    try {
      console.log('👤 Cleaning up user-related data...');
      
      // Clean up user documents and verification data
      const collections = [
        'documentVerificationRequests',
        'driverDocuments',
        'driverDocumentsRejections',
        'driverVerificationStatus',
        'driverDataEntries',
        'photoVerifications',
        // Wallet and earnings data
        'driverWallets',
        'commissionTransactions',
        'rechargeTransactions',
        'pointsWallets',
        'pointsTransactions',
        'earningsData',
        'workSlots'
      ];
      
      for (const collection of collections) {
        await this.cleanupCollection(collection);
      }
      
      // Reset user verification statuses
      console.log('🔄 Resetting user verification statuses...');
      const usersSnapshot = await this.db.collection('users').get();
      
      const batch = this.db.batch();
      let userCount = 0;
      
      usersSnapshot.docs.forEach(doc => {
        const userData = doc.data();
        if (userData.userType === 'driver') {
          batch.update(doc.ref, {
            'driver.verificationStatus': 'pending',
            'driver.isVerified': false,
            'isVerified': false,
            'driver.verifiedDocumentsCount': 0,
            'driver.approvedAt': null,
            'driver.approvedBy': null,
            'driver.adminNotes': null,
            // Reset wallet and earnings data
            'driver.walletBalance': 0,
            'driver.totalEarnings': 0,
            'driver.thisWeekEarnings': 0,
            'driver.thisMonthEarnings': 0,
            'driver.totalTrips': 0,
            'driver.rating': 0,
            'driver.isOnline': false,
            'driver.isAvailable': false,
            updatedAt: new Date()
          });
          userCount++;
        }
      });
      
      if (userCount > 0) {
        await batch.commit();
        console.log(`✅ Reset verification status and wallet data for ${userCount} drivers`);
      }
      
    } catch (error) {
      console.error('❌ Error cleaning up user data:', error);
      this.cleanupStats.errors.push({
        operation: 'userData',
        error: error.message
      });
    }
  }

  async cleanupBookingData() {
    try {
      console.log('📦 Cleaning up booking-related data...');
      
      const collections = [
        'bookings',
        'activeBookings',
        'bookingHistory',
        'driverLocations',
        'trackingData',
        'notifications',
        'supportTickets',
        'emergencyAlerts',
        'systemLogs'
      ];
      
      for (const collection of collections) {
        await this.cleanupCollection(collection);
      }
      
    } catch (error) {
      console.error('❌ Error cleaning up booking data:', error);
      this.cleanupStats.errors.push({
        operation: 'bookingData',
        error: error.message
      });
    }
  }

  async cleanupSystemData() {
    try {
      console.log('⚙️ Cleaning up system data...');
      
      const collections = [
        'systemBackups',
        'systemMetrics',
        'analyticsData',
        'auditLogs'
      ];
      
      for (const collection of collections) {
        await this.cleanupCollection(collection);
      }
      
    } catch (error) {
      console.error('❌ Error cleaning up system data:', error);
      this.cleanupStats.errors.push({
        operation: 'systemData',
        error: error.message
      });
    }
  }

  async deleteAllUsers() {
    try {
      console.log('🗑️ Deleting ALL users from the system...');
      console.log('⚠️  WARNING: This will permanently delete all user accounts!');
      
      const usersSnapshot = await this.db.collection('users').get();
      let deletedCount = 0;
      
      const batch = this.db.batch();
      usersSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        deletedCount++;
      });
      
      if (deletedCount > 0) {
        await batch.commit();
        console.log(`✅ Deleted ${deletedCount} users from the system`);
        this.cleanupStats.collections['users'] = deletedCount;
        this.cleanupStats.totalDeleted += deletedCount;
      } else {
        console.log('ℹ️ No users found to delete');
      }
      
    } catch (error) {
      console.error('❌ Error deleting users:', error);
      this.cleanupStats.errors.push({
        operation: 'deleteAllUsers',
        error: error.message
      });
    }
  }

  async generateCleanupReport() {
    console.log('\n📊 CLEANUP REPORT');
    console.log('================');
    console.log(`Total documents deleted: ${this.cleanupStats.totalDeleted}`);
    console.log('\nCollections cleaned:');
    
    Object.entries(this.cleanupStats.collections).forEach(([collection, count]) => {
      console.log(`  ${collection}: ${count} documents`);
    });
    
    if (this.cleanupStats.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      this.cleanupStats.errors.forEach(error => {
        console.log(`  ${error.collection || error.operation}: ${error.error}`);
      });
    }
    
    console.log('\n✅ Database cleanup completed!');
  }

  async runFullCleanup(deleteUsers = false) {
    console.log('🚀 Starting comprehensive database cleanup...');
    console.log('⚠️  WARNING: This will delete ALL data from the database!');
    
    if (deleteUsers) {
      console.log('⚠️  EXTREME WARNING: This will also DELETE ALL USER ACCOUNTS!');
    }
    
    const initialized = await this.initialize();
    if (!initialized) {
      console.error('❌ Failed to initialize. Exiting...');
      process.exit(1);
    }
    
    try {
      // Step 1: Clean up booking data
      await this.cleanupBookingData();
      
      // Step 2: Clean up user data
      await this.cleanupUserData();
      
      // Step 3: Clean up system data
      await this.cleanupSystemData();
      
      // Step 4: Delete all users if requested
      if (deleteUsers) {
        await this.deleteAllUsers();
      }
      
      // Generate report
      await this.generateCleanupReport();
      
    } catch (error) {
      console.error('❌ Fatal error during cleanup:', error);
      process.exit(1);
    }
  }
}

// Run cleanup if called directly
if (require.main === module) {
  const cleanup = new DatabaseCleanup();
  cleanup.runFullCleanup()
    .then(() => {
      console.log('🎉 Cleanup completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = DatabaseCleanup;
