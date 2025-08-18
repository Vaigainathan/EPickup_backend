#!/usr/bin/env node

/**
 * EPickup Backend Deployment Verification Script
 * This script verifies that all endpoints and services are working after deployment
 */

const axios = require('axios');
const chalk = require('chalk');

// Configuration
const config = {
  timeout: 10000,
  retries: 3,
  delay: 1000
};

// Colors for output
const colors = {
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.blue,
  title: chalk.cyan.bold
};

// Test results
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  total: 0
};

/**
 * Print formatted output
 */
function print(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const color = colors[type] || colors.info;
  console.log(`[${timestamp}] ${color(message)}`);
}

/**
 * Sleep function for delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test endpoint with retries
 */
async function testEndpoint(url, description, expectedStatus = 200) {
  results.total++;
  
  for (let attempt = 1; attempt <= config.retries; attempt++) {
    try {
      print(`Testing ${description} (Attempt ${attempt}/${config.retries})...`, 'info');
      
      const response = await axios.get(url, {
        timeout: config.timeout,
        validateStatus: () => true // Don't throw on non-2xx status
      });
      
      if (response.status === expectedStatus) {
        print(`✅ ${description} - Status: ${response.status}`, 'success');
        results.passed++;
        return true;
      } else {
        print(`⚠️  ${description} - Expected ${expectedStatus}, got ${response.status}`, 'warning');
        if (attempt === config.retries) {
          results.warnings++;
          return false;
        }
      }
    } catch (error) {
      print(`❌ ${description} - Attempt ${attempt} failed: ${error.message}`, 'error');
      if (attempt === config.retries) {
        print(`   Final attempt failed for ${description}`, 'error');
        results.failed++;
        return false;
      }
    }
    
    if (attempt < config.retries) {
      print(`   Retrying in ${config.delay}ms...`, 'info');
      await sleep(config.delay);
    }
  }
  
  return false;
}

/**
 * Test API endpoints
 */
async function testAPIEndpoints(baseUrl) {
  print('\n🔍 Testing API Endpoints...', 'title');
  
  const endpoints = [
    { path: '/health', description: 'Health Check Endpoint', expectedStatus: 200 },
    { path: '/metrics', description: 'Metrics Endpoint', expectedStatus: 200 },
    { path: '/api-docs', description: 'API Documentation', expectedStatus: 200 }
  ];
  
  for (const endpoint of endpoints) {
    await testEndpoint(`${baseUrl}${endpoint.path}`, endpoint.description, endpoint.expectedStatus);
  }
}

/**
 * Test authentication endpoints
 */
async function testAuthEndpoints(baseUrl) {
  print('\n🔐 Testing Authentication Endpoints...', 'title');
  
  // Test auth endpoints (these might return 401 without proper auth, which is expected)
  const authEndpoints = [
    { path: '/api/auth/status', description: 'Auth Status Endpoint' },
    { path: '/api/customer/profile', description: 'Customer Profile (Auth Required)' },
    { path: '/api/driver/profile', description: 'Driver Profile (Auth Required)' }
  ];
  
  for (const endpoint of authEndpoints) {
    try {
      const response = await axios.get(`${baseUrl}${endpoint.path}`, {
        timeout: config.timeout,
        validateStatus: () => true
      });
      
      if (response.status === 401) {
        print(`✅ ${endpoint.description} - Correctly requires authentication (401)`, 'success');
        results.passed++;
      } else if (response.status === 200) {
        print(`⚠️  ${endpoint.description} - Unexpectedly accessible without auth (200)`, 'warning');
        results.warnings++;
      } else {
        print(`✅ ${endpoint.description} - Status: ${response.status}`, 'success');
        results.passed++;
      }
      results.total++;
    } catch (error) {
      print(`❌ ${endpoint.description} - Failed: ${error.message}`, 'error');
      results.failed++;
      results.total++;
    }
  }
}

/**
 * Test external service connectivity
 */
async function testExternalServices(baseUrl) {
  print('\n🌐 Testing External Service Connectivity...', 'title');
  
  try {
    // Test if the app can make external requests (this is a basic connectivity test)
    const response = await axios.get('https://httpbin.org/status/200', {
      timeout: 5000
    });
    
    if (response.status === 200) {
      print('✅ External connectivity test passed', 'success');
      results.passed++;
    } else {
      print('⚠️  External connectivity test returned unexpected status', 'warning');
      results.warnings++;
    }
    results.total++;
  } catch (error) {
    print('❌ External connectivity test failed', 'error');
    results.failed++;
    results.total++;
  }
}

