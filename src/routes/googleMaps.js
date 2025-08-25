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
    data: error.response?.data,
    config: {
      url: error.config?.url,
      method: error.config?.method,
      params: error.config?.params
    }
  });

  // Check for specific API errors
  if (error.response?.data?.error_message) {
    const errorMessage = error.response.data.error_message;
    if (errorMessage.includes('API key not valid')) {
      return {
        success: false,
        message: 'Google Maps API key is invalid or expired',
        error: {
          code: 'INVALID_API_KEY',
          message: 'Please check your Google Maps API key configuration'
        }
      };
    }
    if (errorMessage.includes('API not enabled')) {
      return {
        success: false,
        message: `Google Maps API not enabled for ${operation}`,
        error: {
          code: 'API_NOT_ENABLED',
          message: `Please enable the required Google Maps API in Google Cloud Console: ${operation}`
        }
      };
    }
    if (errorMessage.includes('quota exceeded')) {
      return {
        success: false,
        message: 'Google Maps API quota exceeded',
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'API usage limit reached. Please check your billing and quotas.'
        }
      };
    }
    if (errorMessage.includes('ZERO_RESULTS')) {
      return {
        success: false,
        message: 'No results found for the given query',
        error: {
          code: 'ZERO_RESULTS',
          message: 'No matching locations found. Please try a different search term.'
        }
      };
    }
  }

  return {
    success: false,
    message: `Failed to perform ${operation}`,
    error: {
      code: 'GOOGLE_MAPS_ERROR',
      message: error.response?.data?.error_message || error.message || 'Unknown Google Maps API error'
    }
  };
}

/**
 * @route GET /api/google-maps/places
 * @desc Search places (compatible with frontend GooglePlacesAutocomplete)
 * @access Public
 */
router.get('/places', 
  asyncHandler(async (req, res) => {
    const { 
      input, 
      sessionToken, 
      types = 'geocode', 
      components = 'country:in', 
      radius = 50000, 
      location = '12.9716,77.5946', 
      strictbounds = false 
    } = req.query;

    if (!input || input.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Input parameter is required',
        error: {
          code: 'MISSING_INPUT',
          message: 'Input parameter is required for place search'
        }
      });
    }

    try {
      const apiKey = validateApiKey();
      
      // Track quota usage
      quotaMonitor.trackRequest('places');
      
      console.log(`🔍 Place Search Request:`, {
        input: input.trim(),
        types,
        components,
        radius: parseInt(radius),
        location
      });

      const response = await googleMapsClient.placeAutocomplete({
        params: {
          input: input.trim(),
          key: apiKey,
          sessiontoken: sessionToken,
          types: types,
          components: components,
          radius: parseInt(radius),
          location: location,
          strictbounds: strictbounds === 'true'
        }
      });

      console.log(`✅ Place Search Response Status:`, response.data.status);

      if (response.data.status === 'OK') {
        const predictions = response.data.predictions.map(prediction => ({
          place_id: prediction.place_id,
          description: prediction.description,
          structured_formatting: prediction.structured_formatting,
          types: prediction.types,
          matched_substrings: prediction.matched_substrings
        }));

        res.json({
          success: true,
          data: {
            predictions,
            status: response.data.status,
            count: predictions.length
          },
          message: 'Place search results retrieved successfully'
        });
      } else {
        const errorResponse = {
          success: false,
          message: 'Failed to get place search results',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        };

        console.error(`❌ Place Search Failed:`, errorResponse);
        res.status(400).json(errorResponse);
      }
    } catch (error) {
      const errorResponse = handleGoogleMapsError(error, 'Place Search');
      res.status(400).json(errorResponse); // Return 400 instead of 500
    }
  })
);

/**
 * @route GET /api/google-maps/places/autocomplete
 * @desc Get place autocomplete suggestions
 * @access Public
 */
