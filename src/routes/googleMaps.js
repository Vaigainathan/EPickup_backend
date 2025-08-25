const express = require('express');
const { Client } = require('@googlemaps/google-maps-services-js');
const { asyncHandler } = require('../middleware/errorHandler');
const environmentConfig = require('../config/environment');
const rateLimit = require('express-rate-limit');
const recaptchaEnterpriseService = require('../services/recaptchaEnterpriseService');

const router = express.Router();

// Initialize Google Maps client
const googleMapsClient = new Client({});

// Rate limiting for Google Maps APIs
const googleMapsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests',
    error: { code: 'RATE_LIMIT_EXCEEDED' }
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Trust proxy for proper IP detection behind reverse proxy
  trustProxy: true,
});

// Apply rate limiting to all Google Maps routes
router.use(googleMapsLimiter);

// Quota monitoring
const quotaMonitor = {
  requests: new Map(),
  quotas: {
    geocoding: { daily: 2500, monthly: 100000 },
    places: { daily: 1000, monthly: 100000 },
    directions: { daily: 2500, monthly: 100000 },
    distanceMatrix: { daily: 100, monthly: 100000 },
    nearbyPlaces: { daily: 5000, monthly: 100000 }
  },
  
  trackRequest(apiName) {
    const now = Date.now();
    const today = new Date(now).toISOString().split('T')[0];
    const key = `${apiName}-${today}`;
    
    const currentCount = this.requests.get(key) || 0;
    this.requests.set(key, currentCount + 1);
    
    // Check if approaching quota
    const quota = this.quotas[apiName];
    if (quota && currentCount + 1 > quota.daily * 0.8) {
      console.warn(`⚠️ Approaching daily quota for ${apiName}: ${currentCount + 1}/${quota.daily}`);
    }
  },
  
  getUsage(apiName) {
    const today = new Date().toISOString().split('T')[0];
    const key = `${apiName}-${today}`;
    return this.requests.get(key) || 0;
  }
};

// Helper function to check API key and provide detailed error information
function validateApiKey() {
  const apiKey = environmentConfig.getGoogleMapsApiKey();
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY is not configured');
  }
  if (!apiKey.startsWith('AIzaSy')) {
    throw new Error('Invalid Google Maps API key format');
  }
  return apiKey;
}

// Helper function to validate reCAPTCHA tokens using Enterprise service
async function validateRecaptchaToken(token, action = 'submit') {
  try {
    if (!environmentConfig.isRecaptchaEnabled()) {
      console.log('reCAPTCHA validation disabled, skipping');
      return true; // Skip validation if disabled
    }

    if (!token) {
      console.warn('No reCAPTCHA token provided');
      return false;
    }

    // Use reCAPTCHA Enterprise service for validation
    const isValid = await recaptchaEnterpriseService.validateToken(token, action);
    console.log(`reCAPTCHA validation result for action '${action}': ${isValid}`);
    return isValid;
  } catch (error) {
    console.error('reCAPTCHA validation error:', error);
    return false;
  }
}

// Helper function to handle Google Maps API errors with detailed information
function handleGoogleMapsError(error, operation) {
  console.error(`Google Maps ${operation} Error:`, {
    message: error.message,
    status: error.response?.status,
    statusText: error.response?.statusText,
    data: error.response?.data,
    config: {
      url: error.config?.url,
      method: error.config?.method,
      params: error.config?.params
    }
  });

  // Map common Google Maps API errors to user-friendly messages
  const errorMessages = {
    'REQUEST_DENIED': 'API key is invalid or restricted',
    'OVER_QUERY_LIMIT': 'API quota exceeded',
    'ZERO_RESULTS': 'No results found for the given parameters',
    'NOT_FOUND': 'The requested resource was not found',
    'INVALID_REQUEST': 'Invalid request parameters',
    'UNKNOWN_ERROR': 'An unknown error occurred'
  };

  const errorCode = error.response?.data?.status || error.response?.data?.error_message || 'UNKNOWN_ERROR';
  const userMessage = errorMessages[errorCode] || 'An error occurred while processing your request';

  return {
    success: false,
    message: userMessage,
    error: {
      code: errorCode,
      message: userMessage,
      details: error.response?.data?.error_message || error.message
    }
  };
}