/**
 * Performance test
 */
async function performanceTest(baseUrl) {
  print('\n⚡ Performance Testing...', 'title');
  
  const startTime = Date.now();
  const response = await axios.get(`${baseUrl}/health`, {
    timeout: config.timeout
  });
  const endTime = Date.now();
  const responseTime = endTime - startTime;
  
  if (responseTime < 1000) {
    print(`✅ Health endpoint response time: ${responseTime}ms (Good)`, 'success');
  } else if (responseTime < 3000) {
    print(`⚠️  Health endpoint response time: ${responseTime}ms (Acceptable)`, 'warning');
  } else {
    print(`❌ Health endpoint response time: ${responseTime}ms (Slow)`, 'error');
  }
  
  results.total++;
  results.passed++;
}

/**
 * Print summary report
 */
function printSummary() {
  print('\n📊 Deployment Verification Summary', 'title');
  print('=====================================', 'title');
  
  print(`Total Tests: ${results.total}`, 'info');
  print(`✅ Passed: ${results.passed}`, 'success');
  print(`⚠️  Warnings: ${results.warnings}`, 'warning');
  print(`❌ Failed: ${results.failed}`, 'error');
  
  const successRate = ((results.passed / results.total) * 100).toFixed(1);
  print(`\nSuccess Rate: ${successRate}%`, 'info');
  
  if (results.failed === 0 && results.warnings === 0) {
    print('\n🎉 All tests passed! Your deployment is working perfectly!', 'success');
  } else if (results.failed === 0) {
    print('\n✅ All critical tests passed! Some warnings to review.', 'success');
  } else {
    print('\n❌ Some tests failed. Please review the errors above.', 'error');
  }
  
  print('\n🔗 Your API endpoints:', 'info');
  print(`   Health Check: ${process.env.API_BASE_URL || 'https://your-app.onrender.com'}/health`, 'info');
  print(`   Metrics: ${process.env.API_BASE_URL || 'https://your-app.onrender.com'}/metrics`, 'info');
  print(`   API Docs: ${process.env.API_BASE_URL || 'https://your-app.onrender.com'}/api-docs`, 'info');
}

/**
 * Main verification function
 */
async function verifyDeployment() {
  const baseUrl = process.env.API_BASE_URL || 'https://your-app.onrender.com';
  
  print('🚀 EPickup Backend Deployment Verification', 'title');
  print('============================================', 'title');
  print(`Testing API at: ${baseUrl}`, 'info');
  print(`Timeout: ${config.timeout}ms`, 'info');
  print(`Retries: ${config.retries}`, 'info');
  
  try {
    // Wait a bit for the app to be fully ready
    print('\n⏳ Waiting for app to be ready...', 'info');
    await sleep(2000);
    
    // Run all tests
    await testAPIEndpoints(baseUrl);
    await testAuthEndpoints(baseUrl);
    await testExternalServices(baseUrl);
    await performanceTest(baseUrl);
    
    // Print summary
    printSummary();
    
  } catch (error) {
    print(`❌ Verification failed with error: ${error.message}`, 'error');
    process.exit(1);
  }
}

/**
 * Command line interface
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    print('Usage: node verify-deployment.js [options]', 'info');
    print('Options:', 'info');
    print('  --help, -h     Show this help message', 'info');
    print('  --url <url>    Set custom API base URL', 'info');
    print('  --timeout <ms> Set request timeout in milliseconds', 'info');
    print('  --retries <n>  Set number of retries', 'info');
    print('\nEnvironment Variables:', 'info');
    print('  API_BASE_URL   Base URL of your deployed API', 'info');
    return;
  }
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      process.env.API_BASE_URL = args[i + 1];
      i++;
    } else if (args[i] === '--timeout' && args[i + 1]) {
      config.timeout = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--retries' && args[i + 1]) {
      config.retries = parseInt(args[i + 1]);
      i++;
    }
  }
  
  // Run verification
  verifyDeployment();
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  verifyDeployment,
  testEndpoint,
  testAPIEndpoints,
  testAuthEndpoints,
  testExternalServices,
  performanceTest
};
