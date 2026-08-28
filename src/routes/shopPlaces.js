const express = require('express');
const { Client } = require('@googlemaps/google-maps-services-js');
const rateLimit = require('express-rate-limit');
const { authMiddleware, requireRole } = require('../middleware/auth');
const environmentConfig = require('../config/environment');

const router = express.Router();
const googleMapsClient = new Client({});

const placesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.uid || req.ip,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many Places requests, please try again later'
    }
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many Places requests, please try again later'
      }
    });
  }
});

function getMapsApiKey() {
  const apiKey = environmentConfig.getGoogleMapsConfig()?.apiKey || process.env.GOOGLE_MAPS_API_KEY || '';
  if (!apiKey) {
    const error = new Error('Maps service is not configured');
    error.status = 500;
    error.code = 'MAPS_NOT_CONFIGURED';
    throw error;
  }
  return apiKey;
}

function mapsConfig() {
  return environmentConfig.getGoogleMapsConfig() || {};
}

/**
 * GET /api/shop/onboarding/places/autocomplete?input=...
 */
router.get(
  '/places/autocomplete',
  authMiddleware,
  requireRole(['shop']),
  placesLimiter,
  async (req, res) => {
    try {
      const input = typeof req.query.input === 'string' ? req.query.input.trim() : '';
      if (!input) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_INPUT',
            message: 'input query parameter is required'
          }
        });
      }

      const apiKey = getMapsApiKey();
      const config = mapsConfig();
      const sessiontoken = typeof req.query.sessiontoken === 'string'
        ? req.query.sessiontoken
        : req.query.sessionToken;

      const response = await googleMapsClient.placeAutocomplete({
        params: {
          input,
          key: apiKey,
          types: 'geocode',
          components: 'country:in',
          radius: config.defaultRadius || 50000,
          location: '12.4950,78.5678',
          strictbounds: false,
          language: config.defaultLanguage || 'en',
          region: config.defaultRegion || 'in',
          sessiontoken
        }
      });

      if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
        return res.status(400).json({
          success: false,
          error: {
            code: response.data.status || 'PLACES_ERROR',
            message: 'Places autocomplete failed'
          }
        });
      }

      return res.json({
        success: true,
        status: response.data.status,
        predictions: response.data.predictions || []
      });
    } catch (error) {
      console.error('❌ [SHOP_PLACES] autocomplete error:', error.message);
      const status = error.status || 500;
      return res.status(status).json({
        success: false,
        error: {
          code: error.code || 'PLACES_ERROR',
          message: status === 500 ? 'Failed to search places' : error.message
        }
      });
    }
  }
);

/**
 * GET /api/shop/onboarding/places/details?placeId=...
 */
router.get(
  '/places/details',
  authMiddleware,
  requireRole(['shop']),
  placesLimiter,
  async (req, res) => {
    try {
      const placeId = typeof req.query.placeId === 'string'
        ? req.query.placeId.trim()
        : (typeof req.query.place_id === 'string' ? req.query.place_id.trim() : '');

      if (!placeId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_PLACE_ID',
            message: 'placeId query parameter is required'
          }
        });
      }

      const apiKey = getMapsApiKey();
      const config = mapsConfig();
      const sessiontoken = typeof req.query.sessiontoken === 'string'
        ? req.query.sessiontoken
        : req.query.sessionToken;

      const response = await googleMapsClient.placeDetails({
        params: {
          place_id: placeId,
          fields: [
            'place_id',
            'formatted_address',
            'geometry',
            'name',
            'types',
            'address_components'
          ],
          key: apiKey,
          language: config.defaultLanguage || 'en',
          sessiontoken
        }
      });

      if (response.data.status !== 'OK') {
        return res.status(400).json({
          success: false,
          error: {
            code: response.data.status || 'PLACES_ERROR',
            message: 'Place details failed'
          }
        });
      }

      const result = response.data.result || {};
      const location = result.geometry?.location;

      return res.json({
        success: true,
        status: response.data.status,
        result,
        data: {
          placeId: result.place_id || placeId,
          address: result.formatted_address || result.name || '',
          latitude: typeof location?.lat === 'function' ? location.lat() : location?.lat,
          longitude: typeof location?.lng === 'function' ? location.lng() : location?.lng
        }
      });
    } catch (error) {
      console.error('❌ [SHOP_PLACES] details error:', error.message);
      const status = error.status || 500;
      return res.status(status).json({
        success: false,
        error: {
          code: error.code || 'PLACES_ERROR',
          message: status === 500 ? 'Failed to load place details' : error.message
        }
      });
    }
  }
);

module.exports = router;
