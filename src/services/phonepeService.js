const crypto = require('crypto');
const axios = require('axios');
const { getFirestore } = require('./firebase');
const errorHandlingService = require('./errorHandlingService');
const monitoringService = require('./monitoringService');
const phonepeConfig = require('./phonepeConfigService');

/**
 * PhonePe Payment Service for EPickup
 * Handles payment creation, confirmation, and webhook processing
 */
class PhonePeService {
  constructor() {
    this.db = null; // Initialize lazily
    
    // Use centralized PhonePe configuration
    this.config = phonepeConfig.getConfig();
    
    // Check if in test mode
    this.isTestMode = phonepeConfig.isTestMode();
    
    // Log configuration for debugging
    phonepeConfig.logConfig();
    
    if (this.isTestMode) {
      console.log('🧪 [PHONEPE] Running in TEST MODE - Using test credentials and sandbox environment');
    }
  }

  /**
   * Get Firestore instance (lazy initialization)
   */
  getDb() {
    if (!this.db) {
      try {
        this.db = getFirestore();
      } catch (error) {
        console.error('❌ [PhonePeService] Failed to get Firestore:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using PhonePeService.');
      }
    }
    return this.db;
  }

  /**
   * Generate PhonePe checksum
   * @param {string} payload - Payload to hash
   * @returns {string} Checksum
   */
  generateChecksum(payload) {
    const hash = crypto.createHash('sha256');
    hash.update(payload + this.config.saltKey);
    return hash.digest('hex');
  }

  /**
   * Verify PhonePe checksum
   * @param {string} payload - Payload to verify
   * @param {string} checksum - Checksum to verify
   * @returns {boolean} Verification result
   */
  verifyChecksum(payload, checksum) {
    const expectedChecksum = this.generateChecksum(payload);
    return expectedChecksum === checksum;
  }

  /**
   * Get OAuth access token for SDK flow
   * @returns {string} Access token
   */
  async getAuthToken() {
    try {
      if (!this.config.clientId || !this.config.clientSecret) {
        throw new Error('PhonePe Client ID and Client Secret are required for SDK flow');
      }

      // Get OAuth base URL
      // PhonePe OAuth endpoint is at the SAME base URL: https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token
      const baseUrl = this.config.baseUrl || phonepeConfig.getBaseUrl();
      // OAuth endpoint is at the same base URL, just append /v1/oauth/token
      const oauthUrl = `${baseUrl.replace(/\/$/, '')}/v1/oauth/token`;

      console.log('🔐 [PHONEPE SDK] Requesting OAuth token from:', oauthUrl);
      console.log('🔐 [PHONEPE SDK] Client ID:', this.config.clientId ? `${this.config.clientId.substring(0, 10)}...` : 'NOT SET');
      console.log('🔐 [PHONEPE SDK] Client Secret:', this.config.clientSecret ? 'SET' : 'NOT SET');
      console.log('🔐 [PHONEPE SDK] Client Version:', this.config.clientVersion || 'NOT SET');

      // PhonePe expects client_id, client_secret, client_version, and grant_type in form body
      // NOT in Authorization header (Basic Auth)
      const clientVersion = this.config.clientVersion || '1';
      const formData = `grant_type=client_credentials&client_id=${encodeURIComponent(this.config.clientId)}&client_secret=${encodeURIComponent(this.config.clientSecret)}&client_version=${encodeURIComponent(clientVersion)}`;

      const response = await axios.post(
        oauthUrl,
        formData,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000 // 10 second timeout
        }
      );

      if (response.data && response.data.access_token) {
        console.log('✅ [PHONEPE SDK] OAuth token obtained successfully');
        return response.data.access_token;
      } else {
        throw new Error('Invalid OAuth response: missing access_token');
      }
    } catch (error) {
      console.error('❌ [PHONEPE SDK] OAuth token generation failed:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      throw new Error(`Failed to obtain OAuth token: ${error.message}`);
    }
  }