// Helper function to validate and sanitize input parameters
function validateAndSanitizeParams(params, requiredFields = []) {
  const sanitized = {};
  
  // Check required fields
  for (const field of requiredFields) {
    if (!params[field]) {
      throw new Error(`Missing required parameter: ${field}`);
    }
    sanitized[field] = typeof params[field] === 'string' ? params[field].trim() : params[field];
  }
  
  // Sanitize optional fields
  Object.keys(params).forEach(key => {
    if (params[key] !== undefined && params[key] !== null) {
      if (typeof params[key] === 'string') {
        sanitized[key] = params[key].trim();
      } else {
        sanitized[key] = params[key];
      }
    }
  });
  
  return sanitized;
}

// Places Autocomplete API
router.get('/place/autocomplete/json', asyncHandler(async (req, res) => {
  try {
    quotaMonitor.trackRequest('places');
    
    const apiKey = validateApiKey();
    const params = validateAndSanitizeParams(req.query, ['input']);
    
    // Validate reCAPTCHA token if provided
    if (params.recaptchaToken) {
      const isValidRecaptcha = await validateRecaptchaToken(params.recaptchaToken, 'search');
      if (!isValidRecaptcha) {
        return res.status(400).json({
          success: false,
          message: 'Invalid reCAPTCHA token',
          error: { code: 'INVALID_RECAPTCHA' }
        });
      }
    }
    
    const response = await googleMapsClient.placeAutocomplete({
      params: {
        input: params.input,
        key: apiKey,
        types: params.types || 'geocode',
        components: params.components || 'country:in',
        radius: params.radius || environmentConfig.getGoogleMapsConfig().defaultRadius,
        location: params.location || '12.9716,77.5946', // Bangalore default
        strictbounds: params.strictbounds === 'true',
        sessiontoken: params.sessionToken,
        language: environmentConfig.getGoogleMapsConfig().defaultLanguage,
        region: environmentConfig.getGoogleMapsConfig().defaultRegion,
      }
    });
    
    if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
      throw new Error(`Places API error: ${response.data.status}`);
    }
    
    res.json({
      success: true,
      status: response.data.status,
      predictions: response.data.predictions || [],
      message: 'Places autocomplete successful'
    });
    
  } catch (error) {
    const errorResponse = handleGoogleMapsError(error, 'Places Autocomplete');
    res.status(400).json(errorResponse);
  }
}));

// Place Details API
router.get('/place/details/json', asyncHandler(async (req, res) => {
  try {
    quotaMonitor.trackRequest('places');
    
    const apiKey = validateApiKey();
    const params = validateAndSanitizeParams(req.query, ['place_id']);
    
    // Validate reCAPTCHA token if provided
    if (params.recaptchaToken) {
      const isValidRecaptcha = await validateRecaptchaToken(params.recaptchaToken, 'details');
      if (!isValidRecaptcha) {
        return res.status(400).json({
          success: false,
          message: 'Invalid reCAPTCHA token',
          error: { code: 'INVALID_RECAPTCHA' }
        });
      }
    }
    
    const fields = params.fields || [
      'place_id',
      'formatted_address',
      'geometry',
      'name',
      'types',
      'address_components'
    ];
    
    const response = await googleMapsClient.placeDetails({
      params: {
        place_id: params.place_id,
        fields: fields,
        key: apiKey,
        sessiontoken: params.sessionToken,
        language: environmentConfig.getGoogleMapsConfig().defaultLanguage,
      }
    });
    
    if (response.data.status !== 'OK') {
      throw new Error(`Place Details API error: ${response.data.status}`);
    }
    
    res.json({
      success: true,
      status: response.data.status,
      result: response.data.result,
      message: 'Place details retrieved successfully'
    });
    
  } catch (error) {
    const errorResponse = handleGoogleMapsError(error, 'Place Details');
    res.status(400).json(errorResponse);
  }
}));

// Geocoding API
router.get('/geocode/json', asyncHandler(async (req, res) => {
  try {
    quotaMonitor.trackRequest('geocoding');
    
    const apiKey = validateApiKey();
    const params = validateAndSanitizeParams(req.query);
    
    // Must have either address or latlng
    if (!params.address && !params.latlng) {
      return res.status(400).json({
        success: false,
        message: 'Either address or latlng parameter is required',
        error: { code: 'MISSING_PARAMETER' }
      });
    }
    
    // Validate reCAPTCHA token if provided
    if (params.recaptchaToken) {
      const isValidRecaptcha = await validateRecaptchaToken(params.recaptchaToken, 'geocoding');
      if (!isValidRecaptcha) {
        return res.status(400).json({
          success: false,
          message: 'Invalid reCAPTCHA token',
          error: { code: 'INVALID_RECAPTCHA' }
        });
      }
    }
    
    const response = await googleMapsClient.geocode({
      params: {
        address: params.address,
        latlng: params.latlng,
        key: apiKey,
        components: params.components,
        bounds: params.bounds,
        region: params.region || environmentConfig.getGoogleMapsConfig().defaultRegion,
        language: environmentConfig.getGoogleMapsConfig().defaultLanguage,
        result_type: params.result_type,
        location_type: params.location_type,
      }
    });
    
    if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
      throw new Error(`Geocoding API error: ${response.data.status}`);
    }
    
    res.json({
      success: true,
      status: response.data.status,
      results: response.data.results || [],
      message: 'Geocoding completed successfully'
    });
    
  } catch (error) {
    const errorResponse = handleGoogleMapsError(error, 'Geocoding');
    res.status(400).json(errorResponse);
  }
}));

