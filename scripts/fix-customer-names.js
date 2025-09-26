const { getFirestore } = require('firebase-admin/firestore');

/**
 * Script to fix customer names in the database
 * This will update customers who have generic names like "User_1698" to have proper names
 */

async function fixCustomerNames() {
  try {
    console.log('🔧 Starting customer name fix...');
    
    const db = getFirestore();
    
    // Get all customers
    const customersSnapshot = await db.collection('users')
      .where('userType', '==', 'customer')
      .get();
    
    console.log(`📊 Found ${customersSnapshot.size} customers`);
    
    const batch = db.batch();
    let updateCount = 0;
    
    customersSnapshot.forEach(doc => {
      const data = doc.data();
      const currentName = data.name;
      
      // Check if the name is a generic "User_XXXX" format
      if (currentName && currentName.match(/^User_\d{4}$/)) {
        // Extract the last 4 digits from phone number
        const phone = data.phone || '';
        const phoneSuffix = phone.slice(-4);
        
        // Create a more user-friendly name
        const newName = `Customer_${phoneSuffix}`;
        
        console.log(`📝 Updating customer ${doc.id}: "${currentName}" -> "${newName}"`);
        
        batch.update(doc.ref, {
          name: newName,
          updatedAt: new Date()
        });
        
        updateCount++;
      }
    });
    
    if (updateCount > 0) {
      await batch.commit();
      console.log(`✅ Updated ${updateCount} customer names`);
    } else {
      console.log('ℹ️ No customer names needed updating');
    }
    
    console.log('🎉 Customer name fix completed!');
    
  } catch (error) {
    console.error('❌ Error fixing customer names:', error);
  }
}

// Run the script
fixCustomerNames().then(() => {
  console.log('Script completed');
  process.exit(0);
}).catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