router.get('/places/autocomplete', 
  asyncHandler(async (req, res) => {
    const { 
      input, 
      sessionToken, 
      types = 'geocode', 
      components = 'country:in', 
      radius = 50000, 
      location = '12.9716,77.5946', 
      strictbounds = false,
      recaptchaToken 
    } = req.query;

    if (!input || input.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Input parameter is required',
        error: {
          code: 'MISSING_INPUT',
          message: 'Input parameter is required for autocomplete'
        }
      });
    }

    // Validate reCAPTCHA token if provided
    if (recaptchaToken) {
      try {
        const recaptchaValid = await validateRecaptchaToken(recaptchaToken);
        if (!recaptchaValid) {
          return res.status(400).json({
            success: false,
            message: 'Invalid reCAPTCHA token',
            error: {
              code: 'INVALID_RECAPTCHA',
              message: 'reCAPTCHA validation failed'
            }
          });
        }
      } catch (error) {
        console.error('reCAPTCHA validation error:', error);
        return res.status(500).json({
          success: false,
          message: 'reCAPTCHA validation error',
          error: {
            code: 'RECAPTCHA_ERROR',
            message: 'Failed to validate reCAPTCHA token'
          }
        });
      }
    }

    try {
      const apiKey = validateApiKey();
      
      console.log(`🔍 Autocomplete Request:`, {
        input: input.trim(),
        types: types || 'geocode',
        components
      });

      const response = await googleMapsClient.placeAutocomplete({
        params: {
          input: input.trim(),
          key: apiKey,
          sessiontoken: sessionToken,
          types: types || 'geocode',
          components: components,
          radius: radius || 50000,
          location: location,
          strictbounds: strictbounds === 'true'
        }
      });

      console.log(`✅ Autocomplete Response Status:`, response.data.status);

      if (response.data.status === 'OK') {
        const predictions = response.data.predictions.map(prediction => ({
          placeId: prediction.place_id,
          description: prediction.description,
          structuredFormatting: prediction.structured_formatting,
          types: prediction.types,
          matchedSubstrings: prediction.matched_substrings
        }));

        res.json({
          success: true,
          data: {
            predictions,
            status: response.data.status,
            count: predictions.length
          },
          message: 'Place autocomplete results retrieved successfully'
        });
      } else {
        const errorResponse = {
          success: false,
          message: 'Failed to get autocomplete results',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        };

        console.error(`❌ Autocomplete Failed:`, errorResponse);
        res.status(400).json(errorResponse);
      }
    } catch (error) {
      const errorResponse = handleGoogleMapsError(error, 'Autocomplete');
      res.status(500).json(errorResponse);
    }
  })
);

/**
 * @route GET /api/google-maps/places/details
 * @desc Get detailed place information
 * @access Public
 */
router.get('/places/details',
  asyncHandler(async (req, res) => {
    const { placeId, fields, language, region } = req.query;

    if (!placeId) {
      return res.status(400).json({
        success: false,
        message: 'Place ID is required',
        error: {
          code: 'MISSING_PLACE_ID',
          message: 'Place ID parameter is required'
        }
      });
    }

    try {
      const apiKey = validateApiKey();
      
      console.log(`🔍 Place Details Request:`, {
        placeId,
        fields: fields || 'formatted_address,geometry,name,place_id,types'
      });

      const response = await googleMapsClient.placeDetails({
        params: {
          place_id: placeId,
          key: apiKey,
          fields: fields || 'formatted_address,geometry,name,place_id,types',
          language: language || 'en',
          region: region || 'IN'
        }
      });

      console.log(`✅ Place Details Response Status:`, response.data.status);

      if (response.data.status === 'OK') {
        const place = response.data.result;
        res.json({
          success: true,
          data: {
            placeId: place.place_id,
            name: place.name,
            formattedAddress: place.formatted_address,
            geometry: place.geometry,
            types: place.types,
            addressComponents: place.address_components,
            photos: place.photos,
            rating: place.rating,
            userRatingsTotal: place.user_ratings_total,
            openingHours: place.opening_hours,
            priceLevel: place.price_level,
            website: place.website,
            phoneNumber: place.formatted_phone_number,
            internationalPhoneNumber: place.international_phone_number
          },
          message: 'Place details retrieved successfully'
        });
      } else {
        const errorResponse = {
          success: false,
          message: 'Failed to get place details',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        };

        console.error(`❌ Place Details Failed:`, errorResponse);
        res.status(400).json(errorResponse);
      }
    } catch (error) {
      const errorResponse = handleGoogleMapsError(error, 'Place Details');
      res.status(500).json(errorResponse);
    }
  })
);

/**
 * @route GET /api/google-maps/directions
 * @desc Get directions between two points
 * @access Public
 */
