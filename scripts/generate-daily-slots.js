#!/usr/bin/env node

/**
 * Daily Work Slots Generation Script
 * 
 * This script generates work slots for all active drivers.
 * It should be run daily via cron job or Cloud Function.
 * 
 * Usage:
 *   node scripts/generate-daily-slots.js [date]
 * 
 * Examples:
 *   node scripts/generate-daily-slots.js                    # Generate for today
 *   node scripts/generate-daily-slots.js 2024-01-15        # Generate for specific date
 */

const workSlotsService = require('../src/services/workSlotsService');

async function generateDailySlots() {
  try {
    console.log('🚀 Starting daily work slots generation...');
    
    // Parse date argument
    const dateArg = process.argv[2];
    const targetDate = dateArg ? new Date(dateArg) : new Date();
    
    console.log(`📅 Generating slots for: ${targetDate.toISOString().split('T')[0]}`);
    
    // Generate slots for all active drivers
    const result = await workSlotsService.generateSlotsForAllDrivers(targetDate);
    
    if (result.success) {
      console.log('✅ Daily slots generated successfully!');
      console.log(`📊 Generated slots for ${result.data.length} drivers`);
      
      // Log summary
      let successCount = 0;
      let errorCount = 0;
      
      result.data.forEach(driverResult => {
        if (driverResult.success) {
          successCount++;
          console.log(`  ✅ Driver ${driverResult.driverId}: ${driverResult.slots} slots`);
        } else {
          errorCount++;
          console.log(`  ❌ Driver ${driverResult.driverId}: ${driverResult.error.message}`);
        }
      });
      
      console.log(`\n📈 Summary:`);
      console.log(`  ✅ Successful: ${successCount}`);
      console.log(`  ❌ Failed: ${errorCount}`);
      console.log(`  📅 Date: ${targetDate.toISOString().split('T')[0]}`);
      
    } else {
      console.error('❌ Failed to generate daily slots:', result.error.message);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('💥 Unexpected error:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  generateDailySlots();
}

module.exports = { generateDailySlots };
