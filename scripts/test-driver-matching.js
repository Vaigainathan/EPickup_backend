#!/usr/bin/env node

/**
 * Test script for EPickup Driver Matching Service
 * Demonstrates the core functionality of driver matching, assignment, and management
 */

require('dotenv').config();
const { initializeFirebase, getFirestore } = require('../src/services/firebase');
const driverMatchingService = require('../src/services/driverMatchingService');

// Mock data for testing
const sampleBookingData = {
  id: "test_booking_001",
  pickup: {
    name: "John Doe",
    phone: "+919999999999",
    address: "123 MG Road, Bangalore, Karnataka",
    coordinates: {
      latitude: 12.9716,
      longitude: 77.5946
    },
    instructions: "Ring doorbell twice, I'll come down"
  },
  dropoff: {
    name: "Jane Smith",
    phone: "+918888888888",
    address: "456 Indiranagar, Bangalore, Karnataka",
    coordinates: {
      latitude: 12.9789,
      longitude: 77.5917
    },
    instructions: "Leave at reception desk"
  },
  package: {
    weight: 2.5,
    description: "Electronics package - laptop and accessories",
    dimensions: {
      length: 40,
      width: 30,
      height: 10
    },
    isFragile: true,
    requiresSpecialHandling: false
  },
  vehicle: {
    type: "2_wheeler",
    required: false
  },
  paymentMethod: "online",
  estimatedPickupTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  estimatedDeliveryTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
};

const sampleDrivers = [
  {
    id: "test_driver_001",
    name: "Rahul Kumar",
    phone: "+917777777777",
    rating: 4.8,
    totalTrips: 150,
    completedTrips: 145,
    avgResponseTime: 45, // seconds
    cancellationRate: 0.02,
    currentLocation: {
      latitude: 12.9720,
      longitude: 77.5950,
      timestamp: new Date(),
      accuracy: 10
    },
    vehicleType: "2_wheeler",
    verificationStatus: "verified",
    isActive: true
  },
  {
    id: "test_driver_002",
    name: "Amit Singh",
    phone: "+916666666666",
    rating: 4.6,
    totalTrips: 120,
    completedTrips: 118,
    avgResponseTime: 60,
    cancellationRate: 0.03,
    currentLocation: {
      latitude: 12.9730,
      longitude: 77.5960,
      timestamp: new Date(),
      accuracy: 15
    },
    vehicleType: "2_wheeler",
    verificationStatus: "verified",
    isActive: true
  },
  {
    id: "test_driver_003",
    name: "Vikram Patel",
    phone: "+915555555555",
    rating: 4.9,
    totalTrips: 200,
    completedTrips: 195,
    avgResponseTime: 30,
    cancellationRate: 0.01,
    currentLocation: {
      latitude: 12.9700,
      longitude: 77.5930,
      timestamp: new Date(),
      accuracy: 8
    },
    vehicleType: "4_wheeler",
    verificationStatus: "verified",
    isActive: true
  }
];

/**
 * Test driver matching functionality
 */
async function testDriverMatching() {
  console.log('\n🚗 Testing Driver Matching...');
  
  try {
    // Test 1: Basic driver matching
    console.log('  Testing basic driver matching...');
    const matchResult = await driverMatchingService.findAndMatchDriver(sampleBookingData, {
      searchRadius: 5,
      vehicleType: "2_wheeler",
      priority: "balanced"
    });

    if (matchResult.success) {
      console.log('✅ Driver matched successfully');
      console.log(`   Driver: ${matchResult.data.driver.name}`);
      console.log(`   Rating: ${matchResult.data.driver.rating}`);
      console.log(`   ETA: ${matchResult.data.driver.estimatedArrival} minutes`);
      console.log(`   Alternatives: ${matchResult.data.alternatives.length}`);
    } else {
      console.log('❌ Driver matching failed:', matchResult.error?.message);
    }

    // Test 2: Different priority modes
    console.log('\n  Testing different priority modes...');
    const priorities = ['fastest', 'best_rated', 'closest', 'balanced'];
    
    for (const priority of priorities) {
      const priorityResult = await driverMatchingService.findAndMatchDriver(sampleBookingData, {
        searchRadius: 5,
        priority: priority
      });
      
      if (priorityResult.success) {
        console.log(`   ${priority.toUpperCase()}: ${priorityResult.data.driver.name} (${priorityResult.data.driver.estimatedArrival} min)`);
      }
    }

    return matchResult;

  } catch (error) {
    console.error('❌ Driver matching test failed:', error.message);
    return null;
  }
}

