#!/usr/bin/env node

/**
 * Test script for EPickup Booking System
 * Demonstrates the core functionality of the booking service
 */

require('dotenv').config();
const { initializeFirebase, getFirestore } = require('../src/services/firebase');

// Mock data for testing
const sampleBookingData = {
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
  estimatedPickupTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
  estimatedDeliveryTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() // 4 hours from now
};

const sampleDriverData = {
  id: "test_driver_001",
  name: "Rahul Kumar",
  phone: "+917777777777",
  rating: 4.8,
  totalTrips: 150,
  currentLocation: {
    latitude: 12.9720,
    longitude: 77.5950,
    timestamp: new Date(),
    accuracy: 10
  },
  vehicleDetails: {
    type: "motorcycle",
    model: "Honda Activa 6G",
    number: "KA01AB1234",
    color: "Black"
  }
};

/**
 * Test distance calculation
 */
async function testDistanceCalculation() {
  console.log('\n🧭 Testing Distance Calculation...');
  
  try {
    const db = getFirestore();
    
    // Calculate distance using Haversine formula
    const R = 6371; // Earth's radius in kilometers
    const lat1 = sampleBookingData.pickup.coordinates.latitude * Math.PI / 180;
    const lat2 = sampleBookingData.dropoff.coordinates.latitude * Math.PI / 180;
    const dLat = (sampleBookingData.dropoff.coordinates.latitude - sampleBookingData.pickup.coordinates.latitude) * Math.PI / 180;
    const dLon = (sampleBookingData.dropoff.coordinates.longitude - sampleBookingData.pickup.coordinates.longitude) * Math.PI / 180;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    console.log(`✅ Distance calculated: ${distance.toFixed(2)} km`);
    console.log(`   From: ${sampleBookingData.pickup.address}`);
    console.log(`   To: ${sampleBookingData.dropoff.address}`);
    
    return distance;
    
  } catch (error) {
    console.error('❌ Distance calculation failed:', error.message);
    return null;
  }
}

/**
 * Test pricing calculation
 */
async function testPricingCalculation(distance) {
  console.log('\n💰 Testing Pricing Calculation...');
  
  try {
    // Default rates (same as in service)
    const rates = {
      baseRate: 15,
      baseFare: 30,
      vehicleRates: {
        '2_wheeler': 1.0,
        '4_wheeler': 1.5
      },
      weightSurcharge: {
        threshold: 3,
        rate: 5,
        interval: 2
      },
      distanceSurcharge: {
        threshold: 10,
        rate: 2
      },
      timeSurcharge: {
        peakHours: {
          start: '08:00',
          end: '10:00',
          rate: 1.2
        },
        lateNight: {
          start: '22:00',
          end: '06:00',
          rate: 1.5
        }
      }
    };
    
    // Calculate pricing
    let baseFare = rates.baseFare;
    
    // Distance charge
    let distanceCharge = 0;
    if (distance <= rates.distanceSurcharge.threshold) {
      distanceCharge = distance * rates.baseRate;
    } else {
      distanceCharge = (rates.distanceSurcharge.threshold * rates.baseRate) +
        ((distance - rates.distanceSurcharge.threshold) * rates.distanceSurcharge.rate);
    }
    
    // Vehicle type multiplier
    const vehicleMultiplier = rates.vehicleRates[sampleBookingData.vehicle.type] || 1;
    distanceCharge *= vehicleMultiplier;
    
    // Weight surcharge
    let weightSurcharge = 0;
    if (sampleBookingData.package.weight > rates.weightSurcharge.threshold) {
      const extraWeight = sampleBookingData.package.weight - rates.weightSurcharge.threshold;
      const intervals = Math.ceil(extraWeight / rates.weightSurcharge.interval);
      weightSurcharge = intervals * rates.weightSurcharge.rate;
    }
    
    // Time-based surge pricing
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5);
    let surgeMultiplier = 1.0;
    
    if (currentTime >= rates.timeSurcharge.peakHours.start && currentTime <= rates.timeSurcharge.peakHours.end) {
      surgeMultiplier = rates.timeSurcharge.peakHours.rate;
    } else if (currentTime >= rates.timeSurcharge.lateNight.start || currentTime <= rates.timeSurcharge.lateNight.end) {
      surgeMultiplier = rates.timeSurcharge.lateNight.rate;
    }
    
    // Calculate subtotal
    const subtotal = (baseFare + distanceCharge + weightSurcharge) * surgeMultiplier;
    
    // Tax calculation (GST)
    const tax = subtotal * 0.18;
    
    // Total amount
    const totalAmount = subtotal + tax;
    
    console.log('✅ Pricing calculated successfully:');
    console.log(`   Base Fare: ₹${baseFare}`);
    console.log(`   Distance Charge: ₹${distanceCharge.toFixed(2)}`);
    console.log(`   Weight Surcharge: ₹${weightSurcharge}`);
    console.log(`   Surge Multiplier: ${surgeMultiplier}x`);
    console.log(`   Subtotal: ₹${subtotal.toFixed(2)}`);
    console.log(`   Tax (18%): ₹${tax.toFixed(2)}`);
    console.log(`   Total Amount: ₹${totalAmount.toFixed(2)}`);
    
    return {
      baseFare,
      distanceCharge: Math.round(distanceCharge * 100) / 100,
      weightSurcharge,
      surgeMultiplier: Math.round(surgeMultiplier * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100
    };
    
  } catch (error) {
    console.error('❌ Pricing calculation failed:', error.message);
    return null;
  }
}

