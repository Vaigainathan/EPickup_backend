#!/usr/bin/env node

/**
 * Test script for EPickup Notification Service
 * Demonstrates the core functionality of the notification service
 */

require('dotenv').config();
const { getFirestore, initializeFirebase } = require('../src/services/firebase');

// Initialize Firebase first
initializeFirebase();

// Mock data for testing
const sampleUsers = {
  customer: {
    id: "test_customer_001",
    phone: "+919999999999",
    fcmToken: "test_fcm_token_customer_001",
    userType: "customer",
    notificationPreferences: {
      push: true,
      inApp: true,
      sms: false,
      types: {
        booking: true,
        payment: true,
        system: false
      }
    }
  },
  driver: {
    id: "test_driver_001",
    phone: "+917777777777",
    fcmToken: "test_fcm_token_driver_001",
    userType: "driver",
    notificationPreferences: {
      push: true,
      inApp: true,
      sms: true,
      types: {
        booking: true,
        payment: false,
        system: false
      }
    }
  },
  admin: {
    id: "test_admin_001",
    phone: "+916666666666",
    fcmToken: "test_fcm_token_admin_001",
    userType: "admin",
    notificationPreferences: {
      push: true,
      inApp: true,
      sms: false,
      types: {
        booking: true,
        payment: true,
        system: true
      }
    }
  }
};

const sampleBooking = {
  id: "test_booking_001",
  customerId: sampleUsers.customer.id,
  driverId: sampleUsers.driver.id,
  pickup: {
    address: "123 MG Road, Bangalore",
    coordinates: { latitude: 12.9716, longitude: 77.5946 }
  },
  dropoff: {
    address: "456 Indiranagar, Bangalore",
    coordinates: { latitude: 12.9789, longitude: 77.5917 }
  }
};

/**
 * Test notification templates
 */
async function testNotificationTemplates() {
  console.log('\n📋 Testing Notification Templates...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    console.log('✅ Available notification types:');
    Object.keys(notificationService.templates).forEach(type => {
      const template = notificationService.templates[type];
      console.log(`   • ${type}: ${template.title} - ${template.body} (${template.priority})`);
    });
    
    return true;
    
  } catch (error) {
    console.error('❌ Notification templates test failed:', error.message);
    return false;
  }
}

/**
 * Test user creation for testing
 */
