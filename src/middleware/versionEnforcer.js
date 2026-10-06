/**
 * Version Enforcement Middleware
 * 
 * This middleware enforces version policies on all mobile API requests.
 * It checks the X-App-Version and X-App-Type headers against Firestore configuration
 * and blocks outdated versions from accessing protected APIs.
 * 
 * Features:
 * - Graceful degradation (missing headers allowed during transition)
 * - Firestore-driven policy (current/minimum/updateType)
 * - Semantic version comparison
 * - Detailed 426 responses for client-side error handling
 * - Bypass for admin and system requests
 * 
 * @module versionEnforcer
 */

const { getFirestore } = require('../services/firebase');

/**
 * Compare semantic versions
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  if (!v1 || !v2) return 0;
  
  const parse = (v) => {
    const parts = v.split('.').map(p => parseInt(p, 10));
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0
    };
  };
  
  const a = parse(v1);
  const b = parse(v2);
  
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Decide allow or block from a stored app policy and the request version.
 * updateType defaults to 'optional' only when the field is missing.
 */
function evaluateVersionPolicy(policy, appVersion) {
  if (!policy || !policy.current || !policy.minimum) {
    return { action: 'allow' };
  }

  const { current, minimum, updateType = 'optional' } = policy;

  if (compareVersions(appVersion, minimum) < 0) {
    return { action: 'block', status: 426, code: 'VERSION_TOO_OLD' };
  }

  if (compareVersions(appVersion, current) < 0 && updateType === 'mandatory') {
    return { action: 'block', status: 426, code: 'UPDATE_REQUIRED' };
  }

  if (compareVersions(appVersion, current) < 0 && updateType === 'optional') {
    return { action: 'allow', reason: 'optional_update' };
  }

  return { action: 'allow' };
}

/**
 * Get version config from Firestore (with caching)
 */
let versionConfigCache = null;
let versionConfigCacheTime = 0;
let versionConfigCacheValid = false;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getVersionConfig() {
  const now = Date.now();
  
  // Return cached config if still valid. A cached null means the document was missing.
  if (versionConfigCacheValid && (now - versionConfigCacheTime) < CACHE_TTL) {
    return versionConfigCache;
  }
  
  try {
    const db = getFirestore();
    if (!db) {
      console.warn('⚠️ [VersionEnforcer] Firestore not initialized, allowing request (grace mode)');
      return null;
    }
    
    const doc = await db.collection('appSettings').doc('versions').get();
    
    if (!doc.exists) {
      console.warn('⚠️ [VersionEnforcer] appSettings/versions document not found, allowing request (grace mode)');
      versionConfigCache = null;
      versionConfigCacheTime = now;
      versionConfigCacheValid = true;
      return null;
    }
    
    const config = doc.data();
    
    // Cache the config
    versionConfigCache = config;
    versionConfigCacheTime = now;
    versionConfigCacheValid = true;
    
    return config;
  } catch (error) {
    console.error('❌ [VersionEnforcer] Error fetching version config:', error.message);
    // Fail open: allow request if we can't read Firestore. Do not cache the error.
    return null;
  }
}

/**
 * Version Enforcement Middleware
 * 
 * Routes that skip version enforcement:
 * - /health (public health check)
 * - /metrics (public metrics)
 * - /api/auth/* (auth doesn't need version check initially)
 * - /api/version (version endpoint itself)
 */
async function versionEnforcer(req, res, next) {
  try {
    // Skip version check for public endpoints
    if (req.path === '/health' || 
        req.path === '/metrics' || 
        req.path === '/api-docs' ||
        req.path === '/' ||
        req.path.startsWith('/api/auth') ||
        req.path === '/api/version' ||
        req.path.startsWith('/api/payments/razorpay/webhook')) {
      return next();
    }
    
    // Get headers
    const appType = req.headers['x-app-type'];
    const appVersion = req.headers['x-app-version'];
    
    // Grace period: if headers are missing, allow request but log it
    if (!appType || !appVersion) {
      console.warn(
        `⚠️ [VersionEnforcer] Missing version headers: appType=${appType}, appVersion=${appVersion} | Path: ${req.path} | IP: ${req.ip}`
      );
      // Continue to next middleware (grace mode)
      return next();
    }
    
    // Validate app type
    const validAppTypes = ['customer', 'driver'];
    if (!validAppTypes.includes(appType)) {
      console.warn(`⚠️ [VersionEnforcer] Invalid app type: ${appType}`);
      return next();
    }
    
    // Get version config from Firestore
    const config = await getVersionConfig();
    
    // If config is missing, allow request (grace mode)
    if (!config || !config[appType]) {
      console.warn(
        `⚠️ [VersionEnforcer] Version config not found for ${appType}, allowing request (grace mode)`
      );
      return next();
    }
    
    const versionPolicy = config[appType];
    const { current, minimum } = versionPolicy;
    const decision = evaluateVersionPolicy(versionPolicy, appVersion);
    
    // Validate Firestore config format
    if (!current || !minimum) {
      console.error('❌ [VersionEnforcer] Invalid version policy config:', versionPolicy);
      return next(); // Allow if config is malformed
    }
    
    // HARD BLOCK: Version below minimum required
    if (decision.action === 'block' && decision.code === 'VERSION_TOO_OLD') {
      console.warn(
        `🚫 [VersionEnforcer] BLOCKED: ${appType} v${appVersion} < minimum ${minimum} | IP: ${req.ip}`
      );
      
      return res.status(decision.status).json({
        success: false,
        error: {
          code: 'VERSION_TOO_OLD',
          message: 'Your app version is no longer supported. Please update to continue.',
          minimumVersion: minimum,
          currentVersion: appVersion,
          appType: appType
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // SOFT BLOCK: Version below current but above minimum (if mandatory mode)
    if (decision.action === 'block' && decision.code === 'UPDATE_REQUIRED') {
      console.warn(
        `🚫 [VersionEnforcer] BLOCKED: ${appType} v${appVersion} < current ${current} (mandatory mode) | IP: ${req.ip}`
      );
      
      return res.status(decision.status).json({
        success: false,
        error: {
          code: 'UPDATE_REQUIRED',
          message: 'A critical app update is required. Please update to continue.',
          minimumVersion: minimum,
          currentVersion: current,
          recommendedVersion: current,
          appType: appType,
          updateType: 'mandatory'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Version is acceptable, attach to request for logging
    req.appVersion = appVersion;
    req.appType = appType;
    
    if (decision.reason === 'optional_update') {
      console.info(
        `ℹ️  [VersionEnforcer] Optional update available: ${appType} v${appVersion} → ${current}`
      );
    }
    
    return next();
  } catch (error) {
    console.error('❌ [VersionEnforcer] Unexpected error:', error.message);
    // Fail open: don't block requests on middleware errors
    return next();
  }
}

module.exports = {
  versionEnforcer,
  compareVersions,
  evaluateVersionPolicy,
  getVersionConfig
};