/**
 * Test booking validation
 */
async function testBookingValidation() {
  console.log('\n✅ Testing Booking Validation...');
  
  try {
    const errors = [];
    
    // Required fields validation
    if (!sampleBookingData.pickup?.coordinates) {
      errors.push('Pickup coordinates are required');
    }
    if (!sampleBookingData.dropoff?.coordinates) {
      errors.push('Dropoff coordinates are required');
    }
    if (!sampleBookingData.package?.weight) {
      errors.push('Package weight is required');
    }
    
    // Weight limits
    const maxWeight = 50; // kg
    if (sampleBookingData.package.weight > maxWeight) {
      errors.push(`Package weight cannot exceed ${maxWeight} kg`);
    }
    
    // Distance limits
    const maxDistance = 100; // km
    // Note: We'll calculate actual distance later
    
    // Minimum amount
    const minAmount = 50; // INR
    // Note: We'll calculate actual amount later
    
    // Time validation
    if (sampleBookingData.estimatedPickupTime) {
      const pickupTime = new Date(sampleBookingData.estimatedPickupTime);
      const now = new Date();
      if (pickupTime < now) {
        errors.push('Estimated pickup time cannot be in the past');
      }
    }
    
    if (errors.length === 0) {
      console.log('✅ All validations passed');
      return { isValid: true, errors: [] };
    } else {
      console.log('❌ Validation failed:');
      errors.forEach(error => console.log(`   - ${error}`));
      return { isValid: false, errors };
    }
    
  } catch (error) {
    console.error('❌ Validation test failed:', error.message);
    return { isValid: false, errors: [error.message] };
  }
}

/**
 * Test database operations
 */
async function testDatabaseOperations() {
  console.log('\n🗄️ Testing Database Operations...');
  
  try {
    const db = getFirestore();
    
    // Test creating a sample driver location
    const driverLocationRef = db.collection('driverLocations').doc(sampleDriverData.id);
    await driverLocationRef.set({
      driverId: sampleDriverData.id,
      currentLocation: sampleDriverData.currentLocation,
      isOnline: true,
      isAvailable: true,
      rating: sampleDriverData.rating,
      totalTrips: sampleDriverData.totalTrips,
      vehicleType: sampleDriverData.vehicleDetails.type,
      lastUpdated: new Date()
    });
    
    console.log('✅ Sample driver location created');
    
    // Test creating a sample delivery rate
    const ratesRef = db.collection('deliveryRates').doc('test_rates');
    await ratesRef.set({
      id: 'test_rates',
      baseRate: 15,
      vehicleRates: {
        '2_wheeler': 1.0,
        '4_wheeler': 1.5
      },
      baseFare: 30,
      weightSurcharge: {
        threshold: 3,
        rate: 5,
        interval: 2
      },
      distanceSurcharge: {
        threshold: 10,
        rate: 2
      },
      timeSurcharge: {
        peakHours: {
          start: '08:00',
          end: '10:00',
          rate: 1.2
        },
        lateNight: {
          start: '22:00',
          end: '06:00',
          rate: 1.5
        }
      },
      lastUpdated: new Date(),
      isActive: true
    });
    
    console.log('✅ Sample delivery rates created');
    
    return true;
    
  } catch (error) {
    console.error('❌ Database operations failed:', error.message);
    return false;
  }
}

