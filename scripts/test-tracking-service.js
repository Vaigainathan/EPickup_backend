#!/usr/bin/env node

/**
 * Test script for EPickup Tracking Service
 * Demonstrates the complete real-time tracking functionality
 */

require('dotenv').config();
const TrackingService = require('../src/services/trackingService');

// Mock data for testing
const sampleTripData = {
  bookingId: "test_booking_001",
  driverId: "test_driver_001",
  customerId: "test_customer_001",
  pickup: {
    coordinates: {
      latitude: 12.9716,
      longitude: 77.5946
    },
    address: "123 MG Road, Bangalore, Karnataka"
  },
  dropoff: {
    coordinates: {
      latitude: 12.9789,
      longitude: 77.5917
    },
    address: "456 Indiranagar, Bangalore, Karnataka"
  },
  driverLocation: {
    latitude: 12.9720,
    longitude: 77.5950
  }
};

const sampleLocationUpdates = [
  {
    latitude: 12.9720,
    longitude: 77.5950,
    accuracy: 10,
    speed: 0,
    heading: 0
  },
  {
    latitude: 12.9730,
    longitude: 77.5940,
    accuracy: 8,
    speed: 15,
    heading: 45
  },
  {
    latitude: 12.9740,
    longitude: 77.5930,
    accuracy: 6,
    speed: 20,
    heading: 90
  },
  {
    latitude: 12.9750,
    longitude: 77.5920,
    accuracy: 5,
    speed: 18,
    heading: 135
  },
  {
    latitude: 12.9760,
    longitude: 77.5910,
    accuracy: 4,
    speed: 12,
    heading: 180
  }
];

/**
 * Test trip tracking lifecycle
 */
