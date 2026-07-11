/**
 * Migration Script: Add Display IDs to Existing Bookings
 * 
 * Purpose: Backfill displayId field for all existing bookings
 * Ensures consistency across new and old bookings
 * 
 * Usage: Run once after deploying displayIdService
 * Run from: node backend/scripts/migrate-display-ids.js
 */

const { initializeFirebase, getFirestore } = require('../src/services/firebase');
const displayIdService = require('../src/services/displayIdService');

/**
 * Migrate existing bookings to add displayId
 */
async function migrateDisplayIds() {
  // Initialize Firebase first
  initializeFirebase();
  const db = getFirestore();
  
  console.log('\n🔄 Starting Display ID Migration...\n');
  
  try {
    // Get all bookings
    const bookingsSnapshot = await db.collection('bookings').get();
    const allBookings = [];
    
    bookingsSnapshot.forEach(doc => {
      allBookings.push({
        id: doc.id,
        data: doc.data()
      });
    });
    
    console.log(`📊 Found ${allBookings.length} total bookings`);
    
    // Filter bookings without displayId
    const bookingsNeedingMigration = allBookings.filter(b => !b.data.displayId);
    console.log(`📝 ${bookingsNeedingMigration.length} bookings need displayId migration`);
    
    if (bookingsNeedingMigration.length === 0) {
      console.log('✅ All bookings already have displayIds - migration not needed\n');
      return {
        success: true,
        message: 'All bookings already have displayIds',
        total: allBookings.length,
        migrated: 0
      };
    }
    
    // Process in batches to avoid rate limiting
    const batchSize = 50;
    const batches = Math.ceil(bookingsNeedingMigration.length / batchSize);
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    console.log(`\n🚀 Processing ${bookingsNeedingMigration.length} bookings in ${batches} batches...\n`);
    
    for (let b = 0; b < batches; b++) {
      const batchStart = b * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, bookingsNeedingMigration.length);
      const batchBookings = bookingsNeedingMigration.slice(batchStart, batchEnd);
      
      console.log(`📦 Batch ${b + 1}/${batches} (${batchBookings.length} bookings)...`);
      
      const batchPromises = batchBookings.map(async (booking) => {
        try {
          const { id, data } = booking;
          
          // Skip if no customerId or createdAt (invalid booking)
          if (!data.customerId || !data.createdAt) {
            console.warn(`⚠️ Skipping booking ${id} - missing customerId or createdAt`);
            return null;
          }
          
          // Generate displayId using the same algorithm as new bookings
          const bookingTimestamp = data.createdAt.toMillis?.() || 
                                  (data.createdAt instanceof Date ? data.createdAt.getTime() : data.createdAt);
          const displayId = displayIdService.regenerateDisplayId(
            bookingTimestamp,
            data.customerId,
            b * batchSize + batchBookings.indexOf(booking) + 1  // Counter value
          );
          
          // Update booking with displayId
          await db.collection('bookings').doc(id).update({
            displayId: displayId,
            migratedAt: new Date(),
            migrationVersion: '1.0'
          });
          
          console.log(`  ✅ Booking ${id.substring(0, 8)}... → displayId #${displayId.toString().padStart(5, '0')}`);
          return displayId;
          
        } catch (error) {
          errorCount++;
          errors.push({
            bookingId: booking.id,
            error: error.message
          });
          console.error(`  ❌ Error migrating booking ${booking.id}: ${error.message}`);
          return null;
        }
      });
      
      const results = await Promise.all(batchPromises);
      successCount += results.filter(r => r !== null).length;
      
      // Add delay between batches to avoid rate limiting
      if (b < batches - 1) {
        console.log('⏳ Waiting 1 second before next batch...\n');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`\n📊 Migration Complete!`);
    console.log(`✅ Successfully migrated: ${successCount} bookings`);
    console.log(`❌ Errors encountered: ${errorCount} bookings`);
    
    if (errors.length > 0 && errors.length <= 10) {
      console.log('\nErrors:');
      errors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err.bookingId}: ${err.error}`);
      });
    }
    
    return {
      success: errorCount === 0,
      message: `Migration complete: ${successCount} successful, ${errorCount} errors`,
      total: bookingsNeedingMigration.length,
      migrated: successCount,
      errors: errorCount,
      errorDetails: errors
    };
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    return {
      success: false,
      message: error.message,
      error: error
    };
  }
}

/**
 * Verify migration - check that all bookings have displayId
 */
async function verifyMigration() {
  const db = getFirestore();
  
  console.log('\n🔍 Verifying migration...\n');
  
  try {
    const bookingsSnapshot = await db.collection('bookings').get();
    const bookingsWithoutDisplayId = [];
    let totalBookings = 0;
    
    bookingsSnapshot.forEach(doc => {
      totalBookings++;
      if (!doc.data().displayId) {
        bookingsWithoutDisplayId.push(doc.id);
      }
    });
    
    if (bookingsWithoutDisplayId.length === 0) {
      console.log(`✅ Verification passed! All ${totalBookings} bookings have displayIds\n`);
      return true;
    } else {
      console.log(`❌ Verification failed! ${bookingsWithoutDisplayId.length}/${totalBookings} bookings still missing displayId`);
      console.log('Affected bookings:', bookingsWithoutDisplayId.slice(0, 10));
      return false;
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    return false;
  }
}

/**
 * Check for duplicate displayIds
 */
async function checkForDuplicates() {
  const db = getFirestore();
  
  console.log('\n🔍 Checking for duplicate displayIds...\n');
  
  try {
    const bookingsSnapshot = await db.collection('bookings').get();
    const displayIds = new Map();
    const duplicates = [];
    
    bookingsSnapshot.forEach(doc => {
      const displayId = doc.data().displayId;
      if (displayId) {
        if (displayIds.has(displayId)) {
          duplicates.push({
            displayId,
            bookingIds: [displayIds.get(displayId), doc.id]
          });
        } else {
          displayIds.set(displayId, doc.id);
        }
      }
    });
    
    if (duplicates.length === 0) {
      console.log(`✅ No duplicate displayIds found! All IDs are unique\n`);
      return true;
    } else {
      console.log(`❌ Found ${duplicates.length} duplicate displayIds:`);
      duplicates.forEach(dup => {
        console.log(`  displayId #${dup.displayId}: ${dup.bookingIds.join(', ')}`);
      });
      return false;
    }
    
  } catch (error) {
    console.error('❌ Duplicate check failed:', error);
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Display ID Migration Script v1.0   ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  // Check counter state before migration
  try {
    const counterState = await displayIdService.getCounterState();
    console.log('📊 Current Counter State:', counterState);
  } catch {
    console.warn('⚠️ Counter not initialized yet (will be created on first booking)');
  }
  
  // Run migration
  const migrationResult = await migrateDisplayIds();
  
  // Verify
  if (migrationResult.success) {
    const verifyPassed = await verifyMigration();
    const duplicateCheckPassed = await checkForDuplicates();
    
    if (verifyPassed && duplicateCheckPassed) {
      console.log('✅ Migration completed successfully!\n');
      process.exit(0);
    } else {
      console.log('⚠️ Migration had some issues\n');
      process.exit(1);
    }
  } else {
    console.log('❌ Migration failed\n');
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { migrateDisplayIds, verifyMigration, checkForDuplicates };