/**
 * Test available drivers search
 */
async function testAvailableDriversSearch(pickupLocation) {
  console.log('\n🚗 Testing Available Drivers Search...');
  
  try {
    const db = getFirestore();
    
    // Get available drivers
    let query = db.collection('driverLocations')
      .where('isOnline', '==', true)
      .where('isAvailable', '==', true);
    
    const snapshot = await query.get();
    const availableDrivers = [];
    
    for (const doc of snapshot.docs) {
      const driverData = doc.data();
      
      // Check if driver has current trip
      if (driverData.currentTripId) continue;
      
      // Calculate distance to pickup
      if (driverData.currentLocation) {
        const R = 6371;
        const lat1 = driverData.currentLocation.latitude * Math.PI / 180;
        const lat2 = pickupLocation.latitude * Math.PI / 180;
        const dLat = (pickupLocation.latitude - driverData.currentLocation.latitude) * Math.PI / 180;
        const dLon = (pickupLocation.longitude - driverData.currentLocation.longitude) * Math.PI / 180;
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1) * Math.cos(lat2) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;
        
        // Only include drivers within 5km radius
        if (distance <= 5) {
          availableDrivers.push({
            driverId: doc.id,
            distance: Math.round(distance * 100) / 100,
            rating: driverData.rating || 0,
            totalTrips: driverData.totalTrips || 0,
            currentLocation: driverData.currentLocation
          });
        }
      }
    }
    
    // Sort by distance and rating
    availableDrivers.sort((a, b) => {
      const distanceDiff = a.distance - b.distance;
      if (Math.abs(distanceDiff) < 1) {
        return b.rating - a.rating;
      }
      return distanceDiff;
    });
    
    console.log(`✅ Found ${availableDrivers.length} available drivers within 5km radius`);
    
    if (availableDrivers.length > 0) {
      console.log('   Top drivers:');
      availableDrivers.slice(0, 3).forEach((driver, index) => {
        console.log(`   ${index + 1}. Driver ${driver.driverId} - ${driver.distance}km away, Rating: ${driver.rating}`);
      });
    }
    
    return availableDrivers;
    
  } catch (error) {
    console.error('❌ Available drivers search failed:', error.message);
    return [];
  }
}

/**
 * Clean up test data
 */
async function cleanupTestData() {
  console.log('\n🧹 Cleaning up test data...');
  
  try {
    const db = getFirestore();
    
    // Delete test driver location
    await db.collection('driverLocations').doc(sampleDriverData.id).delete();
    console.log('✅ Test driver location deleted');
    
    // Delete test delivery rates
    await db.collection('deliveryRates').doc('test_rates').delete();
    console.log('✅ Test delivery rates deleted');
    
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
  console.log('🚀 Starting EPickup Booking System Tests...\n');
  
  try {
    // Initialize Firebase first
    console.log('🔥 Initializing Firebase...');
    initializeFirebase();
    console.log('✅ Firebase initialized successfully');
    
    // Wait a moment for Firebase to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Test 1: Distance calculation
    const distance = await testDistanceCalculation();
    if (!distance) return;
    
    // Test 2: Pricing calculation
    const pricing = await testPricingCalculation(distance);
    if (!pricing) return;
    
    // Test 3: Booking validation
    const validation = await testBookingValidation();
    if (!validation.isValid) return;
    
    // Test 4: Database operations
    const dbSuccess = await testDatabaseOperations();
    if (!dbSuccess) return;
    
    // Test 5: Available drivers search
    const availableDrivers = await testAvailableDriversSearch(sampleBookingData.pickup.coordinates);
    
    // Test 6: Cleanup
    await cleanupTestData();
    
    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📊 Test Summary:');
    console.log(`   • Distance: ${distance.toFixed(2)} km`);
    console.log(`   • Total Amount: ₹${pricing.totalAmount}`);
    console.log(`   • Available Drivers: ${availableDrivers.length}`);
    console.log(`   • Validation: ✅ Passed`);
    console.log(`   • Database: ✅ Connected`);
    
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
  testDistanceCalculation,
  testPricingCalculation,
  testBookingValidation,
  testDatabaseOperations,
  testAvailableDriversSearch,
  cleanupTestData
};
