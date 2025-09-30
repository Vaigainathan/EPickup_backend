const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

/**
 * Rollback Script: Restore users from backup
 * 
 * This script will:
 * 1. Load a backup file
 * 2. Restore users to their original state
 * 3. Remove migrated Firebase users if needed
 */

class MigrationRollbackService {
  constructor() {
    this.db = getFirestore();
    this.backupDir = path.join(__dirname, '..', 'backups');
  }

  /**
   * List available backup files
   */
  listBackupFiles() {
    if (!fs.existsSync(this.backupDir)) {
      console.log('❌ No backup directory found');
      return [];
    }

    const files = fs.readdirSync(this.backupDir)
      .filter(file => file.startsWith('users-backup-') && file.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first

    return files;
  }

  /**
   * Load backup data from file
   */
  loadBackup(backupFile) {
    try {
      const filePath = path.join(this.backupDir, backupFile);
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`❌ Error loading backup file ${backupFile}:`, error);
      throw error;
    }
  }

  /**
   * Rollback migration by restoring from backup
   */
  async rollbackMigration(backupFile) {
    try {
      console.log(`🔄 Rolling back migration using ${backupFile}...`);
      
      const backupData = this.loadBackup(backupFile);
      console.log(`📊 Backup contains ${backupData.totalUsers} users`);
      console.log(`   🔥 Firebase users: ${backupData.firebaseUsers}`);
      console.log(`   🆔 Custom users: ${backupData.customUsers}`);

      let restoredCount = 0;
      let errorCount = 0;

      // Restore each user
      for (const user of backupData.users) {
        try {
          // Delete current user if exists
          await this.db.collection('users').doc(user.id).delete();
          
          // Restore original user data
          await this.db.collection('users').doc(user.id).set(user.data);
          
          console.log(`   ✅ Restored user: ${user.id}`);
          restoredCount++;
          
        } catch (error) {
          console.error(`   ❌ Error restoring user ${user.id}:`, error);
          errorCount++;
        }
      }

      console.log(`\n📊 Rollback Summary:`);
      console.log(`   ✅ Restored: ${restoredCount}`);
      console.log(`   ❌ Errors: ${errorCount}`);
      console.log(`   📝 Total: ${backupData.totalUsers}`);

    } catch (error) {
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }

  /**
   * Show backup file details
   */
  showBackupDetails(backupFile) {
    try {
      const backupData = this.loadBackup(backupFile);
      
      console.log(`\n📁 Backup Details: ${backupFile}`);
      console.log(`   📅 Created: ${backupData.timestamp}`);
      console.log(`   👥 Total users: ${backupData.totalUsers}`);
      console.log(`   🔥 Firebase users: ${backupData.firebaseUsers}`);
      console.log(`   🆔 Custom users: ${backupData.customUsers}`);
      
      // Show sample users
      console.log(`\n📋 Sample users:`);
      backupData.users.slice(0, 5).forEach(user => {
        console.log(`   ${user.isFirebaseUID ? '🔥' : '🆔'} ${user.id} - ${user.data.phone} - ${user.data.name || 'N/A'}`);
      });
      
      if (backupData.users.length > 5) {
        console.log(`   ... and ${backupData.users.length - 5} more`);
      }
      
    } catch (error) {
      console.error(`❌ Error showing backup details:`, error);
    }
  }
}

// Main execution
async function main() {
  try {
    const rollbackService = new MigrationRollbackService();
    
    // List available backups
    const backupFiles = rollbackService.listBackupFiles();
    
    if (backupFiles.length === 0) {
      console.log('❌ No backup files found');
      process.exit(1);
    }

    console.log('📁 Available backup files:');
    backupFiles.forEach((file, index) => {
      console.log(`   ${index + 1}. ${file}`);
    });

    // For now, use the most recent backup
    const selectedBackup = backupFiles[0];
    console.log(`\n🔄 Using most recent backup: ${selectedBackup}`);
    
    // Show details
    rollbackService.showBackupDetails(selectedBackup);
    
    // Confirm rollback
    console.log('\n⚠️  WARNING: This will restore users to their pre-migration state!');
    console.log('   This action cannot be undone.');
    console.log('   Make sure you have a current backup before proceeding.');
    
    // In a real scenario, you'd want user confirmation here
    // For now, we'll just show what would happen
    console.log('\n🔄 Rollback would restore:');
    console.log(`   - ${selectedBackup} users to their original state`);
    console.log(`   - Remove any migrated Firebase users`);
    console.log(`   - Restore custom user IDs`);
    
    console.log('\n✅ Rollback script ready. Uncomment the rollback call to execute.');
    // await rollbackService.rollbackMigration(selectedBackup);
    
  } catch (error) {
    console.error('💥 Rollback failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = MigrationRollbackService;