async function testTripTrackingLifecycle() {
  console.log('\n🚀 Testing Trip Tracking Lifecycle...');
  
  try {
    const trackingService = new TrackingService();
    const tripId = `test_trip_${Date.now()}`;
    
    // Test 1: Start trip tracking
    console.log('  Testing trip tracking start...');
    const startResult = await trackingService.startTripTracking(tripId, sampleTripData);
    
    if (startResult.success) {
      console.log('✅ Trip tracking started successfully');
      console.log(`   Trip ID: ${startResult.data.tripId}`);
      console.log(`   Status: ${startResult.data.status}`);
    } else {
      console.log('❌ Failed to start trip tracking');
      return false;
    }
    
    // Test 2: Update driver locations
    console.log('\n  Testing location updates...');
    for (let i = 0; i < sampleLocationUpdates.length; i++) {
      const location = sampleLocationUpdates[i];
      console.log(`   Update ${i + 1}: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`);
      
      const updateResult = await trackingService.updateDriverLocation(tripId, location);
      if (updateResult.success) {
        const { progress } = updateResult.data;
        console.log(`     Distance to pickup: ${progress.distanceToPickup.toFixed(3)} km`);
        console.log(`     ETA to pickup: ${progress.etaToPickup} min`);
        console.log(`     Current stage: ${progress.currentStage}`);
      } else {
        console.log('❌ Location update failed');
        return false;
      }
      
      // Wait a bit between updates
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Test 3: Get trip status
    console.log('\n  Testing trip status retrieval...');
    const statusResult = await trackingService.getTripStatus(tripId);
    
    if (statusResult.success) {
      const { progress, route, geofence } = statusResult.data;
      console.log('✅ Trip status retrieved successfully');
      console.log(`   Current stage: ${progress.currentStage}`);
      console.log(`   Route distance: ${route.distance.toFixed(2)} km`);
      console.log(`   Pickup geofence triggered: ${geofence.pickup.triggered}`);
      console.log(`   Dropoff geofence triggered: ${geofence.dropoff.triggered}`);
    } else {
      console.log('❌ Failed to get trip status');
      return false;
    }
    
    // Test 4: Get location history
    console.log('\n  Testing location history retrieval...');
    const historyResult = await trackingService.getTripLocationHistory(tripId, { limit: 10 });
    
    if (historyResult.success) {
      console.log('✅ Location history retrieved successfully');
      console.log(`   Total locations: ${historyResult.data.total}`);
      console.log(`   First location: ${historyResult.data.locations[0]?.latitude.toFixed(6)}, ${historyResult.data.locations[0]?.longitude.toFixed(6)}`);
      console.log(`   Last location: ${historyResult.data.locations[historyResult.data.locations.length - 1]?.latitude.toFixed(6)}, ${historyResult.data.locations[historyResult.data.locations.length - 1]?.longitude.toFixed(6)}`);
    } else {
      console.log('❌ Failed to get location history');
      return false;
    }
    
    // Test 5: Get trip analytics
    console.log('\n  Testing trip analytics...');
    const analyticsResult = await trackingService.getTripAnalytics(tripId);
    
    if (analyticsResult.success && analyticsResult.data.analytics) {
      const analytics = analyticsResult.data.analytics;
      console.log('✅ Trip analytics retrieved successfully');
      console.log(`   Total distance: ${analytics.totalDistance.toFixed(3)} km`);
      console.log(`   Average speed: ${analytics.averageSpeed.toFixed(2)} km/h`);
      console.log(`   Total time: ${analytics.totalTime} minutes`);
      console.log(`   Stops detected: ${analytics.stops}`);
      console.log(`   Route efficiency: ${analytics.efficiency}%`);
    } else {
      console.log('❌ Failed to get trip analytics');
      return false;
    }
    
    // Test 6: Stop trip tracking
    console.log('\n  Testing trip tracking stop...');
    const stopResult = await trackingService.stopTripTracking(tripId, 'test_completed');
    
    if (stopResult.success) {
      console.log('✅ Trip tracking stopped successfully');
      console.log(`   Final status: ${stopResult.data.status}`);
      console.log(`   Stop reason: ${stopResult.data.reason}`);
    } else {
      console.log('❌ Failed to stop trip tracking');
      return false;
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Trip tracking lifecycle test failed:', error.message);
    return false;
  }
}

/**
 * Test geofencing functionality
 */
async function testGeofencing() {
  console.log('\n📍 Testing Geofencing Functionality...');
  
  try {
    const trackingService = new TrackingService();
    const tripId = `test_geofence_${Date.now()}`;
    
    // Start tracking
    await trackingService.startTripTracking(tripId, sampleTripData);
    
    // Test pickup geofence
    console.log('  Testing pickup geofence...');
    const pickupLocation = {
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 5,
      speed: 0,
      heading: 0
    };
    
    await trackingService.updateDriverLocation(tripId, pickupLocation);
    
    // Check if pickup geofence was triggered
    const status = await trackingService.getTripStatus(tripId);
    if (status.success && status.data.geofence.pickup.triggered) {
      console.log('✅ Pickup geofence triggered successfully');
      console.log(`   Triggered at: ${status.data.geofence.pickup.triggeredAt}`);
    } else {
      console.log('❌ Pickup geofence not triggered');
    }
    
    // Test dropoff geofence
    console.log('\n  Testing dropoff geofence...');
    const dropoffLocation = {
      latitude: 12.9789,
      longitude: 77.5917,
      accuracy: 5,
      speed: 0,
      heading: 0
    };
    
    await trackingService.updateDriverLocation(tripId, dropoffLocation);
    
    // Check if dropoff geofence was triggered
    const finalStatus = await trackingService.getTripStatus(tripId);
    if (finalStatus.success && finalStatus.data.geofence.dropoff.triggered) {
      console.log('✅ Dropoff geofence triggered successfully');
      console.log(`   Triggered at: ${finalStatus.data.geofence.dropoff.triggeredAt}`);
    } else {
      console.log('❌ Dropoff geofence not triggered');
    }
    
    // Stop tracking
    await trackingService.stopTripTracking(tripId, 'geofence_test_completed');
    
    return true;
    
  } catch (error) {
    console.error('❌ Geofencing test failed:', error.message);
    return false;
  }
}

/**
 * Test route calculation
 */
async function testRouteCalculation() {
  console.log('\n🗺️ Testing Route Calculation...');
  
  try {
    const trackingService = new TrackingService();
    const tripId = `test_route_${Date.now()}`;
    
    // Start tracking
    await trackingService.startTripTracking(tripId, sampleTripData);
    
    // Get trip status to check route
    const status = await trackingService.getTripStatus(tripId);
    
    if (status.success) {
      const { route } = status.data;
      console.log('✅ Route calculation completed');
      console.log(`   Route distance: ${route.distance.toFixed(2)} km`);
      console.log(`   Route duration: ${route.duration} minutes`);
      console.log(`   Has polyline: ${route.polyline ? 'Yes' : 'No'}`);
      console.log(`   Waypoints: ${route.waypoints.length}`);
      
      if (route.googleRouteId) {
        console.log(`   Google route ID: ${route.googleRouteId}`);
      } else {
        console.log('   Using fallback route calculation');
      }
    } else {
      console.log('❌ Route calculation failed');
      return false;
    }
    
    // Stop tracking
    await trackingService.stopTripTracking(tripId, 'route_test_completed');
    
    return true;
    
  } catch (error) {
    console.error('❌ Route calculation test failed:', error.message);
    return false;
  }
}

/**
 * Test multiple trips
 */
async function testMultipleTrips() {
  console.log('\n🚗 Testing Multiple Trips...');
  
  try {
    const trackingService = new TrackingService();
    const trips = [];
    
    // Create multiple trips
    for (let i = 1; i <= 3; i++) {
      const tripId = `multi_trip_${i}_${Date.now()}`;
      const tripData = {
        ...sampleTripData,
        bookingId: `test_booking_00${i}`,
        driverId: `test_driver_00${i}`,
        customerId: `test_customer_00${i}`,
        pickup: {
          coordinates: {
            latitude: 12.9716 + (i * 0.001),
            longitude: 77.5946 + (i * 0.001)
          }
        }
      };
      
      await trackingService.startTripTracking(tripId, tripData);
      trips.push(tripId);
      
      console.log(`   Created trip ${i}: ${tripId}`);
    }
    
    // Check active trips
    const activeTrips = trackingService.getActiveTrips();
    console.log(`✅ Created ${activeTrips.length} active trips`);
    
    // Update locations for each trip
    for (const tripId of trips) {
      const location = {
        latitude: 12.9720 + Math.random() * 0.01,
        longitude: 77.5950 + Math.random() * 0.01,
        accuracy: 5 + Math.random() * 10,
        speed: Math.random() * 20,
        heading: Math.random() * 360
      };
      
      await trackingService.updateDriverLocation(tripId, location);
      console.log(`   Updated location for trip: ${tripId}`);
    }
    
    // Get statistics
    const stats = trackingService.getTrackingStatistics();
    console.log('✅ Tracking statistics:');
    console.log(`   Active trips: ${stats.activeTrips}`);
    console.log(`   Total subscriptions: ${stats.totalSubscriptions}`);
    console.log(`   Total events: ${stats.totalEvents}`);
    
    // Stop all trips
    for (const tripId of trips) {
      await trackingService.stopTripTracking(tripId, 'multi_test_completed');
    }
    
    console.log('✅ All multiple trips completed successfully');
    return true;
    
  } catch (error) {
    console.error('❌ Multiple trips test failed:', error.message);
    return false;
  }
}

/**
 * Test error handling
 */
async function testErrorHandling() {
  console.log('\n⚠️ Testing Error Handling...');
  
  try {
    const trackingService = new TrackingService();
    
    // Test 1: Invalid trip data
    console.log('  Testing invalid trip data...');
    try {
      await trackingService.startTripTracking('invalid_trip', {});
      console.log('❌ Should have failed with invalid data');
      return false;
    } catch (error) {
      console.log('✅ Correctly rejected invalid trip data');
    }
    
    // Test 2: Invalid location data
    console.log('  Testing invalid location data...');
    const tripId = `error_test_${Date.now()}`;
    await trackingService.startTripTracking(tripId, sampleTripData);
    
    try {
      await trackingService.updateDriverLocation(tripId, { latitude: 'invalid', longitude: 'invalid' });
      console.log('❌ Should have failed with invalid coordinates');
      return false;
    } catch (error) {
      console.log('✅ Correctly rejected invalid location data');
    }
    
    // Test 3: Non-existent trip
    console.log('  Testing non-existent trip...');
    try {
      await trackingService.getTripStatus('non_existent_trip');
      console.log('❌ Should have failed with non-existent trip');
      return false;
    } catch (error) {
      console.log('✅ Correctly handled non-existent trip');
    }
    
    // Clean up
    await trackingService.stopTripTracking(tripId, 'error_test_completed');
    
    console.log('✅ All error handling tests passed');
    return true;
    
  } catch (error) {
    console.error('❌ Error handling test failed:', error.message);
    return false;
  }
}

/**
 * Test performance and scalability
 */
async function testPerformance() {
  console.log('\n⚡ Testing Performance and Scalability...');
  
  try {
    const trackingService = new TrackingService();
    const startTime = Date.now();
    const trips = [];
    
    // Create many trips quickly
    console.log('  Testing rapid trip creation...');
    for (let i = 1; i <= 10; i++) {
      const tripId = `perf_trip_${i}_${Date.now()}`;
      const tripData = {
        ...sampleTripData,
        bookingId: `perf_booking_${i}`,
        driverId: `perf_driver_${i}`,
        customerId: `perf_customer_${i}`
      };
      
      await trackingService.startTripTracking(tripId, tripData);
      trips.push(tripId);
    }
    
    const creationTime = Date.now() - startTime;
    console.log(`✅ Created 10 trips in ${creationTime}ms (${(10000 / creationTime).toFixed(2)} trips/second)`);
    
    // Test rapid location updates
    console.log('  Testing rapid location updates...');
    const locationStartTime = Date.now();
    
    for (const tripId of trips) {
      for (let j = 0; j < 5; j++) {
        const location = {
          latitude: 12.9720 + Math.random() * 0.01,
          longitude: 77.5950 + Math.random() * 0.01,
          accuracy: 5 + Math.random() * 10,
          speed: Math.random() * 20,
          heading: Math.random() * 360
        };
        
        await trackingService.updateDriverLocation(tripId, location);
      }
    }
    
    const locationTime = Date.now() - locationStartTime;
    const totalUpdates = trips.length * 5;
    console.log(`✅ Updated ${totalUpdates} locations in ${locationTime}ms (${(totalUpdates * 1000 / locationTime).toFixed(2)} updates/second)`);
    
    // Test concurrent operations
    console.log('  Testing concurrent operations...');
    const concurrentStartTime = Date.now();
    
    const promises = trips.map(async (tripId) => {
      const status = await trackingService.getTripStatus(tripId);
      const history = await trackingService.getTripLocationHistory(tripId, { limit: 5 });
      const analytics = await trackingService.getTripAnalytics(tripId);
      return { status: status.success, history: history.success, analytics: analytics.success };
    });
    
    const results = await Promise.all(promises);
    const concurrentTime = Date.now() - concurrentStartTime;
    
    const successfulOps = results.reduce((sum, result) => 
      sum + (result.status ? 1 : 0) + (result.history ? 1 : 0) + (result.analytics ? 1 : 0), 0
    );
    
    console.log(`✅ Completed ${successfulOps} concurrent operations in ${concurrentTime}ms`);
    
    // Clean up
    for (const tripId of trips) {
      await trackingService.stopTripTracking(tripId, 'performance_test_completed');
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`✅ Performance test completed in ${totalTime}ms total`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Performance test failed:', error.message);
    return false;
  }
}

/**
 * Test cleanup functionality
 */
async function testCleanup() {
  console.log('\n🧹 Testing Cleanup Functionality...');
  
  try {
    const trackingService = new TrackingService();
    
    // Create some trips
    const trips = [];
    for (let i = 1; i <= 3; i++) {
      const tripId = `cleanup_trip_${i}_${Date.now()}`;
      await trackingService.startTripTracking(tripId, sampleTripData);
      trips.push(tripId);
    }
    
    console.log(`   Created ${trips.length} trips for cleanup testing`);
    
    // Test cleanup
    await trackingService.cleanupExpiredTrips(1000); // 1 second max age
    
    // Check if trips were cleaned up
    const activeTrips = trackingService.getActiveTrips();
    console.log(`   Active trips after cleanup: ${activeTrips.length}`);
    
    if (activeTrips.length === 0) {
      console.log('✅ Cleanup functionality working correctly');
    } else {
      console.log('⚠️ Some trips were not cleaned up');
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Cleanup test failed:', error.message);
    return false;
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🚀 Starting EPickup Tracking Service Tests...\n');
  
  try {
    const tests = [
      { name: 'Trip Tracking Lifecycle', fn: testTripTrackingLifecycle },
      { name: 'Geofencing', fn: testGeofencing },
      { name: 'Route Calculation', fn: testRouteCalculation },
      { name: 'Multiple Trips', fn: testMultipleTrips },
      { name: 'Error Handling', fn: testErrorHandling },
      { name: 'Performance', fn: testPerformance },
      { name: 'Cleanup', fn: testCleanup }
    ];
    
    const results = [];
    
    for (const test of tests) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🧪 Running: ${test.name}`);
      console.log(`${'='.repeat(60)}`);
      
      const startTime = Date.now();
      const success = await test.fn();
      const duration = Date.now() - startTime;
      
      results.push({
        name: test.name,
        success,
        duration
      });
      
      if (success) {
        console.log(`\n✅ ${test.name} completed successfully in ${duration}ms`);
      } else {
        console.log(`\n❌ ${test.name} failed after ${duration}ms`);
      }
    }
    
    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 TEST SUMMARY');
    console.log(`${'='.repeat(60)}`);
    
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
    
    console.log(`Total Tests: ${results.length}`);
    console.log(`Passed: ${passed} ✅`);
    console.log(`Failed: ${failed} ❌`);
    console.log(`Total Time: ${totalTime}ms`);
    console.log(`Success Rate: ${((passed / results.length) * 100).toFixed(1)}%`);
    
    if (failed === 0) {
      console.log('\n🎉 All tests passed successfully!');
    } else {
      console.log('\n⚠️ Some tests failed. Please review the output above.');
    }
    
    return failed === 0;
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error.message);
    return false;
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().then((success) => {
    console.log('\n✨ Test script completed');
    process.exit(success ? 0 : 1);
  }).catch((error) => {
    console.error('\n💥 Test script failed:', error);
    process.exit(1);
  });
}

module.exports = {
  runTests,
  testTripTrackingLifecycle,
  testGeofencing,
  testRouteCalculation,
  testMultipleTrips,
  testErrorHandling,
  testPerformance,
  testCleanup
};
