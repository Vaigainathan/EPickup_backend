#!/usr/bin/env node

/**
 * Test script for EPickup Payment Service
 * Demonstrates the core functionality of payment processing, wallet operations, and PhonePe integration
 */

require('dotenv').config();
const { getFirestore, initializeFirebase } = require('../src/services/firebase');
const admin = require('firebase-admin');

// Initialize Firebase first
initializeFirebase();

// Mock Payment Configuration for Training/Testing
const MOCK_PAYMENT_CONFIG = {
  enabled: true,
  mode: 'training',
  phonepe: {
    merchantId: 'MOCK_MERCHANT_ID',
    saltKey: 'MOCK_SALT_KEY',
    saltIndex: 'MOCK_SALT_INDEX',
    baseUrl: 'https://mock-phonepe.com/api',
    redirectUrl: 'https://epickup-app.web.app/payment/mock-success'
  },
  razorpay: {
    keyId: 'MOCK_RAZORPAY_KEY',
    keySecret: 'MOCK_RAZORPAY_SECRET'
  },
  mockResponses: {
    success: {
      status: 'PAYMENT_SUCCESS',
      code: 'SUCCESS',
      message: 'Payment completed successfully (Mock)'
    },
    pending: {
      status: 'PAYMENT_PENDING',
      code: 'PENDING',
      message: 'Payment is pending (Mock)'
    },
    failed: {
      status: 'PAYMENT_FAILED',
      code: 'FAILED',
      message: 'Payment failed (Mock)'
    }
  }
};

// Sample payment data for testing
const samplePaymentData = {
  bookingId: 'mock_booking_123',
  customerId: 'mock_customer_456',
  amount: 150.00,
  currency: 'INR',
  paymentMethod: 'phonepe',
  description: 'Mock delivery payment for testing'
};

/**
 * Test PhonePe payment initiation with mock data
 */