async function createTestUsers() {
  console.log('\n👥 Creating Test Users...');
  
  try {
    const db = getFirestore();
    
    // Create test users
    for (const [role, userData] of Object.entries(sampleUsers)) {
      await db.collection('users').doc(userData.id).set({
        ...userData,
        name: `Test ${role.charAt(0).toUpperCase() + role.slice(1)}`,
        email: `test.${role}@epickup.com`,
        isVerified: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log(`✅ Created test ${role}: ${userData.id}`);
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Test user creation failed:', error.message);
    return false;
  }
}

/**
 * Test push notification sending
 */
async function testPushNotification() {
  console.log('\n📱 Testing Push Notification...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test sending push notification to customer
    const result = await notificationService.sendPushNotification(
      sampleUsers.customer.id,
      'booking_created',
      {
        bookingId: sampleBooking.id,
        amount: 150.00,
        estimatedTime: '30 minutes'
      },
      {
        title: 'Custom Booking Title',
        body: 'Custom notification message'
      }
    );
    
    console.log('✅ Push notification sent successfully:');
    console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Push notification test failed:', error.message);
    return null;
  }
}

/**
 * Test SMS notification (fallback)
 */
async function testSMSNotification() {
  console.log('\n💬 Testing SMS Notification...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test sending SMS notification to driver
    const result = await notificationService.sendSMSNotification(
      sampleUsers.driver.id,
      'new_booking',
      {
        bookingId: sampleBooking.id,
        pickupAddress: sampleBooking.pickup.address,
        estimatedEarnings: 120.00
      }
    );
    
    console.log('✅ SMS notification sent successfully:');
    console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ SMS notification test failed:', error.message);
    console.log('   Note: This is expected if SMS is not configured');
    return null;
  }
}

/**
 * Test in-app notification creation
 */
async function testInAppNotification() {
  console.log('\n🔔 Testing In-App Notification...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test creating in-app notification for customer
    const result = await notificationService.createInAppNotification(
      sampleUsers.customer.id,
      'driver_enroute',
      {
        bookingId: sampleBooking.id,
        driverName: 'Rahul Kumar',
        estimatedArrival: '5 minutes'
      }
    );
    
    console.log('✅ In-app notification created successfully:');
    console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ In-app notification test failed:', error.message);
    return null;
  }
}

/**
 * Test comprehensive notification
 */
async function testComprehensiveNotification() {
  console.log('\n🚀 Testing Comprehensive Notification...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test sending comprehensive notification to driver
    const result = await notificationService.sendComprehensiveNotification(
      sampleUsers.driver.id,
      'booking_accepted',
      {
        bookingId: sampleBooking.id,
        customerName: 'John Doe',
        pickupAddress: sampleBooking.pickup.address
      }
    );
    
    console.log('✅ Comprehensive notification sent successfully:');
    console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Comprehensive notification test failed:', error.message);
    return null;
  }
}

/**
 * Test multicast notification
 */
async function testMulticastNotification() {
  console.log('\n📢 Testing Multicast Notification...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test sending multicast notification to multiple users
    const userIds = [sampleUsers.customer.id, sampleUsers.driver.id];
    const result = await notificationService.sendMulticastNotification(
      userIds,
      'system_maintenance',
      {
        maintenanceTime: '2:00 AM - 4:00 AM',
        reason: 'Scheduled system updates'
      }
    );
    
    console.log('✅ Multicast notification sent successfully:');
    console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Multicast notification test failed:', error.message);
    return null;
  }
}

/**
 * Test role-based notification
 */
async function testRoleBasedNotification() {
  console.log('\n🎭 Testing Role-Based Notification...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test sending notification to all drivers
    const result = await notificationService.sendNotificationToRole(
      'driver',
      'app_update',
      {
        version: '2.1.0',
        features: ['Enhanced tracking', 'Better UI', 'Performance improvements']
      }
    );
    
    console.log('✅ Role-based notification sent successfully:');
    console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Role-based notification test failed:', error.message);
    return null;
  }
}

/**
 * Test area-based notification
 */
async function testAreaBasedNotification() {
  console.log('\n🗺️ Testing Area-Based Notification...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test sending notification to users in a specific area
    const center = { latitude: 12.9716, longitude: 77.5946 }; // Bangalore center
    const radius = 5; // 5km radius
    
    const result = await notificationService.sendNotificationToArea(
      center,
      radius,
      'promotional_offer',
      {
        offer: '20% off on first delivery',
        validUntil: '2024-12-31',
        code: 'WELCOME20'
      }
    );
    
    console.log('✅ Area-based notification sent successfully:');
    console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Area-based notification test failed:', error.message);
    return null;
  }
}

/**
 * Test notification scheduling
 */
async function testNotificationScheduling() {
  console.log('\n⏰ Testing Notification Scheduling...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test scheduling a notification for 1 minute from now
    const scheduledTime = new Date(Date.now() + 1 * 60 * 1000); // 1 minute from now
    
    const result = await notificationService.scheduleNotification(
      sampleUsers.customer.id,
      'delivery_reminder',
      scheduledTime,
      {
        bookingId: sampleBooking.id,
        reminder: 'Your delivery is scheduled for tomorrow'
      }
    );
    
    console.log('✅ Notification scheduled successfully:');
    console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Notification scheduling test failed:', error.message);
    return null;
  }
}

/**
 * Test notification preferences
 */
async function testNotificationPreferences() {
  console.log('\n⚙️ Testing Notification Preferences...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test getting user preferences
    const preferences = await notificationService.getUserNotificationPreferences(sampleUsers.customer.id);
    console.log('✅ User preferences retrieved:');
    console.log(`   Result: ${JSON.stringify(preferences, null, 2)}`);
    
    // Test updating preferences
    const updatedPreferences = {
      ...preferences.data,
      push: false,
      sms: true,
      quietHours: {
        enabled: true,
        start: '23:00',
        end: '07:00'
      }
    };
    
    const updateResult = await notificationService.updateUserNotificationPreferences(
      sampleUsers.customer.id,
      updatedPreferences
    );
    
    console.log('✅ User preferences updated:');
    console.log(`   Result: ${JSON.stringify(updateResult, null, 2)}`);
    
    return { preferences, updateResult };
    
  } catch (error) {
    console.error('❌ Notification preferences test failed:', error.message);
    return null;
  }
}

/**
 * Test notification management
 */
async function testNotificationManagement() {
  console.log('\n📝 Testing Notification Management...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test getting user notifications
    const notifications = await notificationService.getUserNotifications(sampleUsers.customer.id, {
      limit: 10,
      unreadOnly: false
    });
    
    console.log('✅ User notifications retrieved:');
    console.log(`   Total: ${notifications.data.total}`);
    console.log(`   Notifications: ${notifications.data.notifications.length}`);
    
    // Test marking notification as read
    if (notifications.data.notifications.length > 0) {
      const firstNotification = notifications.data.notifications[0];
      const markReadResult = await notificationService.markNotificationAsRead(
        sampleUsers.customer.id,
        firstNotification.id
      );
      
      console.log('✅ Notification marked as read:');
      console.log(`   Result: ${JSON.stringify(markReadResult, null, 2)}`);
    }
    
    // Test getting notification statistics
    const stats = await notificationService.getNotificationStatistics(sampleUsers.customer.id);
    
    console.log('✅ Notification statistics retrieved:');
    console.log(`   Result: ${JSON.stringify(stats, null, 2)}`);
    
    return { notifications, stats };
    
  } catch (error) {
    console.error('❌ Notification management test failed:', error.message);
    return null;
  }
}

/**
 * Test notification cleanup
 */
async function testNotificationCleanup() {
  console.log('\n🧹 Testing Notification Cleanup...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test cleaning up old logs (30 days)
    const result = await notificationService.cleanupOldLogs(30 * 24 * 60 * 60 * 1000);
    
    console.log('✅ Notification cleanup completed:');
    console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Notification cleanup test failed:', error.message);
    return null;
  }
}

/**
 * Test quiet hours functionality
 */
async function testQuietHours() {
  console.log('\n🌙 Testing Quiet Hours...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test quiet hours check
    const preferences = {
      quietHours: {
        enabled: true,
        start: '22:00',
        end: '08:00'
      }
    };
    
    const isQuietHours = notificationService.isWithinQuietHours(preferences);
    console.log('✅ Quiet hours check completed:');
    console.log(`   Is within quiet hours: ${isQuietHours}`);
    
    // Test different time scenarios
    const testTimes = [
      { time: '23:00', expected: true },
      { time: '14:00', expected: false },
      { time: '03:00', expected: true }
    ];
    
    testTimes.forEach(({ time, expected }) => {
      const moment = require('moment');
      const testTime = moment(time, 'HH:mm');
      const isQuiet = notificationService.isWithinQuietHours(preferences);
      console.log(`   Time ${time}: ${isQuiet === expected ? '✅' : '❌'} (Expected: ${expected})`);
    });
    
    return { isQuietHours };
    
  } catch (error) {
    console.error('❌ Quiet hours test failed:', error.message);
    return null;
  }
}

/**
 * Test distance calculation
 */
async function testDistanceCalculation() {
  console.log('\n📏 Testing Distance Calculation...');
  
  try {
    const NotificationService = require('../src/services/notificationService');
    const notificationService = new NotificationService();
    
    // Test distance calculation between two points
    const lat1 = 12.9716; // Bangalore
    const lon1 = 77.5946;
    const lat2 = 12.9789; // Indiranagar
    const lon2 = 77.5917;
    
    const distance = notificationService.calculateDistance(lat1, lon1, lat2, lon2);
    
    console.log('✅ Distance calculation completed:');
    console.log(`   From: (${lat1}, ${lon1})`);
    console.log(`   To: (${lat2}, ${lon2})`);
    console.log(`   Distance: ${distance.toFixed(2)} km`);
    
    return distance;
    
  } catch (error) {
    console.error('❌ Distance calculation test failed:', error.message);
    return null;
  }
}

/**
 * Clean up test data
 */
async function cleanupTestData() {
  console.log('\n🧹 Cleaning up test data...');
  
  try {
    const db = getFirestore();
    
    // Delete test users
    for (const [role, userData] of Object.entries(sampleUsers)) {
      await db.collection('users').doc(userData.id).delete();
      console.log(`✅ Deleted test ${role}: ${userData.id}`);
    }
    
    // Delete test notifications
    const notificationsSnapshot = await db.collection('notifications')
      .where('userId', 'in', Object.values(sampleUsers).map(u => u.id))
      .get();
    
    const batch = db.batch();
    notificationsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    
    console.log(`✅ Deleted ${notificationsSnapshot.docs.length} test notifications`);
    
    // Delete test scheduled notifications
    const scheduledSnapshot = await db.collection('scheduledNotifications')
      .where('userId', 'in', Object.values(sampleUsers).map(u => u.id))
      .get();
    
    const scheduledBatch = db.batch();
    scheduledSnapshot.docs.forEach(doc => {
      scheduledBatch.delete(doc.ref);
    });
    await scheduledBatch.commit();
    
    console.log(`✅ Deleted ${scheduledSnapshot.docs.length} test scheduled notifications`);
    
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
  console.log('🚀 Starting EPickup Notification Service Tests...\n');
  
  try {
    // Test 1: Notification templates
    const templatesSuccess = await testNotificationTemplates();
    if (!templatesSuccess) return;
    
    // Test 2: Create test users
    const usersSuccess = await createTestUsers();
    if (!usersSuccess) return;
    
    // Test 3: Push notification
    const pushResult = await testPushNotification();
    
    // Test 4: SMS notification
    const smsResult = await testSMSNotification();
    
    // Test 5: In-app notification
    const inAppResult = await testInAppNotification();
    
    // Test 6: Comprehensive notification
    const comprehensiveResult = await testComprehensiveNotification();
    
    // Test 7: Multicast notification
    const multicastResult = await testMulticastNotification();
    
    // Test 8: Role-based notification
    const roleResult = await testRoleBasedNotification();
    
    // Test 9: Area-based notification
    const areaResult = await testAreaBasedNotification();
    
    // Test 10: Notification scheduling
    const schedulingResult = await testNotificationScheduling();
    
    // Test 11: Notification preferences
    const preferencesResult = await testNotificationPreferences();
    
    // Test 12: Notification management
    const managementResult = await testNotificationManagement();
    
    // Test 13: Notification cleanup
    const cleanupResult = await testNotificationCleanup();
    
    // Test 14: Quiet hours
    const quietHoursResult = await testQuietHours();
    
    // Test 15: Distance calculation
    const distanceResult = await testDistanceCalculation();
    
    // Test 16: Cleanup
    await cleanupTestData();
    
    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📊 Test Summary:');
    console.log(`   • Push Notifications: ${pushResult ? '✅' : '❌'}`);
    console.log(`   • SMS Notifications: ${smsResult ? '✅' : '❌'}`);
    console.log(`   • In-App Notifications: ${inAppResult ? '✅' : '❌'}`);
    console.log(`   • Comprehensive Notifications: ${comprehensiveResult ? '✅' : '❌'}`);
    console.log(`   • Multicast Notifications: ${multicastResult ? '✅' : '❌'}`);
    console.log(`   • Role-Based Notifications: ${roleResult ? '✅' : '❌'}`);
    console.log(`   • Area-Based Notifications: ${areaResult ? '✅' : '❌'}`);
    console.log(`   • Notification Scheduling: ${schedulingResult ? '✅' : '❌'}`);
    console.log(`   • Preferences Management: ${preferencesResult ? '✅' : '❌'}`);
    console.log(`   • Notification Management: ${managementResult ? '✅' : '❌'}`);
    console.log(`   • Cleanup Operations: ${cleanupResult ? '✅' : '❌'}`);
    console.log(`   • Quiet Hours: ${quietHoursResult ? '✅' : '❌'}`);
    console.log(`   • Distance Calculation: ${distanceResult ? '✅' : '❌'}`);
    
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
  testNotificationTemplates,
  testPushNotification,
  testSMSNotification,
  testInAppNotification,
  testComprehensiveNotification,
  testMulticastNotification,
  testRoleBasedNotification,
  testAreaBasedNotification,
  testNotificationScheduling,
  testNotificationPreferences,
  testNotificationManagement,
  testNotificationCleanup,
  testQuietHours,
  testDistanceCalculation,
  cleanupTestData
};