// Directions API
router.get('/directions/json', asyncHandler(async (req, res) => {
  try {
    quotaMonitor.trackRequest('directions');
    
    const apiKey = validateApiKey();
    const params = validateAndSanitizeParams(req.query, ['origin', 'destination']);
    
    // Validate reCAPTCHA token if provided
    if (params.recaptchaToken) {
      const isValidRecaptcha = await validateRecaptchaToken(params.recaptchaToken, 'directions');
      if (!isValidRecaptcha) {
        return res.status(400).json({
          success: false,
          message: 'Invalid reCAPTCHA token',
          error: { code: 'INVALID_RECAPTCHA' }
        });
      }
    }
    
    const response = await googleMapsClient.directions({
      params: {
        origin: params.origin,
        destination: params.destination,
        key: apiKey,
        mode: params.mode || 'driving',
        avoid: params.avoid,
        units: params.units || 'metric',
        traffic_model: params.traffic_model,
        departure_time: params.departure_time,
        arrival_time: params.arrival_time,
        waypoints: params.waypoints,
        optimize: params.optimize === 'true',
        alternatives: params.alternatives === 'true',
        language: environmentConfig.getGoogleMapsConfig().defaultLanguage,
        region: environmentConfig.getGoogleMapsConfig().defaultRegion,
      }
    });
    
    if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
      throw new Error(`Directions API error: ${response.data.status}`);
    }
    
    res.json({
      success: true,
      status: response.data.status,
      routes: response.data.routes || [],
      message: 'Directions retrieved successfully'
    });
    
  } catch (error) {
    const errorResponse = handleGoogleMapsError(error, 'Directions');
    res.status(400).json(errorResponse);
  }
}));

// Distance Matrix API
router.get('/distancematrix/json', asyncHandler(async (req, res) => {
  try {
    quotaMonitor.trackRequest('distanceMatrix');
    
    const apiKey = validateApiKey();
    const params = validateAndSanitizeParams(req.query, ['origins', 'destinations']);
    
    // Validate reCAPTCHA token if provided
    if (params.recaptchaToken) {
      const isValidRecaptcha = await validateRecaptchaToken(params.recaptchaToken, 'distance_matrix');
      if (!isValidRecaptcha) {
        return res.status(400).json({
          success: false,
          message: 'Invalid reCAPTCHA token',
          error: { code: 'INVALID_RECAPTCHA' }
        });
      }
    }
    
    const response = await googleMapsClient.distancematrix({
      params: {
        origins: params.origins,
        destinations: params.destinations,
        key: apiKey,
        mode: params.mode || 'driving',
        avoid: params.avoid,
        units: params.units || 'metric',
        traffic_model: params.traffic_model,
        departure_time: params.departure_time,
        arrival_time: params.arrival_time,
        language: environmentConfig.getGoogleMapsConfig().defaultLanguage,
        region: environmentConfig.getGoogleMapsConfig().defaultRegion,
      }
    });
    
    if (response.data.status !== 'OK') {
      throw new Error(`Distance Matrix API error: ${response.data.status}`);
    }
    
    res.json({
      success: true,
      status: response.data.status,
      origin_addresses: response.data.origin_addresses || [],
      destination_addresses: response.data.destination_addresses || [],
      rows: response.data.rows || [],
      message: 'Distance matrix calculated successfully'
    });
    
  } catch (error) {
    const errorResponse = handleGoogleMapsError(error, 'Distance Matrix');
    res.status(400).json(errorResponse);
  }
}));