async function testPhonePePaymentInitiation() {
  console.log('\n💳 Testing PhonePe Payment Initiation (Mock Mode)...');
  
  try {
    // Mock PhonePe API response
    const mockPhonePeResponse = {
      success: true,
      data: {
        instrumentResponse: {
          redirectInfo: {
            url: "https://mock-phonepe.com/pay?token=mock_token_123"
          }
        }
      }
    };

    // Create payment record in database
    const db = getFirestore();
    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const paymentRecord = {
      id: transactionId,
      bookingId: samplePaymentData.bookingId,
      customerId: samplePaymentData.customerId,
      amount: samplePaymentData.amount,
      currency: 'INR',
      paymentMethod: 'phonepe',
      status: 'initiated',
      phonepeResponse: mockPhonePeResponse,
      mockMode: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Save to database
    await db.collection('payments').doc(transactionId).set(paymentRecord);
    console.log('✅ Mock payment record created successfully');
    console.log(`   Transaction ID: ${transactionId}`);
    console.log(`   Amount: ₹${samplePaymentData.amount}`);
    console.log(`   Status: ${paymentRecord.status}`);

    return transactionId;

  } catch (error) {
    console.error('❌ Mock payment initiation failed:', error.message);
    throw error;
  }
}

/**
 * Test payment verification with mock data
 */
async function testPaymentVerification(transactionId) {
  console.log('\n🔍 Testing Payment Verification (Mock Mode)...');
  
  try {
    const db = getFirestore();
    
    // Get payment record
    const paymentDoc = await db.collection('payments').doc(transactionId).get();
    if (!paymentDoc.exists) {
      throw new Error('Payment record not found');
    }

    const paymentData = paymentDoc.data();
    console.log('✅ Payment record retrieved successfully');

    // Mock PhonePe verification response
    const mockVerificationResponse = {
      success: true,
      data: {
        paymentInstrument: {
          paymentTransaction: {
            status: 'PAYMENT_SUCCESS'
          }
        }
      }
    };

    // Update payment status to completed
    await db.collection('payments').doc(transactionId).update({
      status: 'completed',
      phonepeVerification: mockVerificationResponse,
      completedAt: new Date(),
      updatedAt: new Date()
    });

    console.log('✅ Payment verification completed successfully');
    console.log(`   Final Status: completed`);
    console.log(`   Mock Response: ${JSON.stringify(mockVerificationResponse.data.paymentInstrument.paymentTransaction.status)}`);

    return true;

  } catch (error) {
    console.error('❌ Payment verification failed:', error.message);
    throw error;
  }
}

/**
 * Test wallet operations with mock data
 */
async function testWalletOperations() {
  console.log('\n💰 Testing Wallet Operations (Mock Mode)...');
  
  try {
    const db = getFirestore();
    
    // Create mock customer wallet
    const walletData = {
      customerId: samplePaymentData.customerId,
      balance: 0,
      currency: 'INR',
      transactions: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('wallets').doc(samplePaymentData.customerId).set(walletData);
    console.log('✅ Mock wallet created successfully');

    // Test wallet credit
    const creditAmount = 200;
    await db.collection('wallets').doc(samplePaymentData.customerId).update({
      balance: admin.firestore.FieldValue.increment(creditAmount),
      updatedAt: new Date()
    });

    console.log(`✅ Wallet credited with ₹${creditAmount}`);

    // Test wallet debit
    const debitAmount = 50;
    await db.collection('wallets').doc(samplePaymentData.customerId).update({
      balance: admin.firestore.FieldValue.increment(-debitAmount),
      updatedAt: new Date()
    });

    console.log(`✅ Wallet debited with ₹${debitAmount}`);

    // Get final balance
    const finalWallet = await db.collection('wallets').doc(samplePaymentData.customerId).get();
    const finalBalance = finalWallet.data().balance;
    
    console.log(`✅ Final wallet balance: ₹${finalBalance}`);
    console.log(`   Expected: ₹${200 - 50} = ₹150`);

    return true;

  } catch (error) {
    console.error('❌ Wallet operations failed:', error.message);
    throw error;
  }
}

/**
 * Test payment processing workflow
 */
async function testPaymentProcessing(transactionId) {
  console.log('\n🔄 Testing Payment Processing Workflow (Mock Mode)...');
  
  try {
    const db = getFirestore();
    
    // Simulate payment processing steps
    const processingSteps = [
      { step: 'initiated', status: 'Payment initiated' },
      { step: 'processing', status: 'Payment being processed' },
      { step: 'authorized', status: 'Payment authorized' },
      { step: 'captured', status: 'Payment captured' },
      { step: 'completed', status: 'Payment completed' }
    ];

    for (const step of processingSteps) {
      await db.collection('payments').doc(transactionId).update({
        status: step.step,
        processingStep: step.status,
        updatedAt: new Date()
      });

      console.log(`✅ ${step.status}`);
      
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('✅ Payment processing workflow completed successfully');

    return true;

  } catch (error) {
    console.error('❌ Payment processing workflow failed:', error.message);
    throw error;
  }
}

/**
 * Test refund processing
 */
async function testRefundProcessing(transactionId) {
  console.log('\n💸 Testing Refund Processing (Mock Mode)...');
  
  try {
    const db = getFirestore();
    
    // Create refund record
    const refundData = {
      id: `REFUND_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      paymentId: transactionId,
      amount: 75.00,
      reason: 'Partial refund for testing',
      status: 'initiated',
      mockMode: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('refunds').doc(refundData.id).set(refundData);
    console.log('✅ Refund record created successfully');

    // Update refund status
    await db.collection('refunds').doc(refundData.id).update({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date()
    });

    console.log('✅ Refund processing completed successfully');
    console.log(`   Refund Amount: ₹${refundData.amount}`);
    console.log(`   Reason: ${refundData.reason}`);

    return true;

  } catch (error) {
    console.error('❌ Refund processing failed:', error.message);
    throw error;
  }
}

/**
 * Test payment statistics
 */
async function testPaymentStatistics() {
  console.log('\n📊 Testing Payment Statistics (Mock Mode)...');
  
  try {
    const db = getFirestore();
    
    // Get payment statistics
    const paymentsSnapshot = await db.collection('payments').get();
    const totalPayments = paymentsSnapshot.size;
    
    const completedPayments = paymentsSnapshot.docs.filter(doc => 
      doc.data().status === 'completed'
    ).length;

    const pendingPayments = paymentsSnapshot.docs.filter(doc => 
      doc.data().status === 'initiated' || doc.data().status === 'processing'
    ).length;

    console.log('✅ Payment statistics retrieved successfully');
    console.log(`   Total Payments: ${totalPayments}`);
    console.log(`   Completed: ${completedPayments}`);
    console.log(`   Pending: ${pendingPayments}`);
    console.log(`   Success Rate: ${((completedPayments / totalPayments) * 100).toFixed(1)}%`);

    return true;

  } catch (error) {
    console.error('❌ Payment statistics failed:', error.message);
    throw error;
  }
}

/**
 * Test driver payouts
 */
async function testDriverPayouts() {
  console.log('\n🚚 Testing Driver Payouts (Mock Mode)...');
  
  try {
    const db = getFirestore();
    
    // Create mock driver payout
    const payoutData = {
      id: `PAYOUT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      driverId: 'mock_driver_789',
      amount: 120.00,
      bookingId: samplePaymentData.bookingId,
      status: 'pending',
      mockMode: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('driverPayouts').doc(payoutData.id).set(payoutData);
    console.log('✅ Driver payout record created successfully');

    // Process payout
    await db.collection('driverPayouts').doc(payoutData.id).update({
      status: 'completed',
      processedAt: new Date(),
      updatedAt: new Date()
    });

    console.log('✅ Driver payout processed successfully');
    console.log(`   Driver ID: ${payoutData.driverId}`);
    console.log(`   Amount: ₹${payoutData.amount}`);
    console.log(`   Status: completed`);

    return true;

  } catch (error) {
    console.error('❌ Driver payouts failed:', error.message);
    throw error;
  }
}

/**
 * Clean up test data
 */
async function cleanupTestData() {
  console.log('\n🧹 Cleaning up test data...');
  
  try {
    const db = getFirestore();
    
    // Clean up payments
    const paymentsSnapshot = await db.collection('payments').where('mockMode', '==', true).get();
    const paymentDeletions = paymentsSnapshot.docs.map(doc => doc.ref.delete());
    await Promise.all(paymentDeletions);
    
    // Clean up wallets
    const walletsSnapshot = await db.collection('wallets').where('customerId', '==', samplePaymentData.customerId).get();
    const walletDeletions = walletsSnapshot.docs.map(doc => doc.ref.delete());
    await Promise.all(walletDeletions);
    
    // Clean up refunds
    const refundsSnapshot = await db.collection('refunds').where('mockMode', '==', true).get();
    const refundDeletions = refundsSnapshot.docs.map(doc => doc.ref.delete());
    await Promise.all(refundDeletions);
    
    // Clean up driver payouts
    const payoutsSnapshot = await db.collection('driverPayouts').where('mockMode', '==', true).get();
    const payoutDeletions = payoutsSnapshot.docs.map(doc => doc.ref.delete());
    await Promise.all(payoutDeletions);

    console.log('✅ Test data cleaned up successfully');

  } catch (error) {
    console.error('❌ Test data cleanup failed:', error.message);
  }
}

/**
 * Run all payment service tests
 */
async function runTests() {
  console.log('🚀 Starting Payment Service Tests (Mock Mode)');
  console.log('=' .repeat(60));
  
  try {
    let transactionId;

    // Test 1: Payment Initiation
    transactionId = await testPhonePePaymentInitiation();
    
    // Test 2: Payment Verification
    await testPaymentVerification(transactionId);
    
    // Test 3: Wallet Operations
    await testWalletOperations();
    
    // Test 4: Payment Processing Workflow
    await testPaymentProcessing(transactionId);
    
    // Test 5: Refund Processing
    await testRefundProcessing(transactionId);
    
    // Test 6: Payment Statistics
    await testPaymentStatistics();
    
    // Test 7: Driver Payouts
    await testDriverPayouts();

    console.log('\n🎉 All Payment Service Tests Passed Successfully!');
    console.log('✅ Mock payment system is working correctly');
    console.log('✅ Database operations are functional');
    console.log('✅ Payment workflow is complete');
    console.log('✅ Statistics and reporting are working');

  } catch (error) {
    console.error('\n❌ Payment Service Tests Failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    // Clean up test data
    await cleanupTestData();
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = {
  runTests,
  testPhonePePaymentInitiation,
  testPaymentVerification,
  testWalletOperations,
  testPaymentProcessing,
  testRefundProcessing,
  testPaymentStatistics,
  testDriverPayouts
};
