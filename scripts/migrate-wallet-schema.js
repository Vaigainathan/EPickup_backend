const { getFirestore } = require('../src/services/firebase');

/**
 * Migration script to fix wallet schema and ensure welcome bonus is properly set
 * 
 * This script will:
 * 1. Check all drivers in the users collection
 * 2. Ensure they have proper wallet structure
 * 3. Add welcome bonus if they're verified but don't have it
 * 4. Create missing transaction records
 */

async function migrateWalletSchema() {
  const db = getFirestore();
  console.log('🚀 Starting wallet schema migration...');
  
  try {
    // Get all users
    const usersSnapshot = await db.collection('users').get();
    console.log(`📊 Found ${usersSnapshot.size} users to check`);
    
    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    
    for (const userDoc of usersSnapshot.docs) {
      try {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        // Skip if not a driver
        if (!userData.driver) {
          console.log(`⏭️ Skipping user ${userId} - not a driver`);
          continue;
        }
        
        processedCount++;
        console.log(`🔍 Processing driver: ${userId}`);
        
        const driverData = userData.driver;
        const isVerified = driverData.verificationStatus === 'verified' || driverData.verificationStatus === 'approved';
        const welcomeBonusGiven = driverData.welcomeBonusGiven || false;
        const currentBalance = driverData.wallet?.balance || 0;
        
        console.log(`📋 Driver status: verified=${isVerified}, welcomeBonusGiven=${welcomeBonusGiven}, balance=${currentBalance}`);
        
        let needsUpdate = false;
        const updates = {};
        
        // Check if wallet structure is missing or incomplete
        if (!driverData.wallet) {
          console.log(`💰 Creating wallet structure for ${userId}`);
          updates['driver.wallet'] = {
            balance: isVerified && !welcomeBonusGiven ? 500 : currentBalance,
            currency: 'INR',
            lastUpdated: new Date(),
            transactions: []
          };
          needsUpdate = true;
        } else {
          // Ensure wallet has required fields
          const wallet = driverData.wallet;
          if (!wallet.currency) {
            updates['driver.wallet.currency'] = 'INR';
            needsUpdate = true;
          }
          if (!wallet.lastUpdated) {
            updates['driver.wallet.lastUpdated'] = new Date();
            needsUpdate = true;
          }
        }
        
        // Check if welcome bonus needs to be given
        if (isVerified && !welcomeBonusGiven) {
          console.log(`🎁 Adding welcome bonus for verified driver ${userId}`);
          
          const newBalance = currentBalance + 500;
          updates['driver.wallet.balance'] = newBalance;
          updates['driver.welcomeBonusGiven'] = true;
          updates['driver.welcomeBonusAmount'] = 500;
          updates['driver.welcomeBonusGivenAt'] = new Date();
          
          // Create welcome bonus transaction
          const transactionRef = db.collection('driverWalletTransactions').doc();
          await transactionRef.set({
            id: transactionRef.id,
            driverId: userId,
            type: 'credit',
            amount: 500,
            previousBalance: currentBalance,
            newBalance: newBalance,
            paymentMethod: 'welcome_bonus',
            status: 'completed',
            metadata: {
              source: 'welcome_bonus',
              description: 'Welcome bonus for completing verification',
              migration: true
            },
            createdAt: new Date(),
            updatedAt: new Date()
          });
          
          console.log(`✅ Created welcome bonus transaction for ${userId}`);
          needsUpdate = true;
        }
        
        // Apply updates if needed
        if (needsUpdate) {
          await db.collection('users').doc(userId).update(updates);
          updatedCount++;
          console.log(`✅ Updated driver ${userId}`);
        } else {
          console.log(`⏭️ No updates needed for ${userId}`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing user ${userDoc.id}:`, error);
        errorCount++;
      }
    }
    
    console.log('\n📊 Migration Summary:');
    console.log(`✅ Processed: ${processedCount} drivers`);
    console.log(`🔄 Updated: ${updatedCount} drivers`);
    console.log(`❌ Errors: ${errorCount} drivers`);
    console.log('🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateWalletSchema()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateWalletSchema };
