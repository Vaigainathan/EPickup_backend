#!/usr/bin/env node

/**
 * Complete Database Cleanup Script with User Deletion
 * 
 * This script will clean up ALL data including deleting all user accounts.
 * 
 * WARNING: This will delete EVERYTHING from the database including:
 * - All bookings and booking history
 * - All user accounts (customers, drivers, admins)
 * - All wallet and earnings data
 * - All verification data
 * - All system logs and analytics
 * 
 * Usage: node scripts/cleanup-with-users.js
 */

const DatabaseCleanup = require('./cleanup-all-data');

class CompleteCleanup extends DatabaseCleanup {
  async runCompleteCleanup() {
    console.log('🚀 Starting COMPLETE database cleanup with user deletion...');
    console.log('⚠️  EXTREME WARNING: This will delete EVERYTHING including all user accounts!');
    console.log('⚠️  This action is IRREVERSIBLE!');
    console.log('⚠️  All drivers, customers, and admins will be deleted!');
    
    // Run the full cleanup with user deletion
    await this.runFullCleanup(true);
    
    console.log('\n🎉 COMPLETE CLEANUP FINISHED!');
    console.log('🔄 The system is now in a completely fresh state.');
    console.log('📝 You will need to create new user accounts for testing.');
  }
}

// Run complete cleanup if called directly
if (require.main === module) {
  const cleanup = new CompleteCleanup();
  cleanup.runCompleteCleanup()
    .then(() => {
      console.log('🎉 Complete cleanup with user deletion finished!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Complete cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = CompleteCleanup;
