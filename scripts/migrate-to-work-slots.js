#!/usr/bin/env node

/**
 * Migration Script: Old Availability Slots to New Work Slots System
 * 
 * This script migrates existing driver availability data from the old
 * nested structure in users collection to the new workSlots collection.
 * 
 * Usage:
 *   node scripts/migrate-to-work-slots.js [--dry-run]
 * 
 * Options:
 *   --dry-run    Show what would be migrated without making changes
 */

const { getFirestore, Timestamp } = require('../src/services/firebase');
const workSlotsService = require('../src/services/workSlotsService');

async function migrateToWorkSlots() {
  try {
    const db = getFirestore();
    const isDryRun = process.argv.includes('--dry-run');
    
    console.log('🚀 Starting migration to new work slots system...');
    if (isDryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made');
    }
    
    // Get all drivers with old availability data
    const driversSnapshot = await db.collection('users')
      .where('userType', '==', 'driver')
      .get();
    
    console.log(`📊 Found ${driversSnapshot.size} drivers to process`);
    
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const driverDoc of driversSnapshot.docs) {
      try {
        const driverData = driverDoc.data();
        const driverId = driverDoc.id;
        
        // Check if driver has old availability data
        const oldAvailability = driverData.driver?.availability?.availabilitySlots;
        
        if (!oldAvailability || !Array.isArray(oldAvailability)) {
          console.log(`  ⏭️  Driver ${driverId}: No old availability data, skipping`);
          skippedCount++;
          continue;
        }
        
        console.log(`  🔄 Processing driver ${driverId}...`);
        
        // Generate new slots for today
        if (!isDryRun) {
          const result = await workSlotsService.generateDailySlots(driverId);
          
          if (result.success) {
            console.log(`    ✅ Generated ${result.data.length} new slots`);
            migratedCount++;
          } else {
            console.log(`    ❌ Failed to generate slots: ${result.error.message}`);
            errorCount++;
          }
        } else {
          console.log(`    🔍 Would generate 6 new slots for today`);
          migratedCount++;
        }
        
        // Log old availability data for reference
        console.log(`    📋 Old availability slots: ${oldAvailability.length} entries`);
        oldAvailability.forEach(daySlot => {
          console.log(`      - ${daySlot.day}: ${daySlot.slots.length} slots`);
        });
        
      } catch (error) {
        console.error(`  💥 Error processing driver ${driverDoc.id}:`, error.message);
        errorCount++;
      }
    }
    
    console.log('\n📈 Migration Summary:');
    console.log(`  ✅ Migrated: ${migratedCount}`);
    console.log(`  ⏭️  Skipped: ${skippedCount}`);
    console.log(`  ❌ Errors: ${errorCount}`);
    console.log(`  📊 Total drivers: ${driversSnapshot.size}`);
    
    if (isDryRun) {
      console.log('\n🔍 This was a dry run. Run without --dry-run to apply changes.');
    } else {
      console.log('\n✅ Migration completed successfully!');
      console.log('\n📝 Next steps:');
      console.log('  1. Update frontend to use new work slots API');
      console.log('  2. Test slot generation and real-time updates');
      console.log('  3. Remove old availability data after verification');
    }
    
  } catch (error) {
    console.error('💥 Migration failed:', error.message);
    process.exit(1);
  }
}

// Run the migration
if (require.main === module) {
  migrateToWorkSlots();
}

module.exports = { migrateToWorkSlots };
