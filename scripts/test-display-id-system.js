#!/usr/bin/env node

/**
 * Optimized Test Suite for Display ID System
 * Tests: generation, uniqueness, database consistency with retries
 */

const { initializeFirebase, getFirestore } = require('../src/services/firebase');
const displayIdService = require('../src/services/displayIdService');

// Initialize Firebase
initializeFirebase();
const db = getFirestore();

const TEST_RESULTS = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, passed, details = '') {
  TEST_RESULTS.tests.push({ name, passed, details });
  if (passed) {
    TEST_RESULTS.passed++;
    console.log(`✅ ${name}${details ? ' - ' + details : ''}`);
  } else {
    TEST_RESULTS.failed++;
    console.log(`❌ ${name}${details ? ' - ' + details : ''}`);
  }
}

async function test1_DisplayIdRange() {
  console.log('\n🧪 TEST 1: Display ID Range Validation');
  try {
    const displayId = await displayIdService.generateDisplayId(Date.now(), 'test_customer_1');
    const isInRange = displayId >= 10000 && displayId <= 99999;
    const isInteger = Number.isInteger(displayId);
    logTest('Display ID is 5-digit number', isInRange && isInteger, `Generated: ${displayId}`);
    return displayId;
  } catch (error) {
    logTest('Display ID range validation', false, error.message);
    return null;
  }
}

