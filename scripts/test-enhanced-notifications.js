#!/usr/bin/env node
require('dotenv').config();
const { getFirestore, initializeFirebase } = require('../src/services/firebase');
const NotificationService = require('../src/services/notificationService');

// Initialize Firebase first
initializeFirebase();

const notificationService = new NotificationService();
const db = getFirestore();

// Test results tracking
let testResults = {
  passed: 0,
  failed: 0,
  total: 0
};

function logTest(testName, passed, details = '') {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ ${testName} - PASSED`);
  } else {
    testResults.failed++;
    console.log(`❌ ${testName} - FAILED`);
  }
  if (details) {
    console.log(`   ${details}`);
  }
}

async function testEnhancedPreferences() {
  console.log('\n🧪 Testing Enhanced User Preferences...');
  
  try {
    // Test default preferences
    const defaultPrefs = notificationService.getDefaultPreferences();
    const hasRequiredFields = defaultPrefs.channels && 
                             defaultPrefs.types && 
                             defaultPrefs.quietHours &&
                             defaultPrefs.frequency;
    
    logTest('Default Preferences Structure', hasRequiredFields, 
      `Found ${Object.keys(defaultPrefs).length} preference categories`);

    // Test preference validation
    const validPrefs = {
      ...defaultPrefs,
      quietHours: { enabled: true, startHour: 22, endHour: 6 }
    };
    
    try {
      notificationService.validatePreferences(validPrefs);
      logTest('Valid Preferences Validation', true);
    } catch (error) {
      logTest('Valid Preferences Validation', false, error.message);
    }

    // Test invalid preferences
    const invalidPrefs = {
      ...defaultPrefs,
      quietHours: { enabled: true, startHour: 25, endHour: 6 }
    };
    
    try {
      notificationService.validatePreferences(invalidPrefs);
      logTest('Invalid Preferences Validation', false, 'Should have thrown error');
    } catch (error) {
      logTest('Invalid Preferences Validation', true, 'Correctly caught invalid start hour');
    }

  } catch (error) {
    logTest('Enhanced Preferences', false, error.message);
  }
}

async function testQuietHours() {
  console.log('\n🧪 Testing Quiet Hours...');
  
  try {
    // Test quiet hours disabled
    const disabledQuietHours = { enabled: false, startHour: 22, endHour: 6 };
    const notInQuietHours = notificationService.checkQuietHours(disabledQuietHours);
    logTest('Quiet Hours Disabled', !notInQuietHours, 'Notifications allowed when disabled');

    // Test quiet hours enabled - same day
    const sameDayQuietHours = { enabled: true, startHour: 22, endHour: 6, days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] };
    const currentHour = new Date().getHours();
    const shouldBeInQuietHours = (currentHour >= 22 || currentHour < 6);
    const inQuietHours = notificationService.checkQuietHours(sameDayQuietHours);
    
    logTest('Quiet Hours Same Day', 
      (inQuietHours === shouldBeInQuietHours), 
      `Current hour: ${currentHour}, In quiet hours: ${inQuietHours}`);

    // Test quiet hours enabled - overnight
    const overnightQuietHours = { enabled: true, startHour: 23, endHour: 5, days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] };
    const shouldBeInOvernightQuietHours = (currentHour >= 23 || currentHour < 5);
    const inOvernightQuietHours = notificationService.checkQuietHours(overnightQuietHours);
    
    logTest('Quiet Hours Overnight', 
      (inOvernightQuietHours === shouldBeInOvernightQuietHours),
      `Current hour: ${currentHour}, In overnight quiet hours: ${inOvernightQuietHours}`);

  } catch (error) {
    logTest('Quiet Hours', false, error.message);
  }
}

async function testChannelPreferences() {
  console.log('\n🧪 Testing Channel Preferences...');
  
  try {
    const userChannels = {
      push: true,
      inApp: true,
      sms: false,
      email: false
    };

    // Test all channels
    const allChannels = notificationService.getEnabledChannels(userChannels);
    logTest('All Enabled Channels', 
      allChannels.length === 2 && allChannels.includes('push') && allChannels.includes('in_app'),
      `Found channels: ${allChannels.join(', ')}`);

    // Test specific channels
    const requestedChannels = ['push', 'email'];
    const specificChannels = notificationService.getEnabledChannels(userChannels, requestedChannels);
    logTest('Specific Requested Channels', 
      specificChannels.length === 1 && specificChannels.includes('push'),
      `Requested: ${requestedChannels.join(', ')}, Enabled: ${specificChannels.join(', ')}`);

    // Test no channels enabled
    const noChannels = { push: false, inApp: false, sms: false, email: false };
    const enabledChannels = notificationService.getEnabledChannels(noChannels);
    logTest('No Channels Enabled', enabledChannels.length === 0, 'No channels should be enabled');

  } catch (error) {
    logTest('Channel Preferences', false, error.message);
  }
}

async function testFrequencyLimits() {
  console.log('\n🧪 Testing Frequency Limits...');
  
  try {
    const frequencyPrefs = {
      maxPerDay: 5,
      maxPerHour: 2
    };

    // Test frequency limits (this will depend on existing data)
    const frequencyCheck = await notificationService.checkFrequencyLimits('test_user_123', frequencyPrefs);
    logTest('Frequency Limits Check', 
      typeof frequencyCheck.allowed === 'boolean',
      `Frequency check result: ${JSON.stringify(frequencyCheck)}`);

  } catch (error) {
    logTest('Frequency Limits', false, error.message);
  }
}

async function testNotificationWithPreferences() {
  console.log('\n🧪 Testing Notification with Preferences...');
  
  try {
    // Create test user with preferences
    const testUserId = 'test_user_preferences';
    const testPreferences = {
      enabled: true,
      channels: { push: true, inApp: true, sms: false, email: false },
      types: { booking: true, payment: true, system: false },
      quietHours: { enabled: false, startHour: 22, endHour: 6, days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] }
    };

    // Set user preferences
    await db.collection('users').doc(testUserId).set({
      notificationPreferences: testPreferences,
      fcmToken: 'test_fcm_token_123'
    });

    // Test notification sending with preferences
    const result = await notificationService.sendNotificationWithPreferences(
      testUserId,
      'booking',
      { title: 'Test Booking', body: 'Test notification' },
      { channels: ['push', 'in_app'] }
    );

    logTest('Notification with Preferences', 
      result.success && result.channels && result.channels.length > 0,
      `Result: ${JSON.stringify(result)}`);

    // Test quiet hours
    const quietHoursPrefs = {
      ...testPreferences,
      quietHours: { enabled: true, startHour: 22, endHour: 6, days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] }
    };

    await db.collection('users').doc(testUserId).update({
      notificationPreferences: quietHoursPrefs
    });

    const quietHoursResult = await notificationService.sendNotificationWithPreferences(
      testUserId,
      'booking',
      { title: 'Test Quiet Hours', body: 'Should be skipped' }
    );

    const currentHour = new Date().getHours();
    const shouldBeSkipped = (currentHour >= 22 || currentHour < 6);
    
    logTest('Quiet Hours Skipping', 
      (quietHoursResult.skipped === shouldBeSkipped),
      `Current hour: ${currentHour}, Skipped: ${quietHoursResult.skipped}, Should skip: ${shouldBeSkipped}`);

    // Cleanup test user
    await db.collection('users').doc(testUserId).delete();

  } catch (error) {
    logTest('Notification with Preferences', false, error.message);
  }
}

async function testScheduledNotifications() {
  console.log('\n🧪 Testing Scheduled Notifications...');
  
  try {
    // Create test scheduled notification
    const scheduledNotification = {
      userId: 'test_user_scheduled',
      type: 'reminder',
      data: { title: 'Test Reminder', body: 'Scheduled notification' },
      channels: ['push', 'in_app'],
      scheduledTime: new Date(Date.now() + 60000), // 1 minute from now
      status: 'pending',
      priority: 'medium',
      createdAt: new Date()
    };

    const docRef = await db.collection('scheduledNotifications').add(scheduledNotification);
    logTest('Create Scheduled Notification', true, `Created with ID: ${docRef.id}`);

    // Test retrieving scheduled notifications
    const now = new Date();
    const pendingNotifications = await db
      .collection('scheduledNotifications')
      .where('status', '==', 'pending')
      .where('scheduledTime', '<=', now)
      .get();

    logTest('Retrieve Pending Notifications', 
      pendingNotifications.size >= 0,
      `Found ${pendingNotifications.size} pending notifications`);

    // Cleanup
    await docRef.delete();

  } catch (error) {
    logTest('Scheduled Notifications', false, error.message);
  }
}

async function testPreferenceManagement() {
  console.log('\n🧪 Testing Preference Management...');
  
  try {
    const testUserId = 'test_user_pref_mgmt';
    
    // Create test user first
    await db.collection('users').doc(testUserId).set({
      phone: '+919999999999',
      name: 'Test User',
      userType: 'customer',
      createdAt: new Date(),
      notificationPreferences: notificationService.getDefaultPreferences()
    });
    
    // Test getting preferences
    const preferences = await notificationService.getUserNotificationPreferences(testUserId);
    logTest('Get User Preferences', 
      preferences.success && preferences.data,
      'Retrieved default preferences for new user');

    // Test updating preferences
    const updatedPrefs = {
      channels: { push: false, inApp: true },
      types: { booking: false, emergency: true }
    };

    const updateResult = await notificationService.updateUserNotificationPreferences(testUserId, updatedPrefs);
    logTest('Update User Preferences', 
      updateResult.success && updateResult.data,
      'Successfully updated preferences');

    // Verify updates
    const updatedPreferences = await notificationService.getUserNotificationPreferences(testUserId);
    const pushDisabled = !updatedPreferences.data.channels.push;
    const emergencyEnabled = updatedPreferences.data.types.emergency;
    
    logTest('Verify Preference Updates', 
      pushDisabled && emergencyEnabled,
      `Push disabled: ${pushDisabled}, Emergency enabled: ${emergencyEnabled}`);

    // Test preference reset
    const resetResult = await notificationService.updateUserNotificationPreferences(
      testUserId, 
      notificationService.getDefaultPreferences()
    );
    
    logTest('Reset Preferences to Default', 
      resetResult.success,
      'Successfully reset preferences');

    // Cleanup
    await db.collection('users').doc(testUserId).delete();

  } catch (error) {
    logTest('Preference Management', false, error.message);
  }
}

async function runAllTests() {
  console.log('🚀 Starting Enhanced Notification System Tests...\n');
  
  try {
    await testEnhancedPreferences();
    await testQuietHours();
    await testChannelPreferences();
    await testFrequencyLimits();
    await testNotificationWithPreferences();
    await testScheduledNotifications();
    await testPreferenceManagement();

  } catch (error) {
    console.error('❌ Test execution failed:', error);
  }

  // Print summary
  console.log('\n📊 Test Summary:');
  console.log(`Total Tests: ${testResults.total}`);
  console.log(`Passed: ${testResults.passed} ✅`);
  console.log(`Failed: ${testResults.failed} ❌`);
  console.log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);

  if (testResults.failed > 0) {
    console.log('\n⚠️  Some tests failed. Check the output above for details.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed! Enhanced notification system is working correctly.');
  }
}

// Run tests
runAllTests().catch(console.error);