router.get('/directions',
  asyncHandler(async (req, res) => {
    const { 
      origin, 
      destination, 
      mode = 'driving', 
      alternatives = 'false',
      avoid = '',
      units = 'metric',
      traffic_model = 'best_guess',
      departure_time = 'now',
      arrival_time,
      waypoints,
      optimize = 'false',
      language = 'en'
    } = req.query;

    if (!origin || !destination) {
      return res.status(400).json({
        success: false,
        message: 'Origin and destination are required',
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'Origin and destination parameters are required'
        }
      });
    }

    try {
      const apiKey = validateApiKey();
      
      // Track quota usage
      quotaMonitor.trackRequest('directions');
      
      console.log(`🗺️ Directions Request:`, {
        origin,
        destination,
        mode,
        alternatives: alternatives === 'true'
      });

      const params = {
        origin,
        destination,
        key: apiKey,
        mode,
        alternatives: alternatives === 'true',
        avoid: avoid ? avoid.split('|') : [],
        units,
        traffic_model,
        language
      };

      if (departure_time !== 'now') {
        params.departure_time = departure_time;
      }

      if (arrival_time) {
        params.arrival_time = arrival_time;
      }

      if (waypoints) {
        params.waypoints = waypoints;
        params.optimize = optimize === 'true';
      }

      const response = await googleMapsClient.directions({ params });

      console.log(`✅ Directions Response Status:`, response.data.status);

      if (response.data.status === 'OK') {
        const routes = response.data.routes.map(route => ({
          summary: route.summary,
          legs: route.legs.map(leg => ({
            distance: leg.distance,
            duration: leg.duration,
            durationInTraffic: leg.duration_in_traffic,
            startAddress: leg.start_address,
            endAddress: leg.end_address,
            startLocation: leg.start_location,
            endLocation: leg.end_location,
            steps: leg.steps.map(step => ({
              distance: step.distance,
              duration: step.duration,
              instruction: step.html_instructions,
              maneuver: step.maneuver,
              polyline: step.polyline,
              travelMode: step.travel_mode
            }))
          })),
          polyline: route.overview_polyline,
          bounds: route.bounds,
          fare: route.fare,
          warnings: route.warnings
        }));

        res.json({
          success: true,
          data: {
            routes,
            status: response.data.status,
            availableTravelModes: response.data.available_travel_modes,
            geocodedWaypoints: response.data.geocoded_waypoints
          },
          message: 'Directions retrieved successfully'
        });
      } else {
        const errorResponse = {
          success: false,
          message: 'Failed to get directions',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        };

        console.error(`❌ Directions Failed:`, errorResponse);
        res.status(400).json(errorResponse);
      }
    } catch (error) {
      console.error('Directions API error:', error);
      const errorResponse = handleGoogleMapsError(error, 'Directions');
      res.status(500).json(errorResponse); // Return 500 for server errors
    }
  })
);

/**
 * @route GET /api/google-maps/geocode
 * @desc Geocode an address to coordinates
 * @access Public
 */
router.get('/geocode',
  asyncHandler(async (req, res) => {
    const { address, components, bounds, language = 'en', region = 'IN' } = req.query;

    if (!address) {
      return res.status(400).json({
        success: false,
        message: 'Address is required',
        error: {
          code: 'MISSING_ADDRESS',
          message: 'Address parameter is required'
        }
      });
    }

    try {
      const apiKey = validateApiKey();
      
      console.log(`🌍 Geocoding Request:`, {
        address,
        components,
        language,
        region
      });

      const params = {
        address,
        key: apiKey,
        language,
        region
      };

      if (components) {
        params.components = components;
      }

      if (bounds) {
        params.bounds = bounds;
      }

      const response = await googleMapsClient.geocode({ params });

      console.log(`✅ Geocoding Response Status:`, response.data.status);

      if (response.data.status === 'OK') {
        const results = response.data.results.map(result => ({
          formattedAddress: result.formatted_address,
          geometry: result.geometry,
          placeId: result.place_id,
          types: result.types,
          addressComponents: result.address_components,
          partialMatch: result.partial_match
        }));

        res.json({
          success: true,
          data: {
            results,
            status: response.data.status,
            count: results.length
          },
          message: 'Geocoding completed successfully'
        });
      } else {
        const errorResponse = {
          success: false,
          message: 'Failed to geocode address',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        };

        console.error(`❌ Geocoding Failed:`, errorResponse);
        res.status(400).json(errorResponse);
      }
    } catch (error) {
      const errorResponse = handleGoogleMapsError(error, 'Geocoding');
      res.status(500).json(errorResponse);
    }
  })
);