// Nearby Places API
router.get('/place/nearbysearch/json', asyncHandler(async (req, res) => {
  try {
    quotaMonitor.trackRequest('nearbyPlaces');
    
    const apiKey = validateApiKey();
    const params = validateAndSanitizeParams(req.query, ['location']);
    
    // Validate reCAPTCHA token if provided
    if (params.recaptchaToken) {
      const isValidRecaptcha = await validateRecaptchaToken(params.recaptchaToken, 'nearby_search');
      if (!isValidRecaptcha) {
        return res.status(400).json({
          success: false,
          message: 'Invalid reCAPTCHA token',
          error: { code: 'INVALID_RECAPTCHA' }
        });
      }
    }
    
    const response = await googleMapsClient.placesNearby({
      params: {
        location: params.location,
        key: apiKey,
        radius: params.radius || environmentConfig.getGoogleMapsConfig().defaultRadius,
        type: params.type,
        keyword: params.keyword,
        minprice: params.minprice,
        maxprice: params.maxprice,
        opennow: params.opennow === 'true',
        rankby: params.rankby,
        pagetoken: params.pagetoken,
        language: environmentConfig.getGoogleMapsConfig().defaultLanguage,
      }
    });
    
    if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
      throw new Error(`Nearby Places API error: ${response.data.status}`);
    }
    
    res.json({
      success: true,
      status: response.data.status,
      results: response.data.results || [],
      next_page_token: response.data.next_page_token,
      message: 'Nearby places search completed successfully'
    });
    
  } catch (error) {
    const errorResponse = handleGoogleMapsError(error, 'Nearby Places');
    res.status(400).json(errorResponse);
  }
}));

// Health check endpoint
router.get('/health', asyncHandler(async (req, res) => {
  try {
    const apiKey = validateApiKey();
    
    // Test the API key with a simple geocoding request
    const response = await googleMapsClient.geocode({
      params: {
        address: 'Test',
        key: apiKey,
      }
    });
    
    const quotaUsage = {
      geocoding: quotaMonitor.getUsage('geocoding'),
      places: quotaMonitor.getUsage('places'),
      directions: quotaMonitor.getUsage('directions'),
      distanceMatrix: quotaMonitor.getUsage('distanceMatrix'),
      nearbyPlaces: quotaMonitor.getUsage('nearbyPlaces')
    };
    
    res.json({
      success: true,
      message: 'Google Maps API is healthy',
      status: response.data.status,
      apiKey: {
        configured: !!apiKey,
        valid: apiKey.startsWith('AIzaSy'),
        prefix: apiKey.substring(0, 10) + '...'
      },
      quotaUsage,
      config: {
        defaultRadius: environmentConfig.getGoogleMapsConfig().defaultRadius,
        defaultLanguage: environmentConfig.getGoogleMapsConfig().defaultLanguage,
        defaultRegion: environmentConfig.getGoogleMapsConfig().defaultRegion,
        restrictions: environmentConfig.getGoogleMapsConfig().restrictions
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Google Maps API health check failed',
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: error.message
      }
    });
  }
}));

// Quota usage endpoint
router.get('/quota', asyncHandler(async (req, res) => {
  const quotaUsage = {
    geocoding: {
      used: quotaMonitor.getUsage('geocoding'),
      limit: quotaMonitor.quotas.geocoding.daily,
      remaining: quotaMonitor.quotas.geocoding.daily - quotaMonitor.getUsage('geocoding')
    },
    places: {
      used: quotaMonitor.getUsage('places'),
      limit: quotaMonitor.quotas.places.daily,
      remaining: quotaMonitor.quotas.places.daily - quotaMonitor.getUsage('places')
    },
    directions: {
      used: quotaMonitor.getUsage('directions'),
      limit: quotaMonitor.quotas.directions.daily,
      remaining: quotaMonitor.quotas.directions.daily - quotaMonitor.getUsage('directions')
    },
    distanceMatrix: {
      used: quotaMonitor.getUsage('distanceMatrix'),
      limit: quotaMonitor.quotas.distanceMatrix.daily,
      remaining: quotaMonitor.quotas.distanceMatrix.daily - quotaMonitor.getUsage('distanceMatrix')
    },
    nearbyPlaces: {
      used: quotaMonitor.getUsage('nearbyPlaces'),
      limit: quotaMonitor.quotas.nearbyPlaces.daily,
      remaining: quotaMonitor.quotas.nearbyPlaces.daily - quotaMonitor.getUsage('nearbyPlaces')
    }
  };
  
  res.json({
    success: true,
    message: 'Quota usage retrieved successfully',
    quotaUsage,
    date: new Date().toISOString().split('T')[0]
  });
}));

module.exports = router;