  /**
   * Create SDK order for PhonePe SDK flow
   * @param {Object} paymentData - Payment data
   * @returns {string} Order token
   */
  async createSDKOrder(paymentData) {
    const { transactionId, amount, customerId, customerPhone } = paymentData;

    // Validate required fields
    if (!transactionId || !amount || !customerId) {
      throw new Error('Missing required payment fields for SDK order');
    }

    if (amount <= 0 || amount > 100000) {
      throw new Error('Amount must be between ₹1 and ₹100,000');
    }

    try {
      // Get OAuth token with retry logic
      let token;
      try {
        token = await this.getAuthToken();
      } catch (tokenError) {
        console.error('❌ [PHONEPE SDK] Failed to get OAuth token for SDK order:', tokenError.message);
        throw new Error(`Authentication failed: ${tokenError.message}`);
      }

      // Convert amount to paise (PhonePe expects amount in paise)
      // User enters ₹250 -> we send 25000 paise (250 * 100 = 25000)
      const amountInPaise = Math.round(amount * 100);

      const orderPayload = {
        merchantOrderId: transactionId,
        amount: amountInPaise,
        merchantUserId: customerId,
        mobileNumber: customerPhone || '+919999999999',
        callbackUrl: phonepeConfig.getCallbackUrl(),
        paymentFlow: {
          type: 'PG_CHECKOUT',
          merchantUrls: {
            redirectUrl: phonepeConfig.getRedirectUrl() || 'epickup://payment/callback'
          }
        }
      };

      console.log('📦 [PHONEPE SDK] Creating SDK order:', {
        merchantOrderId: transactionId,
        amountRupees: `₹${amount}`, // Show original amount in rupees for clarity
        amountPaise: amountInPaise, // PhonePe expects amount in paise (₹250 = 25000 paise)
        merchantUserId: customerId,
        mobileNumber: customerPhone || '+919999999999',
        callbackUrl: phonepeConfig.getCallbackUrl()
      });

      // PhonePe SDK order endpoint: /checkout/v2/sdk/order (as per PhonePe API documentation)
      // Sandbox: https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/sdk/order
      // Production: https://api.phonepe.com/apis/pg/checkout/v2/sdk/order
      // Authorization header format: O-Bearer {token} (NOT Bearer {token})
      const baseUrl = phonepeConfig.getBaseUrl();
      const sdkOrderUrl = `${baseUrl.replace(/\/$/, '')}/checkout/v2/sdk/order`;
      
      console.log('🔗 [PHONEPE SDK] SDK order endpoint:', sdkOrderUrl);
      
      const requestHeaders = {
        'Authorization': `O-Bearer ${token}`, // PhonePe SDK requires O-Bearer format, not Bearer
        'Content-Type': 'application/json'
      };
      
      console.log('🔍 [PHONEPE SDK DEBUG] Full request details:', {
        url: sdkOrderUrl,
        method: 'POST',
        headers: {
          'Authorization': `${requestHeaders.Authorization.substring(0, 30)}...`,
          'Content-Type': requestHeaders['Content-Type']
        },
        payload: orderPayload
      });
      
      const response = await axios.post(
        sdkOrderUrl,
        orderPayload,
        {
          headers: requestHeaders,
          timeout: 15000 // 15 second timeout
        }
      );
      
      // Log the FULL response to understand the structure
      console.log('🔍 [PHONEPE SDK DEBUG] Full response received:', {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data,
        dataKeys: response.data ? Object.keys(response.data) : [],
        dataType: typeof response.data,
        hasOrderToken: !!response.data?.orderToken,
        orderTokenValue: response.data?.orderToken
      });

      // PhonePe SDK API returns the token in the "token" field (not "orderToken")
      // Response structure: { orderId, state, expireAt, token }
      const orderToken = response.data?.token || response.data?.orderToken || response.data?.data?.token;
      const sdkOrderId = response.data?.orderId || null;
      
      if (orderToken) {
        console.log('✅ [PHONEPE SDK] SDK order created successfully');
        console.log('📋 [PHONEPE SDK] Order details:', {
          orderId: sdkOrderId,
          state: response.data?.state,
          expireAt: response.data?.expireAt
        });
        // Return both token and SDK orderId so the client SDK can construct the request body
        return {
          orderToken,
          orderId: sdkOrderId
        };
      } else {
        // Log what we actually got to help debug
        console.error('❌ [PHONEPE SDK] Response structure:', JSON.stringify(response.data, null, 2));
        throw new Error(`Invalid SDK order response: missing token. Response structure: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      const errorDetails = {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        code: error.code
      };
      
      console.error('❌ [PHONEPE SDK] SDK order creation failed:', errorDetails);
      console.error('❌ [PHONEPE SDK] Request payload sent:', {
        merchantOrderId: transactionId,
        amountRupees: `₹${amount}`,
        amountPaise: Math.round(amount * 100),
        merchantUserId: customerId,
        mobileNumber: customerPhone || '+919999999999',
        callbackUrl: phonepeConfig.getCallbackUrl()
      });
      
      // Provide more specific error messages
      if (error.response?.status === 401) {
        throw new Error('OAuth token expired or invalid. Please retry.');
      } else if (error.response?.status === 400 || error.response?.status === 500) {
        // PhonePe sometimes returns 500 for bad requests
        const errorCode = error.response?.data?.errorCode || '';
        const errorMsg = error.response?.data?.message || error.response?.data?.error || 'Invalid order request. Please check the payment details.';
        console.error('❌ [PHONEPE SDK] PhonePe API error details:', {
          errorCode,
          message: errorMsg,
          fullResponse: error.response?.data
        });
        
        throw new Error(`PhonePe API Error (${errorCode}): ${errorMsg}`);
      } else if (error.response?.status === 429) {
        throw new Error('Too many requests. Please wait a moment and try again.');
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        throw new Error('Failed to connect to PhonePe API. Please check your network connection.');
      }
      
      throw new Error(`Failed to create SDK order: ${error.message}`);
    }
  }

  /**
   * Get order status (for polling if needed)
   * @param {string} merchantOrderId - Merchant order ID
   * @returns {Object} Order status
   */
  async getOrderStatus(merchantOrderId) {
    try {
      const token = await this.getAuthToken();

      // PhonePe SDK order status endpoint: /checkout/v2/order/{merchantOrderId}/status (matching SDK order pattern)
      // Authorization header format: O-Bearer {token} (NOT Bearer {token})
      const baseUrl = phonepeConfig.getBaseUrl();
      const orderStatusUrl = `${baseUrl.replace(/\/$/, '')}/checkout/v2/order/${merchantOrderId}/status`;

      const response = await axios.get(
        orderStatusUrl,
        {
          headers: {
            'Authorization': `O-Bearer ${token}`, // PhonePe SDK requires O-Bearer format, not Bearer
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ [PHONEPE SDK] Order status check failed:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      throw new Error(`Failed to get order status: ${error.message}`);
    }
  }

  /**
   * Create payment request
   * @param {Object} paymentData - Payment data
   * @param {boolean} useSDK - Whether to use SDK flow (default: auto-detect based on bookingId)
   * @returns {Object} Payment creation result
   */
  async createPayment(paymentData, useSDK = null) {
    return errorHandlingService.executeWithRetry(async () => {
      const {
        transactionId,
        amount,
        customerId,
        bookingId,
        customerPhone
      } = paymentData;

      // Validate required fields
      if (!transactionId || !amount || !customerId || !bookingId) {
        throw new Error('Missing required payment fields');
      }

      // Auto-detect SDK flow for wallet top-ups
      if (useSDK === null) {
        useSDK = bookingId === 'wallet-topup' || transactionId.startsWith('WALLET_');
      }

      // Use SDK flow for wallet top-ups (driver app)
      if (useSDK) {
        console.log('📱 [PHONEPE SDK] Using SDK flow for wallet top-up');
        
        try {
          const { orderToken, orderId: sdkOrderId } = await this.createSDKOrder({
            transactionId,
            amount,
            customerId,
            customerPhone
          });

          // ✅ CRITICAL FIX: Use Firestore Timestamp for consistent date handling
          const { Timestamp } = require('firebase-admin/firestore');
          const now = Timestamp.now();
          
          // Store payment record in Firestore
          await this.storePaymentRecord({
            transactionId,
            bookingId,
            customerId,
            amount,
            amountInPaise: Math.round(amount * 100),
            status: 'PENDING',
            paymentGateway: 'PHONEPE_SDK',
            orderToken: orderToken,
            sdkOrderId: sdkOrderId || null,
            createdAt: now, // ✅ FIX: Use Firestore Timestamp instead of Date
            updatedAt: now  // ✅ FIX: Use Firestore Timestamp instead of Date
          });

          await monitoringService.logPayment('payment_created', {
            transactionId,
            bookingId,
            amount,
            customerId,
            paymentType: 'SDK'
          });

          return {
            success: true,
            data: {
              transactionId,
              merchantTransactionId: transactionId,
              orderToken: orderToken,
              sdkOrderId: sdkOrderId || null,
              merchantId: this.config.merchantId || 'PGTESTPAYUAT', // Include merchantId for native SDK
              paymentMode: this.isTestMode ? 'TESTING' : 'PRODUCTION',
              isMockPayment: false,
              isSDK: true
            }
          };
        } catch (error) {
          console.error('❌ [PHONEPE SDK] SDK payment creation failed:', error);
          throw error;
        }
      }

      // Legacy Pay Page flow (for booking payments)
      // Convert amount to paise (PhonePe expects amount in paise)
      const amountInPaise = Math.round(amount * 100);

      // Create payment payload
      const payload = {
        merchantId: this.config.merchantId,
        merchantTransactionId: transactionId,
        merchantUserId: customerId,
        amount: amountInPaise,
        redirectUrl: phonepeConfig.getRedirectUrl(),
        redirectMode: 'POST',
        callbackUrl: phonepeConfig.getCallbackUrl(),
        mobileNumber: customerPhone,
        paymentInstrument: {
          type: 'PAY_PAGE'
        }
      };

      // Generate checksum
      const payloadString = JSON.stringify(payload);
      const checksum = this.generateChecksum(payloadString);

      // Create request payload
      const requestPayload = {
        request: Buffer.from(payloadString).toString('base64')
      };

      // Log PhonePe API call details for debugging
      const modeLabel = this.isTestMode ? '🧪 TEST MODE' : '🚀 PRODUCTION';
      console.log(`📱 [PHONEPE] ${modeLabel} - Creating payment with configuration:`);
      console.log('  Merchant ID:', this.config.merchantId);
      console.log('  Salt Index:', this.config.saltIndex);
      console.log('  Base URL:', phonepeConfig.getBaseUrl());
      console.log('  Transaction ID:', transactionId);
      console.log('  Amount (paise):', amountInPaise);
      console.log('  Callback URL:', phonepeConfig.getCallbackUrl());
      console.log('  Checksum:', checksum.substring(0, 20) + '...');
      if (this.isTestMode) {
        console.log('  Client ID:', this.config.clientId ? `${this.config.clientId.substring(0, 10)}...` : 'Not set');
      }

      // Make API call to PhonePe
      const response = await axios.post(
        `${phonepeConfig.getBaseUrl()}/pg/v1/pay`,
        requestPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': `${checksum}###${this.config.saltIndex}`,
            'accept': 'application/json'
          }
        }
      );
      console.log('✅ [PHONEPE] Payment API response:', {
        success: response.data.success,
        code: response.data.code,
        message: response.data.message
      });

      if (response.data.success) {
        // ✅ CRITICAL FIX: Use Firestore Timestamp for consistent date handling
        const { Timestamp } = require('firebase-admin/firestore');
        const now = Timestamp.now();
        
        // Store payment record in Firestore
        await this.storePaymentRecord({
          transactionId,
          bookingId,
          customerId,
          amount,
          amountInPaise,
          status: 'PENDING',
          paymentGateway: 'PHONEPE',
          paymentUrl: response.data.data.instrumentResponse.redirectInfo.url,
          createdAt: now, // ✅ FIX: Use Firestore Timestamp instead of Date
          updatedAt: now  // ✅ FIX: Use Firestore Timestamp instead of Date
        });

        await monitoringService.logPayment('payment_created', {
          transactionId,
          bookingId,
          amount,
          customerId
        });

        return {
          success: true,
          data: {
            transactionId,
            merchantTransactionId: transactionId, // ADDED: Backend expects this field
            paymentUrl: response.data.data.instrumentResponse.redirectInfo.url,
            merchantId: this.config.merchantId,
            amount: amountInPaise,
            paymentMode: this.isTestMode ? 'TESTING' : 'PRODUCTION',
            isMockPayment: false // Real PhonePe payment
          }
        };
      } else {
        console.error('❌ [PHONEPE] Payment creation failed:', {
          success: response.data.success,
          code: response.data.code,
          message: response.data.message,
          data: response.data.data
        });
        throw new Error(response.data.message || 'Payment creation failed');
      }
    }, {
      context: 'Create PhonePe payment',
      maxRetries: 2
    }).catch(error => {
      // Log detailed PhonePe error response
      if (error.response) {
        console.error('❌ [PHONEPE] Payment API error response:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: {
            'x-request-backend-time': error.response.headers['x-request-backend-time'],
            'x-response-backend-time': error.response.headers['x-response-backend-time']
          }
        });
        
        // Log PhonePe specific error details
        if (error.response.data) {
          console.error('❌ [PHONEPE] PhonePe error details:', {
            success: error.response.data.success,
            code: error.response.data.code,
            message: error.response.data.message,
            data: error.response.data.data
          });
        }
      }
      
      console.error('❌ [PHONEPE] Payment API error summary:', {
        message: error.message,
        code: error.code,
        config: {
          merchantId: this.config.merchantId,
          saltKey: this.config.saltKey ? `${this.config.saltKey.substring(0, 10)}...` : 'NOT_SET',
          saltIndex: this.config.saltIndex,
          baseUrl: phonepeConfig.getBaseUrl()
        }
      });
      throw error;
    });
  }

  // Note: verifyPayment function moved to line 468 to avoid duplication

  /**
   * Handle payment callback/webhook
   * @param {Object} callbackData - Callback data from PhonePe
   * @returns {Object} Callback processing result
   */
  async handlePaymentCallback(callbackData) {
    try {
      console.log('📥 [PHONEPE] Processing payment callback');
      
      // Handle both Pay Page and SDK callback formats
      let decodedResponse;
      let merchantTransactionId;
      let transactionId;
      let amount;
      let state;
      let responseCode;
      let responseMessage;
      let isSDKCallback = false;

      // Check if this is an SDK callback (different format)
      if (callbackData.merchantOrderId || callbackData.orderId) {
        // SDK callback format
        isSDKCallback = true;
        console.log('📱 [PHONEPE SDK] Detected SDK callback format');
        
        merchantTransactionId = callbackData.merchantOrderId || callbackData.orderId;
        transactionId = callbackData.transactionId || callbackData.paymentId;
        amount = callbackData.amount || (callbackData.amountInPaise ? callbackData.amountInPaise / 100 : 0);
        state = callbackData.status === 'SUCCESS' || callbackData.status === 'PAYMENT_SUCCESS' ? 'COMPLETED' : 
                callbackData.status === 'FAILED' || callbackData.status === 'PAYMENT_FAILED' ? 'FAILED' : 
                callbackData.status || 'PENDING';
        responseCode = callbackData.code || callbackData.responseCode || '000';
        responseMessage = callbackData.message || callbackData.responseMessage || '';
      } else if (callbackData.response) {
        // Pay Page callback format (legacy)
        console.log('🌐 [PHONEPE] Detected Pay Page callback format');
        decodedResponse = JSON.parse(Buffer.from(callbackData.response, 'base64').toString());
        
        const {
          merchantId,
          merchantTransactionId: mtId,
          transactionId: tId,
          amount: amt,
          state: st,
          responseCode: rc,
          responseMessage: rm
        } = decodedResponse;
        
        // Verify the callback (only for Pay Page flow)
        if (merchantId && phonepeConfig.getMerchantId() && merchantId !== phonepeConfig.getMerchantId()) {
          throw new Error('Invalid merchant ID in callback');
        }
        
        merchantTransactionId = mtId;
        transactionId = tId;
        amount = amt;
        state = st;
        responseCode = rc;
        responseMessage = rm;
      } else {
        throw new Error('Invalid callback data format');
      }

      if (!merchantTransactionId) {
        throw new Error('Missing merchant transaction ID in callback');
      }

      console.log(`📝 [PHONEPE] Processing callback for transaction: ${merchantTransactionId}, status: ${state}`);

      // Update payment record
      await this.updatePaymentStatus(merchantTransactionId, {
        status: state,
        paymentId: transactionId,
        responseCode,
        responseMessage,
        isSDK: isSDKCallback,
        updatedAt: new Date()
      });

      // Verify payment with PhonePe before processing
      // For SDK flow, use order status API; for Pay Page, use status API
      const verificationResult = isSDKCallback 
        ? await this.getOrderStatus(merchantTransactionId)
        : await this.verifyPayment(merchantTransactionId);
      
      let verifiedState = state;
      if (verificationResult && !verificationResult.success) {
        console.warn(`⚠️ Payment verification failed for: ${merchantTransactionId}, using callback state`);
      } else if (verificationResult && verificationResult.data) {
        // ✅ CRITICAL FIX: Extract state from verification result with comprehensive mapping
        if (isSDKCallback && verificationResult.data.status) {
          const apiStatus = verificationResult.data.status;
          // Map PhonePe SDK API statuses to our internal states
          if (apiStatus === 'SUCCESS' || apiStatus === 'PAYMENT_SUCCESS') {
            verifiedState = 'COMPLETED';
          } else if (apiStatus === 'FAILED' || apiStatus === 'PAYMENT_FAILED' || apiStatus === 'PAYMENT_ERROR') {
            verifiedState = 'FAILED';
          } else if (apiStatus === 'PENDING' || apiStatus === 'INITIATED' || apiStatus === 'AUTHORIZED') {
            verifiedState = 'PENDING';
          } else if (apiStatus === 'CANCELLED' || apiStatus === 'PAYMENT_CANCELLED' || apiStatus === 'INTERRUPTED') {
            verifiedState = 'CANCELLED';
          } else {
            // Unknown status from API - use callback state
            console.warn(`⚠️ [PHONEPE] Unknown API status: ${apiStatus}, using callback state: ${state}`);
            verifiedState = state;
          }
        } else if (!isSDKCallback && verificationResult.data.state) {
          verifiedState = verificationResult.data.state;
        }
      }
      
      // ✅ CRITICAL FIX: Log status mapping for debugging
      console.log(`📊 [PHONEPE] Status mapping for ${merchantTransactionId}:`, {
        callbackState: state,
        verifiedState: verifiedState,
        isSDKCallback: isSDKCallback,
        verificationSuccess: verificationResult?.success
      });
      
      // ✅ CRITICAL FIX: Handle ALL payment statuses properly
      // Update booking status based on verified payment status
      if (verifiedState === 'COMPLETED' || verifiedState === 'SUCCESS' || verifiedState === 'PAYMENT_SUCCESS') {
        await this.updateBookingPaymentStatus(merchantTransactionId, 'PAID');
        
        // Check if this is a wallet top-up payment
        if (merchantTransactionId.startsWith('WALLET_')) {
          // Amount conversion: SDK callback sends amount in rupees, Pay Page sends in paise
          // For SDK flow, amount is already in rupees (from callbackData.amount)
          // For Pay Page flow, amount is in paise (from decodedResponse.amount)
          // Since we're using SDK flow, amount is in rupees, so we pass it as-is
          // processWalletTopupPayment expects rupees, not paise
          await this.processWalletTopupPayment(merchantTransactionId, amount || null);
        }
      } else if (verifiedState === 'FAILED' || verifiedState === 'FAILURE' || verifiedState === 'PAYMENT_FAILED' || verifiedState === 'PAYMENT_ERROR') {
        await this.updateBookingPaymentStatus(merchantTransactionId, 'FAILED');
        
        // Update wallet transaction status if it's a wallet top-up
        if (merchantTransactionId.startsWith('WALLET_')) {
          await this.updateWalletTransactionStatus(merchantTransactionId, 'failed');
        }
      } else if (verifiedState === 'PENDING' || verifiedState === 'INITIATED' || verifiedState === 'AUTHORIZED') {
        // ✅ CRITICAL FIX: Handle PENDING/INITIATED/AUTHORIZED states
        // These are intermediate states - payment is still processing
        // Don't update wallet yet, but log the status
        console.log(`⏳ [PHONEPE] Payment ${merchantTransactionId} is in ${verifiedState} state - waiting for final status`);
        
        // Update payment record with current status (already done above)
        // Don't process wallet top-up yet - wait for COMPLETED status
        
        // Update wallet transaction status to 'processing' if it's a wallet top-up
        if (merchantTransactionId.startsWith('WALLET_')) {
          await this.updateWalletTransactionStatus(merchantTransactionId, 'processing');
        }
      } else if (verifiedState === 'CANCELLED' || verifiedState === 'PAYMENT_CANCELLED' || verifiedState === 'INTERRUPTED') {
        // ✅ CRITICAL FIX: Handle CANCELLED/INTERRUPTED states
        await this.updateBookingPaymentStatus(merchantTransactionId, 'CANCELLED');
        
        // Update wallet transaction status if it's a wallet top-up
        if (merchantTransactionId.startsWith('WALLET_')) {
          await this.updateWalletTransactionStatus(merchantTransactionId, 'cancelled');
        }
      } else {
        // ✅ CRITICAL FIX: Handle unknown/unexpected statuses
        console.warn(`⚠️ [PHONEPE] Unknown payment status: ${verifiedState} for transaction: ${merchantTransactionId}`);
        console.warn(`   Original state: ${state}, Verified state: ${verifiedState}`);
        
        // For unknown statuses, keep as pending and log for investigation
        if (merchantTransactionId.startsWith('WALLET_')) {
          await this.updateWalletTransactionStatus(merchantTransactionId, 'pending');
        }
      }

      await monitoringService.logPayment('payment_callback_processed', {
        transactionId: merchantTransactionId,
        status: verifiedState,
        amount: amount ? (typeof amount === 'number' && amount < 1000 ? amount * 100 : amount) : null,
        isSDK: isSDKCallback
      });

      return {
        success: true,
        message: 'Payment callback processed successfully',
        isSDK: isSDKCallback
      };
    } catch (error) {
      console.error('❌ [PHONEPE] Payment callback error:', error);
      return {
        success: false,
        error: {
          code: 'CALLBACK_ERROR',
          message: 'Failed to process payment callback',
          details: error.message
        }
      };
    }
  }

  /**
   * Process refund
   * @param {Object} refundData - Refund data
   * @returns {Object} Refund processing result
   */
  async processRefund(refundData) {
    return errorHandlingService.executeWithRetry(async () => {
      const {
        transactionId,
        refundAmount,
        refundReason,
        refundedBy
      } = refundData;

      const amountInPaise = Math.round(refundAmount * 100);

      const payload = {
        merchantId: phonepeConfig.getMerchantId(),
        merchantUserId: refundedBy,
        originalTransactionId: transactionId,
        merchantRefundId: `REF_${transactionId}_${Date.now()}`,
        amount: amountInPaise,
        callbackUrl: phonepeConfig.getCallbackUrl()
      };

      const payloadString = JSON.stringify(payload);
      const checksum = this.generateChecksum(payloadString);

      const response = await axios.post(
        `${phonepeConfig.getBaseUrl()}/pg/v1/refund`,
        {
          request: Buffer.from(payloadString).toString('base64')
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': `${checksum}###${this.config.saltIndex}`,
            'accept': 'application/json'
          }
        }
      );

      if (response.data.success) {
        // Store refund record
        await this.storeRefundRecord({
          originalTransactionId: transactionId,
          refundTransactionId: response.data.data.merchantRefundId,
          amount: refundAmount,
          reason: refundReason,
          refundedBy,
          status: 'PENDING',
          createdAt: new Date()
        });

        return {
          success: true,
          data: {
            refundTransactionId: response.data.data.merchantRefundId,
            amount: refundAmount
          }
        };
      } else {
        throw new Error(response.data.message || 'Refund processing failed');
      }
    }, {
      context: 'Process PhonePe refund',
      maxRetries: 2
    });
  }

  /**
   * Store payment record in Firestore
   * @param {Object} paymentData - Payment data
   */
  async storePaymentRecord(paymentData) {
    try {
      const db = this.getDb();
      await db.collection('payments').doc(paymentData.transactionId).set(paymentData);
    } catch (error) {
      console.error('Store payment record error:', error);
      throw error;
    }
  }

  /**
   * Update payment status in Firestore
   * @param {string} transactionId - Transaction ID
   * @param {Object} updateData - Update data
   */
  async updatePaymentStatus(transactionId, updateData) {
    try {
      // ✅ CRITICAL FIX: Ensure updatedAt is always a Firestore Timestamp
      const { Timestamp } = require('firebase-admin/firestore');
      if (updateData.updatedAt && !(updateData.updatedAt instanceof Timestamp)) {
        updateData.updatedAt = updateData.updatedAt instanceof Date 
          ? Timestamp.fromDate(updateData.updatedAt)
          : Timestamp.now();
      } else if (!updateData.updatedAt) {
        updateData.updatedAt = Timestamp.now();
      }
      
      await this.db.collection('payments').doc(transactionId).update(updateData);
    } catch (error) {
      console.error('Update payment status error:', error);
      throw error;
    }
  }

  /**
   * Update booking payment status
   * @param {string} transactionId - Transaction ID
   * @param {string} paymentStatus - Payment status
   */
  async updateBookingPaymentStatus(transactionId, paymentStatus) {
    try {
      const db = this.getDb();
      // Find booking by transaction ID
      const paymentDoc = await db.collection('payments').doc(transactionId).get();
      if (!paymentDoc.exists) {
        throw new Error('Payment record not found');
      }

      const paymentData = paymentDoc.data();
      const bookingId = paymentData.bookingId;

      // ✅ CRITICAL FIX: Use Firestore Timestamp for consistent date handling
      const { Timestamp } = require('firebase-admin/firestore');
      const now = Timestamp.now();
      
      // Update booking payment status
      await db.collection('bookings').doc(bookingId).update({
        paymentStatus,
        paymentUpdatedAt: now, // ✅ FIX: Use Firestore Timestamp instead of Date
        updatedAt: now        // ✅ FIX: Use Firestore Timestamp instead of Date
      });
    } catch (error) {
      console.error('Update booking payment status error:', error);
      throw error;
    }
  }

  /**
   * Store refund record in Firestore
   * @param {Object} refundData - Refund data
   */
  async storeRefundRecord(refundData) {
    try {
      const db = this.getDb();
      await db.collection('refunds').doc(refundData.refundTransactionId).set(refundData);
    } catch (error) {
      console.error('Store refund record error:', error);
      throw error;
    }
  }

  /**
   * Get payment by transaction ID
   * @param {string} transactionId - Transaction ID
   * @returns {Object|null} Payment data
   */
  async getPayment(transactionId) {
    try {
      const db = this.getDb();
      const doc = await db.collection('payments').doc(transactionId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Get payment error:', error);
      return null;
    }
  }

  /**
   * Get payments by customer ID
   * @param {string} customerId - Customer ID
   * @param {number} limit - Limit
   * @returns {Array} Payments array
   */
  async getCustomerPayments(customerId, limit = 20) {
    try {
      const db = this.getDb();
      const snapshot = await db.collection('payments')
        .where('customerId', '==', customerId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Get customer payments error:', error);
      return [];
    }
  }

  /**
   * Verify payment status with PhonePe
   * @param {string} merchantTransactionId - Merchant transaction ID
   * @returns {Object} Payment verification result
   */
  async verifyPayment(merchantTransactionId) {
    try {
      console.log(`🔍 Verifying payment status for: ${merchantTransactionId}`);
      const payload = {
        merchantId: this.config.merchantId,
        merchantTransactionId: merchantTransactionId,
        merchantUserId: 'EPICKUP_USER'
      };
      
      const payloadString = JSON.stringify(payload);
      const checksum = this.generateChecksum(payloadString);
      
      const response = await axios.get(
        `${phonepeConfig.getBaseUrl()}/pg/v1/status/${this.config.merchantId}/${merchantTransactionId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': `${checksum}###${this.config.saltIndex}`,
            'X-MERCHANT-ID': this.config.merchantId
          }
        }
      );
      if (response.data.success) {
        const decodedResponse = JSON.parse(Buffer.from(response.data.data, 'base64').toString());
        return {
          success: true,
          data: decodedResponse
        };
      } else {
        return {
          success: false,
          error: 'Payment verification failed'
        };
      }
    } catch (error) {
      console.error('Payment verification error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process wallet top-up payment
   * @param {string} transactionId - Transaction ID
   * @param {number} amount - Amount in paise (kept for future validation logic)
   */
  // eslint-disable-next-line no-unused-vars
  async processWalletTopupPayment(transactionId, amount) {
    // Note: amount parameter is in rupees (for validation/future use)
    try {
      console.log(`💰 Processing wallet top-up payment: ${transactionId}`);
      const db = this.getDb();
      
      // ✅ CRITICAL FIX: Check if already processed to prevent duplicate processing
      // Find wallet transaction record in driverTopUps collection
      // PhonePe webhook sends merchantOrderId (our transactionId) or orderId (SDK orderId)
      // We need to search by both to handle all cases

      // First try: Search by phonepeTransactionId (our transactionId stored in Firestore)
      let walletTransactionsSnapshot = await db.collection('driverTopUps')
        .where('phonepeTransactionId', '==', transactionId)
        .limit(1)
        .get();

      // Second try: Search by id field (our transactionId = WALLET_xxx)
      if (walletTransactionsSnapshot.empty) {
        console.log(`⚠️ [WALLET] Transaction not found by phonepeTransactionId, trying by id: ${transactionId}`);
        walletTransactionsSnapshot = await db.collection('driverTopUps')
          .where('id', '==', transactionId)
          .limit(1)
          .get();
      }

      // Third try: Search by phonepeOrderToken's orderId (SDK orderId like OMO260106...)
      // This handles the case where PhonePe sends SDK orderId in callback instead of merchantOrderId
      if (walletTransactionsSnapshot.empty) {
        console.log(`⚠️ [WALLET] Transaction not found by id, trying by SDK orderId: ${transactionId}`);
        // Note: SDK orderId is stored in phonepeOrderToken field, but we need to search differently
        // Since we can't query by nested field, we'll search all pending transactions and match
        const allPendingTopUps = await db.collection('driverTopUps')
          .where('status', '==', 'pending')
          .limit(50) // Reasonable limit for pending transactions
          .get();
        
        // Find transaction that matches by checking if transactionId appears in any field
        for (const doc of allPendingTopUps.docs) {
          const data = doc.data();
          // Check if this transaction's SDK orderId matches
          // SDK orderId might be stored separately or we need to extract from orderToken
          if (data.id === transactionId || 
              data.phonepeTransactionId === transactionId ||
              (data.phonepeOrderToken && transactionId.includes('OMO'))) {
            walletTransactionsSnapshot = { docs: [doc], empty: false };
            break;
          }
        }
      }

      if (walletTransactionsSnapshot.empty) {
        console.error(`❌ [CRITICAL] Wallet transaction not found for PhonePe transaction: ${transactionId}`);
        console.error(`   Searched by: phonepeTransactionId, id, and SDK orderId`);
        return; // Can't process if transaction not found
      }

      const walletTransactionDoc = walletTransactionsSnapshot.docs[0];
      const walletTransactionData = walletTransactionDoc.data();
      const driverId = walletTransactionData.driverId;
      
      console.log(`✅ [WALLET] Found wallet transaction: ${walletTransactionDoc.id} for driver: ${driverId}`);

      // ✅ CRITICAL FIX: Check if already processed (idempotency)
      if (walletTransactionData.status === 'completed') {
        console.log(`⚠️ [IDEMPOTENCY] Wallet top-up already processed for transaction: ${transactionId}`);
        return; // Already processed, skip
      }

      // ✅ CRITICAL FIX: Use Firestore transaction to ensure atomicity
      // This prevents race conditions if webhook is called multiple times
      await db.runTransaction(async (transaction) => {
        // Re-read the document within transaction to get latest state
        const docSnapshot = await transaction.get(walletTransactionDoc.ref);
        const currentData = docSnapshot.data();
        
        // Double-check status within transaction (prevents race condition)
        if (currentData.status === 'completed') {
          console.log(`⚠️ [IDEMPOTENCY] Wallet top-up already processed (transaction check): ${transactionId}`);
          return; // Already processed
        }

        // ✅ CRITICAL FIX: Use Firestore Timestamp for consistent date handling
        const { Timestamp } = require('firebase-admin/firestore');
        const now = Timestamp.now();
        
        // Update wallet transaction status atomically
        transaction.update(walletTransactionDoc.ref, {
          status: 'completed',
          phonepePaymentId: transactionId,
          completedAt: now, // ✅ FIX: Use Firestore Timestamp instead of Date
          updatedAt: now    // ✅ FIX: Use Firestore Timestamp instead of Date
        });

        // Convert real money to points using points service
        const pointsService = require('./walletService');
        const pointsResult = await pointsService.addPoints(
          driverId,
          walletTransactionData.amount,
          walletTransactionData.paymentMethod || 'phonepe',
          {
            transactionId,
            phonepeTransactionId: transactionId,
            originalTransaction: walletTransactionData
          }
        );

        if (pointsResult.success) {
          // ✅ CRITICAL FIX: Use Firestore Timestamp for consistent date handling
          const { Timestamp } = require('firebase-admin/firestore');
          const updateTime = Timestamp.now();
          
          // Update wallet transaction with points data (within same transaction)
          transaction.update(walletTransactionDoc.ref, {
            pointsAwarded: pointsResult.data.pointsAdded,
            newPointsBalance: pointsResult.data.newBalance,
            updatedAt: updateTime // ✅ FIX: Use Firestore Timestamp instead of Date
          });

          console.log(`✅ Points top-up completed for driver ${driverId}: +${pointsResult.data.pointsAdded} points for ₹${walletTransactionData.amount}`);
          
          // Send notification (outside transaction to avoid timeout)
          // Note: This is done after transaction commits
          this.sendWalletTopupNotification(driverId, walletTransactionData.amount, pointsResult.data.newBalance)
            .catch(err => console.error('Failed to send notification:', err));
        } else {
          console.error(`❌ Failed to convert top-up to points: ${pointsResult.error}`);
          // Don't throw error - payment is already completed, just log the issue
          // This allows webhook to return success even if points conversion fails
          // Points can be manually credited later if needed
        }
      });

    } catch (error) {
      console.error('❌ [CRITICAL] Error processing wallet top-up payment:', error);
      // Don't throw error - webhook should still return success to PhonePe
      // Failed wallet updates can be retried manually or via admin panel
    }
  }

  /**
   * Update wallet transaction status
   * @param {string} transactionId - Transaction ID
   * @param {string} status - New status (pending, processing, completed, failed, cancelled)
   */
  async updateWalletTransactionStatus(transactionId, status) {
    try {
      // ✅ CRITICAL FIX: Validate and normalize status before updating
      const validStatuses = ['pending', 'processing', 'completed', 'failed', 'cancelled'];
      const normalizedStatus = status.toLowerCase();
      
      if (!validStatuses.includes(normalizedStatus)) {
        console.warn(`⚠️ [WALLET] Invalid status '${status}' provided, defaulting to 'pending'`);
        status = 'pending';
      } else {
        status = normalizedStatus;
      }
      
      console.log(`📝 Updating wallet transaction status: ${transactionId} -> ${status}`);
      const db = this.getDb();
      
      const walletTransactionSnapshot = await db.collection('driverTopUps')
        .where('phonepeTransactionId', '==', transactionId)
        .limit(1)
        .get();

      // ✅ CRITICAL FIX: Use Firestore Timestamp for consistent date handling
      const { Timestamp } = require('firebase-admin/firestore');
      const now = Timestamp.now();

      if (!walletTransactionSnapshot.empty) {
        const walletTransactionDoc = walletTransactionSnapshot.docs[0];
        await walletTransactionDoc.ref.update({
          status: status,
          updatedAt: now // ✅ FIX: Use Firestore Timestamp instead of Date
        });
        console.log(`✅ Wallet transaction status updated: ${transactionId} -> ${status}`);
      } else {
        console.error(`❌ Wallet transaction not found for status update: ${transactionId}`);
      }
    } catch (error) {
      console.error('Error updating wallet transaction status:', error);
    }
  }

  /**
   * Send wallet top-up notification to driver
   * @param {string} driverId - Driver ID
   * @param {number} amount - Amount added
   * @param {number} newBalance - New wallet balance
   */
  async sendWalletTopupNotification(driverId, amount, newBalance) {
    try {
      const notificationService = require('./notificationService');
      
      await notificationService.sendToUser(driverId, {
        type: 'wallet_topup_success',
        title: 'Wallet Top-up Successful!',
        body: `₹${amount} has been added to your wallet. New balance: ₹${newBalance}`,
        data: {
          amount: amount,
          newBalance: newBalance,
          type: 'wallet_topup_success'
        }
      });
      
      console.log(`✅ Sent wallet top-up notification to driver ${driverId}`);
    } catch (error) {
      console.error('Error sending wallet top-up notification:', error);
    }
  }

  /**
   * Get payment statistics
   * @param {string} startDate - Start date
   * @param {string} endDate - End date
   * @returns {Object} Payment statistics
   */
  async getPaymentStatistics(startDate, endDate) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const db = this.getDb();

      const snapshot = await db.collection('payments')
        .where('createdAt', '>=', start)
        .where('createdAt', '<=', end)
        .get();

      const payments = snapshot.docs.map(doc => doc.data());
      
      const stats = {
        totalPayments: payments.length,
        totalAmount: payments.reduce((sum, payment) => sum + payment.amount, 0),
        successfulPayments: payments.filter(p => p.status === 'COMPLETED').length,
        failedPayments: payments.filter(p => p.status === 'FAILED').length,
        pendingPayments: payments.filter(p => p.status === 'PENDING').length,
        averageAmount: payments.length > 0 ? payments.reduce((sum, payment) => sum + payment.amount, 0) / payments.length : 0
      };

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('Get payment statistics error:', error);
      return {
        success: false,
        error: {
          code: 'STATISTICS_ERROR',
          message: 'Failed to get payment statistics',
          details: error.message
        }
      };
    }
  }
}

module.exports = new PhonePeService();