/**
 * @route GET /api/google-maps/reverse-geocode
 * @desc Reverse geocode coordinates to address
 * @access Public
 */
router.get('/reverse-geocode',
  asyncHandler(async (req, res) => {
    const { latlng, resultType, locationType, language = 'en' } = req.query;

    if (!latlng) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required',
        error: {
          code: 'MISSING_COORDINATES',
          message: 'Latlng parameter is required (format: lat,lng)'
        }
      });
    }

    try {
      const apiKey = validateApiKey();
      
      console.log(`🌍 Reverse Geocoding Request:`, {
        latlng,
        resultType,
        locationType,
        language
      });

      const params = {
        latlng,
        key: apiKey,
        language
      };

      if (resultType) {
        params.result_type = resultType;
      }

      if (locationType) {
        params.location_type = locationType;
      }

      const response = await googleMapsClient.reverseGeocode({ params });

      console.log(`✅ Reverse Geocoding Response Status:`, response.data.status);

      if (response.data.status === 'OK') {
        const results = response.data.results.map(result => ({
          formattedAddress: result.formatted_address,
          geometry: result.geometry,
          placeId: result.place_id,
          types: result.types,
          addressComponents: result.address_components
        }));

        res.json({
          success: true,
          data: {
            results,
            status: response.data.status,
            count: results.length
          },
          message: 'Reverse geocoding completed successfully'
        });
      } else {
        const errorResponse = {
          success: false,
          message: 'Failed to reverse geocode coordinates',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        };

        console.error(`❌ Reverse Geocoding Failed:`, errorResponse);
        res.status(400).json(errorResponse);
      }
    } catch (error) {
      const errorResponse = handleGoogleMapsError(error, 'Reverse Geocoding');
      res.status(500).json(errorResponse);
    }
  })
);

/**
 * @route GET /api/google-maps/nearby-places
 * @desc Get nearby places
 * @access Public
 */
router.get('/nearby-places',
  asyncHandler(async (req, res) => {
    const { 
      location, 
      radius = 1500, 
      type, 
      keyword, 
      minPrice, 
      maxPrice, 
      openNow = 'false',
      rankBy = 'prominence',
      pageToken,
      language = 'en'
    } = req.query;

    if (!location) {
      return res.status(400).json({
        success: false,
        message: 'Location is required',
        error: {
          code: 'MISSING_LOCATION',
          message: 'Location parameter is required (format: lat,lng)'
        }
      });
    }

    try {
      const apiKey = validateApiKey();
      
      console.log(`📍 Nearby Places Request:`, {
        location,
        radius: parseInt(radius),
        type,
        keyword,
        openNow: openNow === 'true'
      });

      const params = {
        location,
        key: apiKey,
        radius: parseInt(radius),
        language
      };

      if (type) {
        params.type = type;
      }

      if (keyword) {
        params.keyword = keyword;
      }

      if (minPrice !== undefined) {
        params.minprice = parseInt(minPrice);
      }

      if (maxPrice !== undefined) {
        params.maxprice = parseInt(maxPrice);
      }

      if (openNow === 'true') {
        params.opennow = true;
      }

      if (rankBy === 'distance') {
        params.rankby = 'distance';
        delete params.radius; // radius is not allowed with rankby=distance
      }

      if (pageToken) {
        params.pagetoken = pageToken;
      }

      const response = await googleMapsClient.placesNearby({ params });

      console.log(`✅ Nearby Places Response Status:`, response.data.status);

      if (response.data.status === 'OK') {
        const places = response.data.results.map(place => ({
          placeId: place.place_id,
          name: place.name,
          geometry: place.geometry,
          types: place.types,
          vicinity: place.vicinity,
          rating: place.rating,
          userRatingsTotal: place.user_ratings_total,
          priceLevel: place.price_level,
          openingHours: place.opening_hours,
          photos: place.photos,
          icon: place.icon,
          iconBackgroundColor: place.icon_background_color,
          iconMaskBaseUri: place.icon_mask_base_uri
        }));

        res.json({
          success: true,
          data: {
            places,
            status: response.data.status,
            nextPageToken: response.data.next_page_token,
            htmlAttributions: response.data.html_attributions,
            count: places.length
          },
          message: 'Nearby places retrieved successfully'
        });
      } else {
        const errorResponse = {
          success: false,
          message: 'Failed to get nearby places',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        };

        console.error(`❌ Nearby Places Failed:`, errorResponse);
        res.status(400).json(errorResponse);
      }
    } catch (error) {
      const errorResponse = handleGoogleMapsError(error, 'Nearby Places');
      res.status(500).json(errorResponse);
    }
  })
);