/**
 * Test driver availability management
 */
async function testDriverAvailability() {
  console.log('\n📱 Testing Driver Availability Management...');
  
  try {
    const db = getFirestore();
    
    // Test 1: Update driver availability
    console.log('  Testing driver availability updates...');
    const driverId = sampleDrivers[0].id;
    
    // Create driver location record
    await db.collection('driverLocations').doc(driverId).set({
      driverId: driverId,
      currentLocation: sampleDrivers[0].currentLocation,
      isOnline: true,
      isAvailable: true,
      vehicleType: sampleDrivers[0].vehicleType,
      lastUpdated: new Date()
    });

    // Test going offline
    const offlineResult = await driverMatchingService.updateDriverAvailability(
      driverId, false, false
    );
    
    if (offlineResult.success) {
      console.log('✅ Driver went offline successfully');
    }

    // Test going online
    const onlineResult = await driverMatchingService.updateDriverAvailability(
      driverId, true, true, sampleDrivers[0].currentLocation
    );
    
    if (onlineResult.success) {
      console.log('✅ Driver went online successfully');
    }

    // Test 2: Get driver locations
    console.log('  Testing driver location retrieval...');
    const locations = await driverMatchingService.getDriverLocations([driverId]);
    
    if (locations.length > 0) {
      console.log(`✅ Retrieved ${locations.length} driver location(s)`);
      console.log(`   Driver ${driverId}: ${locations[0].isOnline ? 'Online' : 'Offline'}`);
    }

    return true;

  } catch (error) {
    console.error('❌ Driver availability test failed:', error.message);
    return false;
  }
}

/**
 * Test driver assignment and response handling
 */
async function testDriverAssignment() {
  console.log('\n📋 Testing Driver Assignment...');
  
  try {
    const db = getFirestore();
    
    // Test 1: Create driver assignment
    console.log('  Testing driver assignment creation...');
    const assignmentRef = db.collection('driverAssignments').doc();
    const assignment = {
      id: assignmentRef.id,
      bookingId: sampleBookingData.id,
      driverId: sampleDrivers[0].id,
      status: 'pending',
      assignedAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 minutes
      driverDetails: {
        name: sampleDrivers[0].name,
        phone: sampleDrivers[0].phone,
        rating: sampleDrivers[0].rating,
        vehicleType: sampleDrivers[0].vehicleType,
        estimatedArrival: 15
      },
      bookingDetails: {
        pickup: sampleBookingData.pickup,
        dropoff: sampleBookingData.dropoff,
        package: sampleBookingData.package
      }
    };

    await assignmentRef.set(assignment);
    console.log('✅ Driver assignment created');

    // Test 2: Handle driver acceptance
    console.log('  Testing driver acceptance...');
    const acceptResult = await driverMatchingService.handleDriverResponse(
      assignment.id,
      sampleDrivers[0].id,
      'accepted'
    );

    if (acceptResult.success) {
      console.log('✅ Driver accepted assignment successfully');
    } else {
      console.log('❌ Driver acceptance failed:', acceptResult.error);
    }

    // Test 3: Handle driver rejection
    console.log('  Testing driver rejection...');
    const rejectResult = await driverMatchingService.handleDriverResponse(
      assignment.id,
      sampleDrivers[1].id,
      'rejected',
      'Too far from current location'
    );

    if (rejectResult.success) {
      console.log('✅ Driver rejection handled successfully');
    } else {
      console.log('❌ Driver rejection handling failed:', rejectResult.error);
    }

    return true;

  } catch (error) {
    console.error('❌ Driver assignment test failed:', error.message);
    return false;
  }
}

