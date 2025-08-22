#!/usr/bin/env node

/**
 * Security Validation Script
 * Scans the codebase for hardcoded sensitive values and validates environment configuration
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logHeader(message) {
  log('\n' + '='.repeat(60), 'cyan');
  log(`  ${message}`, 'cyan');
  log('='.repeat(60), 'cyan');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

// Patterns to detect sensitive values
const SENSITIVE_PATTERNS = {
  // API Keys
  googleMapsApiKey: /AIzaSy[A-Za-z0-9_-]{35}/g,
  firebaseApiKey: /AIzaSy[A-Za-z0-9_-]{35}/g,
  
  // Private Keys
  privateKey: /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g,
  rsaPrivateKey: /-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/g,
  
  // JWT Secrets (long hex strings)
  jwtSecret: /[a-f0-9]{64,}/g,
  
  // Database URLs with passwords
  databaseUrl: /(mongodb|postgresql|mysql):\/\/[^:]+:[^@]+@/g,
  redisUrl: /redis:\/\/[^:]+:[^@]+@/g,
  
  // Payment Gateway Keys
  phonepeSaltKey: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g,
  
  // Sentry DSN
  sentryDsn: /https:\/\/[a-f0-9]+@[a-z0-9.-]+\.[a-z]{2,}\/[0-9]+/g,
  
  // Email addresses in service accounts
  serviceAccountEmail: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
};

// Files to scan
const SCAN_PATTERNS = [
  '**/*.js',
  '**/*.ts',
  '**/*.json',
  '**/*.env*'
];

// Files to exclude
const EXCLUDE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '*.log',
  'package-lock.json',
  'yarn.lock'
];

function scanFile(filePath) {
  const issues = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(process.cwd(), filePath);
    
    // Check each sensitive pattern
    Object.entries(SENSITIVE_PATTERNS).forEach(([type, pattern]) => {
      const matches = content.match(pattern);
      if (matches) {
        issues.push({
          file: relativePath,
          type: type,
          matches: matches.length,
          severity: 'HIGH'
        });
      }
    });
    
    // Check for hardcoded environment variable fallbacks
    const envFallbackPattern = /process\.env\.[A-Z_]+.*\|\|.*["'][A-Za-z0-9@._-]{20,}["']/g;
    const envFallbacks = content.match(envFallbackPattern);
    if (envFallbacks) {
      issues.push({
        file: relativePath,
        type: 'hardcoded_env_fallback',
        matches: envFallbacks.length,
        severity: 'HIGH'
      });
    }
    
  } catch (error) {
    logError(`Failed to scan file ${filePath}: ${error.message}`);
  }
  
  return issues;
}

function validateEnvironmentVariables() {
  logHeader('Validating Environment Variables');
  
  const requiredVars = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
    'JWT_SECRET',
    'SESSION_SECRET',
    'GOOGLE_MAPS_API_KEY',
    'SENTRY_DSN'
  ];
  
  const missing = [];
  const placeholder = [];
  
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (!value) {
      missing.push(varName);
    } else if (value.includes('your-') || value === 'placeholder') {
      placeholder.push(varName);
    }
  });
  
  if (missing.length > 0) {
    logError(`Missing required environment variables: ${missing.join(', ')}`);
  } else {
    logSuccess('All required environment variables are set');
  }
  
  if (placeholder.length > 0) {
    logWarning(`Environment variables with placeholder values: ${placeholder.join(', ')}`);
  }
  
  return { missing, placeholder };
}

function generateSecureSecrets() {
  logHeader('Generating Secure Secrets');
  
  const secrets = {
    jwtSecret: crypto.randomBytes(64).toString('hex'),
    sessionSecret: crypto.randomBytes(64).toString('hex')
  };
  
  logInfo('Generated secure secrets:');
  log(`JWT_SECRET: ${secrets.jwtSecret}`, 'magenta');
  log(`SESSION_SECRET: ${secrets.sessionSecret}`, 'magenta');
  
  return secrets;
}

function scanCodebase() {
  logHeader('Scanning Codebase for Hardcoded Sensitive Values');
  
  const issues = [];
  const projectRoot = process.cwd();
  
  function scanDirectory(dir) {
    try {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        // Skip excluded patterns
        const relativePath = path.relative(projectRoot, fullPath);
        const shouldExclude = EXCLUDE_PATTERNS.some(pattern => {
          const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
          return regex.test(relativePath);
        });
        
        if (shouldExclude) continue;
        
        if (stat.isDirectory()) {
          scanDirectory(fullPath);
        } else if (stat.isFile()) {
          const fileIssues = scanFile(fullPath);
          issues.push(...fileIssues);
        }
      }
    } catch (error) {
      logError(`Failed to scan directory ${dir}: ${error.message}`);
    }
  }
  
  scanDirectory(projectRoot);
  
  if (issues.length === 0) {
    logSuccess('No hardcoded sensitive values found in codebase');
  } else {
    logError(`Found ${issues.length} potential security issues:`);
    issues.forEach(issue => {
      log(`  - ${issue.file}: ${issue.type} (${issue.matches} matches)`, 'red');
    });
  }
  
  return issues;
}

function checkGitignore() {
  logHeader('Checking .gitignore Configuration');
  
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  
  if (!fs.existsSync(gitignorePath)) {
    logError('.gitignore file not found');
    return false;
  }
  
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  const requiredPatterns = ['.env', '.env.local', '.env.production'];
  
  const missing = requiredPatterns.filter(pattern => {
    return !gitignoreContent.includes(pattern);
  });
  
  if (missing.length > 0) {
    logError(`Missing .gitignore patterns: ${missing.join(', ')}`);
    return false;
  } else {
    logSuccess('.gitignore properly configured for environment files');
    return true;
  }
}

function main() {
  logHeader('EPickup Backend Security Validation');
  
  const results = {
    envValidation: validateEnvironmentVariables(),
    codebaseIssues: scanCodebase(),
    gitignoreValid: checkGitignore(),
    secureSecrets: generateSecureSecrets()
  };
  
  logHeader('Security Validation Summary');
  
  const totalIssues = results.envValidation.missing.length + 
                     results.envValidation.placeholder.length + 
                     results.codebaseIssues.length;
  
  if (totalIssues === 0 && results.gitignoreValid) {
    logSuccess('🎉 All security checks passed!');
    logInfo('Your backend is properly configured for secure deployment.');
  } else {
    logError(`Found ${totalIssues} security issues that need to be addressed.`);
    logInfo('Please review the issues above and fix them before deployment.');
  }
  
  logHeader('Next Steps');
  logInfo('1. Add the generated secrets to your environment variables');
  logInfo('2. Set up environment variables in your hosting platform (Render, Heroku, etc.)');
  logInfo('3. Never commit .env files to version control');
  logInfo('4. Regularly rotate API keys and secrets');
  logInfo('5. Monitor for security vulnerabilities in dependencies');
  
  return results;
}

// Run the validation if this script is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  validateEnvironmentVariables,
  scanCodebase,
  checkGitignore,
  generateSecureSecrets,
  main
};