/**
 * @route GET /api/google-maps/distance-matrix
 * @desc Get distance matrix between multiple origins and destinations
 * @access Public
 */
router.get('/distance-matrix',
  asyncHandler(async (req, res) => {
    const { 
      origins, 
      destinations, 
      mode = 'driving', 
      avoid = '',
      units = 'metric',
      traffic_model = 'best_guess',
      departure_time = 'now',
      arrival_time,
      transit_mode,
      transit_routing_preference,
      language = 'en'
    } = req.query;

    if (!origins || !destinations) {
      return res.status(400).json({
        success: false,
        message: 'Origins and destinations are required',
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'Origins and destinations parameters are required'
        }
      });
    }

    try {
      const apiKey = validateApiKey();
      
      console.log(`📏 Distance Matrix Request:`, {
        origins: origins.split('|'),
        destinations: destinations.split('|'),
        mode,
        units
      });

      const params = {
        origins: origins.split('|'),
        destinations: destinations.split('|'),
        key: apiKey,
        mode,
        units,
        language
      };

      if (avoid) {
        params.avoid = avoid.split('|');
      }

      if (traffic_model) {
        params.traffic_model = traffic_model;
      }

      if (departure_time !== 'now') {
        params.departure_time = departure_time;
      }

      if (arrival_time) {
        params.arrival_time = arrival_time;
      }

      if (transit_mode) {
        params.transit_mode = transit_mode.split('|');
      }

      if (transit_routing_preference) {
        params.transit_routing_preference = transit_routing_preference;
      }

      const response = await googleMapsClient.distancematrix({ params });

      console.log(`✅ Distance Matrix Response Status:`, response.data.status);

      if (response.data.status === 'OK') {
        const rows = response.data.rows.map(row => ({
          elements: row.elements.map(element => ({
            status: element.status,
            distance: element.distance,
            duration: element.duration,
            durationInTraffic: element.duration_in_traffic,
            fare: element.fare
          }))
        }));

        res.json({
          success: true,
          data: {
            originAddresses: response.data.origin_addresses,
            destinationAddresses: response.data.destination_addresses,
            rows,
            status: response.data.status
          },
          message: 'Distance matrix calculated successfully'
        });
      } else {
        const errorResponse = {
          success: false,
          message: 'Failed to calculate distance matrix',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        };

        console.error(`❌ Distance Matrix Failed:`, errorResponse);
        res.status(400).json(errorResponse);
      }
    } catch (error) {
      const errorResponse = handleGoogleMapsError(error, 'Distance Matrix');
      res.status(500).json(errorResponse);
    }
  })
);

/**
 * @route GET /api/google-maps/elevation
 * @desc Get elevation data for coordinates
 * @access Public
 */
router.get('/elevation',
  asyncHandler(async (req, res) => {
    const { locations, path, samples } = req.query;

    if (!locations && !path) {
      return res.status(400).json({
        success: false,
        message: 'Either locations or path is required',
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'Either locations or path parameter is required'
        }
      });
    }

    try {
      const apiKey = validateApiKey();
      
      console.log(`🏔️ Elevation Request:`, {
        locations,
        path,
        samples
      });

      const params = {
        key: apiKey
      };

      if (locations) {
        params.locations = locations;
      }

      if (path) {
        params.path = path;
        if (samples) {
          params.samples = parseInt(samples);
        }
      }

      const response = await googleMapsClient.elevation({ params });

      console.log(`✅ Elevation Response Status:`, response.data.status);

      if (response.data.status === 'OK') {
        const results = response.data.results.map(result => ({
          location: result.location,
          elevation: result.elevation,
          resolution: result.resolution
        }));

        res.json({
          success: true,
          data: {
            results,
            status: response.data.status,
            count: results.length
          },
          message: 'Elevation data retrieved successfully'
        });
      } else {
        const errorResponse = {
          success: false,
          message: 'Failed to get elevation data',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        };

        console.error(`❌ Elevation Failed:`, errorResponse);
        res.status(400).json(errorResponse);
      }
    } catch (error) {
      const errorResponse = handleGoogleMapsError(error, 'Elevation');
      res.status(500).json(errorResponse);
    }
  })
);

module.exports = router;