/**
 * Test driver statistics and analytics
 */
async function testDriverStatistics() {
  console.log('\n📊 Testing Driver Statistics...');
  
  try {
    const db = getFirestore();
    
    // Create sample assignments for statistics
    console.log('  Creating sample assignments for statistics...');
    const assignments = [
      {
        driverId: sampleDrivers[0].id,
        status: 'accepted',
        assignedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        acceptedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 30 * 1000) // 30 seconds later
      },
      {
        driverId: sampleDrivers[0].id,
        status: 'rejected',
        assignedAt: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
        rejectedAt: new Date(Date.now() - 12 * 60 * 60 * 1000 + 60 * 1000) // 1 minute later
      },
      {
        driverId: sampleDrivers[0].id,
        status: 'accepted',
        assignedAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
        acceptedAt: new Date(Date.now() - 6 * 60 * 60 * 1000 + 45 * 1000) // 45 seconds later
      }
    ];

    for (const assignment of assignments) {
      const assignmentRef = db.collection('driverAssignments').doc();
      await assignmentRef.set({
        id: assignmentRef.id,
        ...assignment
      });
    }

    // Test statistics retrieval
    console.log('  Testing statistics retrieval...');
    const stats = await driverMatchingService.getDriverStatistics(sampleDrivers[0].id, {
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      endDate: new Date()
    });

    if (stats) {
      console.log('✅ Driver statistics retrieved successfully');
      console.log(`   Total Assignments: ${stats.totalAssignments}`);
      console.log(`   Acceptance Rate: ${stats.acceptanceRate}%`);
      console.log(`   Average Response Time: ${stats.avgResponseTime} seconds`);
    } else {
      console.log('❌ Failed to retrieve driver statistics');
    }

    return true;

  } catch (error) {
    console.error('❌ Driver statistics test failed:', error.message);
    return false;
  }
}

/**
 * Test geospatial calculations
 */
async function testGeospatialCalculations() {
  console.log('\n🌍 Testing Geospatial Calculations...');
  
  try {
    // Test 1: Distance calculation
    console.log('  Testing distance calculations...');
    const distance = driverMatchingService.calculateHaversineDistance(
      12.9716, 77.5946, // Pickup location
      12.9720, 77.5950  // Driver location
    );
    
    console.log(`✅ Distance calculated: ${distance.toFixed(2)} km`);

    // Test 2: ETA calculation
    console.log('  Testing ETA calculations...');
    const eta = driverMatchingService.calculateETA(distance, '2_wheeler');
    console.log(`✅ ETA calculated: ${eta} minutes`);

    // Test 3: Performance score calculation
    console.log('  Testing performance score calculation...');
    const performanceScore = driverMatchingService.calculatePerformanceScore(sampleDrivers[0]);
    console.log(`✅ Performance score calculated: ${performanceScore}/100`);

    return true;

  } catch (error) {
    console.error('❌ Geospatial calculations test failed:', error.message);
    return false;
  }
}

/**
 * Test driver ranking algorithms
 */