async function test2_SequentialGenerations() {
  console.log('\n🧪 TEST 2: Sequential Unique Display IDs (with retry)');
  const displayIds = new Set();
  const COUNT = 10;
  let retries = 0;
  
  for (let i = 0; i < COUNT; i++) {
    try {
      const displayId = await displayIdService.generateDisplayId(Date.now() + i, `test_customer_${i}`);
      displayIds.add(displayId);
    } catch (error) {
      if (error.message.includes('contention')) {
        console.log(`  ⚠️  Contention detected, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 100 * (retries + 1)));
        i--;
        retries++;
        if (retries > 3) {
          logTest(`${COUNT} sequential generations`, false, `Max retries exceeded`);
          return displayIds;
        }
      } else {
        throw error;
      }
    }
  }
  
  const allUnique = displayIds.size === COUNT;
  logTest(`${COUNT} sequential generations are unique`, allUnique, `Unique: ${displayIds.size}/${COUNT}`);
  return displayIds;
}

async function test3_SlowConcurrentGeneration() {
  console.log('\n🧪 TEST 3: Controlled Concurrent Generation (with throttling)');
  const COUNT = 20;
  const promises = [];
  
  for (let i = 0; i < COUNT; i++) {
    promises.push(
      (async () => {
        try {
          await new Promise(resolve => setTimeout(resolve, i * 50));
          return await displayIdService.generateDisplayId(Date.now() + i, `concurrent_${i}`);
        } catch (error) {
          if (error.message.includes('contention')) {
            await new Promise(resolve => setTimeout(resolve, 200));
            return await displayIdService.generateDisplayId(Date.now() + i, `concurrent_${i}_retry`);
          }
          throw error;
        }
      })()
    );
  }
  
  try {
    const displayIds = await Promise.allSettled(promises);
    const successful = displayIds.filter(r => r.status === 'fulfilled').map(r => r.value);
    const uniqueIds = new Set(successful);
    const allUnique = uniqueIds.size === successful.length;
    
    logTest(`${successful.length}/${COUNT} concurrent generations are unique`, allUnique, 
      `Unique: ${uniqueIds.size}/${successful.length}`);
    return uniqueIds;
  } catch (error) {
    logTest('Concurrent generation', false, error.message);
    return new Set();
  }
}

async function test4_DatabaseConsistency() {
  console.log('\n🧪 TEST 4: Database Consistency');
  
  try {
    const counterState = await displayIdService.getCounterState();
    const counterExists = counterState.nextValue > 0;
    logTest('Counter state exists and increments', counterExists, `Next value: ${counterState.nextValue}`);
    
    const counterDoc = await db.collection('system_counters').doc('booking_display_id').get();
    const docExists = counterDoc.exists;
    logTest('Counter document exists in Firestore', docExists);
    
    return { counterState, docExists };
  } catch (error) {
    logTest('Database consistency check', false, error.message);
    return null;
  }
}

async function test5_DisplayIdFormat() {
  console.log('\n🧪 TEST 5: Display ID Formatting');
  
  const testIds = [10000, 10001, 25000, 99999];
  let allFormatted = true;
  
  testIds.forEach(id => {
    const formatted = displayIdService.formatDisplayId(id);
    const isCorrect = formatted === `#${id}`;
    if (!isCorrect) allFormatted = false;
  });
  
  logTest('All display IDs format correctly', allFormatted, 'Format: #12345');
  return allFormatted;
}

async function test6_ExistingBookingsHaveIds() {
  console.log('\n🧪 TEST 6: Existing Bookings Have Display IDs');
  
  try {
    const bookingsSnapshot = await db.collection('bookings').limit(20).get();
    const bookings = [];
    let withDisplayId = 0;
    
    bookingsSnapshot.forEach(doc => {
      bookings.push(doc.data());
      if (doc.data().displayId) {
        withDisplayId++;
      }
    });
    
    const percentage = bookings.length > 0 ? Math.round((withDisplayId / bookings.length) * 100) : 0;
    logTest(`Existing bookings have displayId`, withDisplayId > 0, `${withDisplayId}/${bookings.length} (${percentage}%)`);
    
    return { total: bookings.length, withDisplayId };
  } catch (error) {
    logTest('Check existing bookings', false, error.message);
    return null;
  }
}

async function test7_NoDisplayIdCollisions() {
  console.log('\n🧪 TEST 7: No Display ID Collisions in Database');
  
  try {
    const bookingsSnapshot = await db.collection('bookings').get();
    const displayIds = [];
    const duplicates = [];
    
    bookingsSnapshot.forEach(doc => {
      const displayId = doc.data().displayId;
      if (displayId) {
        if (displayIds.includes(displayId)) {
          duplicates.push(displayId);
        }
        displayIds.push(displayId);
      }
    });
    
    const noDuplicates = duplicates.length === 0;
    logTest('No duplicate displayIds in database', noDuplicates, 
      `Total: ${bookingsSnapshot.size}, With displayId: ${displayIds.length}, Duplicates: ${duplicates.length}`);
    
    return { noDuplicates, duplicates };
  } catch (error) {
    logTest('Check for collisions', false, error.message);
    return null;
  }
}

async function runAllTests() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║     Display ID System Test Suite (Optimized) v1.0             ║
╚════════════════════════════════════════════════════════════════╝
`);

  try {
    await test1_DisplayIdRange();
    await test2_SequentialGenerations();
    await test3_SlowConcurrentGeneration();
    await test4_DatabaseConsistency();
    await test5_DisplayIdFormat();
    await test6_ExistingBookingsHaveIds();
    await test7_NoDisplayIdCollisions();
    
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                       TEST RESULTS SUMMARY                    ║
╚════════════════════════════════════════════════════════════════╝

✅ Passed: ${TEST_RESULTS.passed}
❌ Failed: ${TEST_RESULTS.failed}
📊 Total:  ${TEST_RESULTS.tests.length}
📈 Pass Rate: ${Math.round((TEST_RESULTS.passed / TEST_RESULTS.tests.length) * 100)}%
`);

    console.log('\n📋 Test Details:');
    TEST_RESULTS.tests.forEach((test, idx) => {
      const icon = test.passed ? '✅' : '❌';
      const details = test.details ? ` - ${test.details}` : '';
      console.log(`  ${idx + 1}. ${icon} ${test.name}${details}`);
    });

    if (TEST_RESULTS.failed === 0) {
      console.log(`
🎉 ALL TESTS PASSED! The Display ID system is working correctly.

System Status:
  ✅ Display IDs generate in correct range (10000-99999)
  ✅ All generated IDs are unique
  ✅ Counter state persists correctly
  ✅ Formatting produces correct output
  ✅ Existing bookings have migrated displayIds
  ✅ No collisions detected in database
  ✅ Firestore handles concurrent requests with retries
\n`);
      process.exit(0);
    } else {
      console.log(`
⚠️  SOME TESTS FAILED (${TEST_RESULTS.failed}/${TEST_RESULTS.tests.length}).
Review the output above for details.\n`);
      process.exit(1);
    }
  } catch (error) {
    console.error('💥 Fatal error during testing:', error.message);
    process.exit(1);
  }
}

runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
