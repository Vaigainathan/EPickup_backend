const { getFirestore } = require('../src/services/firebase');

/**
 * Audit script to check driver wallet data structure in Firestore
 * This will help identify data inconsistencies
 */

async function auditDriverWallet() {
  const db = getFirestore();
  const driverId = 'user_1758307092511_gmcez7nvo'; // The driver from the logs
  
  try {
    console.log('🔍 Auditing driver wallet data structure...');
    console.log(`📋 Driver ID: ${driverId}`);
    
    // Get user document
    const userDoc = await db.collection('users').doc(driverId).get();
    
    if (!userDoc.exists) {
      console.log('❌ Driver not found in Firestore');
      return;
    }
    
    const userData = userDoc.data();
    console.log('\n📊 User Document Structure:');
    console.log('Keys:', Object.keys(userData));
    
    // Check driver data
    const driverData = userData.driver || {};
    console.log('\n🚗 Driver Data Structure:');
    console.log('Keys:', Object.keys(driverData));
    console.log('Verification Status:', driverData.verificationStatus);
    console.log('Is Verified:', driverData.isVerified);
    console.log('Welcome Bonus Given:', driverData.welcomeBonusGiven);
    console.log('Welcome Bonus Amount:', driverData.welcomeBonusAmount);
    
    // Check wallet data
    const walletData = driverData.wallet || {};
    console.log('\n💰 Wallet Data Structure:');
    console.log('Keys:', Object.keys(walletData));
    console.log('Balance:', walletData.balance);
    console.log('Currency:', walletData.currency);
    console.log('Last Updated:', walletData.lastUpdated);
    
    // Check transactions
    console.log('\n📝 Checking Transactions...');
    const transactionsQuery = await db.collection('driverWalletTransactions')
      .where('driverId', '==', driverId)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    
    console.log(`Found ${transactionsQuery.size} transactions`);
    
    transactionsQuery.forEach((doc, index) => {
      const transaction = doc.data();
      console.log(`Transaction ${index + 1}:`, {
        id: doc.id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        createdAt: transaction.createdAt?.toDate?.() || transaction.createdAt
      });
    });
    
    // Summary
    console.log('\n📋 Audit Summary:');
    console.log(`✅ Driver exists: ${userDoc.exists}`);
    console.log(`✅ Driver data exists: ${!!driverData}`);
    console.log(`✅ Wallet data exists: ${!!walletData}`);
    console.log(`✅ Verification status: ${driverData.verificationStatus}`);
    console.log(`✅ Is verified: ${driverData.isVerified}`);
    console.log(`✅ Welcome bonus given: ${driverData.welcomeBonusGiven}`);
    console.log(`✅ Wallet balance: ₹${walletData.balance || 0}`);
    console.log(`✅ Transaction count: ${transactionsQuery.size}`);
    
    // Recommendations
    console.log('\n💡 Recommendations:');
    if (!driverData.welcomeBonusGiven && driverData.verificationStatus === 'verified') {
      console.log('⚠️ Driver is verified but welcome bonus not given - needs processing');
    }
    if (walletData.balance === 0 && driverData.welcomeBonusGiven) {
      console.log('⚠️ Welcome bonus marked as given but balance is 0 - data inconsistency');
    }
    if (transactionsQuery.size === 0 && driverData.welcomeBonusGiven) {
      console.log('⚠️ Welcome bonus marked as given but no transaction record found');
    }
    
  } catch (error) {
    console.error('❌ Audit failed:', error);
  }
}

// Run audit if called directly
if (require.main === module) {
  auditDriverWallet()
    .then(() => {
      console.log('✅ Audit completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Audit failed:', error);
      process.exit(1);
    });
}

module.exports = { auditDriverWallet };