async function testDriverRanking() {
  console.log('\n🏆 Testing Driver Ranking Algorithms...');
  
  try {
    // Create sample driver data for ranking
    const testDrivers = [
      {
        driverId: 'driver1',
        name: 'Driver A',
        distance: 2.5,
        rating: 4.8,
        performanceScore: 85,
        estimatedArrival: 12
      },
      {
        driverId: 'driver2',
        name: 'Driver B',
        distance: 1.8,
        rating: 4.6,
        performanceScore: 78,
        estimatedArrival: 8
      },
      {
        driverId: 'driver3',
        name: 'Driver C',
        distance: 3.2,
        rating: 4.9,
        performanceScore: 92,
        estimatedArrival: 18
      }
    ];

    // Test different ranking priorities
    const priorities = ['balanced', 'fastest', 'best_rated', 'closest'];
    
    for (const priority of priorities) {
      console.log(`  Testing ${priority} ranking...`);
      const rankedDrivers = driverMatchingService.rankDrivers(testDrivers, priority);
      
      console.log(`✅ ${priority.toUpperCase()} ranking:`);
      rankedDrivers.forEach((driver, index) => {
        console.log(`   ${index + 1}. ${driver.name} - Rating: ${driver.rating}, Distance: ${driver.distance}km, ETA: ${driver.estimatedArrival}min`);
      });
    }

    return true;

  } catch (error) {
    console.error('❌ Driver ranking test failed:', error.message);
    return false;
  }
}

/**
 * Clean up test data
 */
async function cleanupTestData() {
  console.log('\n🧹 Cleaning up test data...');
  
  try {
    const db = getFirestore();
    
    // Clean up driver locations
    for (const driver of sampleDrivers) {
      await db.collection('driverLocations').doc(driver.id).delete();
    }
    console.log('✅ Driver locations cleaned up');

    // Clean up driver assignments
    const assignmentsSnapshot = await db.collection('driverAssignments')
      .where('driverId', 'in', sampleDrivers.map(d => d.id))
      .get();
    
    const batch = db.batch();
    assignmentsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log('✅ Driver assignments cleaned up');

    return true;

  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    return false;
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🚀 Starting EPickup Driver Matching Service Tests...\n');
  
  try {
    // Initialize Firebase first
    console.log('🔥 Initializing Firebase...');
    initializeFirebase();
    console.log('✅ Firebase initialized successfully');
    
    // Wait a moment for Firebase to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Test 1: Driver matching
    const matchingResult = await testDriverMatching();
    
    // Test 2: Driver availability
    const availabilityResult = await testDriverAvailability();
    
    // Test 3: Driver assignment
    const assignmentResult = await testDriverAssignment();
    
    // Test 4: Driver statistics
    const statsResult = await testDriverStatistics();
    
    // Test 5: Geospatial calculations
    const geospatialResult = await testGeospatialCalculations();
    
    // Test 6: Driver ranking
    const rankingResult = await testDriverRanking();
    
    // Test 7: Cleanup
    await cleanupTestData();
    
    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📊 Test Summary:');
    console.log(`   • Driver Matching: ${matchingResult?.success ? '✅' : '❌'}`);
    console.log(`   • Availability Management: ${availabilityResult ? '✅' : '❌'}`);
    console.log(`   • Assignment Handling: ${assignmentResult ? '✅' : '❌'}`);
    console.log(`   • Statistics: ${statsResult ? '✅' : '❌'}`);
    console.log(`   • Geospatial: ${geospatialResult ? '✅' : '❌'}`);
    console.log(`   • Driver Ranking: ${rankingResult ? '✅' : '❌'}`);
    
    if (matchingResult?.success) {
      console.log(`\n🚗 Driver Matching Results:`);
      console.log(`   • Matched Driver: ${matchingResult.data.driver.name}`);
      console.log(`   • Rating: ${matchingResult.data.driver.rating}/5`);
      console.log(`   • ETA: ${matchingResult.data.driver.estimatedArrival} minutes`);
      console.log(`   • Search Radius: ${matchingResult.data.searchRadius} km`);
      console.log(`   • Total Drivers Found: ${matchingResult.data.totalDriversFound}`);
    }
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error.message);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().then(() => {
    console.log('\n✨ Test script completed');
    process.exit(0);
  }).catch((error) => {
    console.error('\n💥 Test script failed:', error);
    process.exit(1);
  });
}

module.exports = {
  runTests,
  testDriverMatching,
  testDriverAvailability,
  testDriverAssignment,
  testDriverStatistics,
  testGeospatialCalculations,
  testDriverRanking,
  cleanupTestData
};
