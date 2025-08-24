const express = require('express');
const { Client } = require('@googlemaps/google-maps-services-js');
const { validateRequest } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');
const environmentConfig = require('../config/environment');

const router = express.Router();

// Initialize Google Maps client
const googleMapsClient = new Client({});

/**
 * @route GET /api/google-maps/places
 * @desc Search places (compatible with frontend GooglePlacesAutocomplete)
 * @access Public
 */
router.get('/places', 
  validateRequest,
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
      const response = await googleMapsClient.placeAutocomplete({
        params: {
          input: input.trim(),
          key: environmentConfig.getGoogleMapsApiKey(),
          sessiontoken: sessionToken,
          types: types,
          components: components,
          radius: parseInt(radius),
          location: location,
          strictbounds: strictbounds === 'true'
        }
      });

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
            status: response.data.status
          },
          message: 'Place search results retrieved successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to get place search results',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        });
      }
    } catch (error) {
      console.error('Google Maps Place Search Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get place search results',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  })
);

/**
 * @route GET /api/google-maps/places/autocomplete
 * @desc Get place autocomplete suggestions
 * @access Public
 */
router.get('/places/autocomplete', 
  validateRequest,
  asyncHandler(async (req, res) => {
    const { input, sessionToken, types, components, radius, location, strictbounds } = req.query;

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

    try {
      const response = await googleMapsClient.placeAutocomplete({
        params: {
          input: input.trim(),
          key: environmentConfig.getGoogleMapsApiKey(),
          sessiontoken: sessionToken,
          types: types || 'geocode',
          components: components,
          radius: radius || 50000,
          location: location,
          strictbounds: strictbounds === 'true'
        }
      });

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
            status: response.data.status
          },
          message: 'Place autocomplete results retrieved successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to get autocomplete results',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        });
      }
    } catch (error) {
      console.error('Google Maps Autocomplete Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get autocomplete results',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  })
);

/**
 * @route GET /api/google-maps/places/details
 * @desc Get detailed place information
 * @access Public
 */
router.get('/places/details',
  validateRequest,
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
      const response = await googleMapsClient.placeDetails({
        params: {
          place_id: placeId,
          key: environmentConfig.getGoogleMapsApiKey(),
          fields: fields || 'formatted_address,geometry,name,place_id,types',
          language: language || 'en',
          region: region || 'IN'
        }
      });

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
        res.status(400).json({
          success: false,
          message: 'Failed to get place details',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        });
      }
    } catch (error) {
      console.error('Google Maps Place Details Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get place details',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  })
);

/**
 * @route GET /api/google-maps/directions
 * @desc Get directions between two points
 * @access Public
 */
router.get('/directions',
  validateRequest,
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
      const params = {
        origin,
        destination,
        key: environmentConfig.getGoogleMapsApiKey(),
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
        res.status(400).json({
          success: false,
          message: 'Failed to get directions',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        });
      }
    } catch (error) {
      console.error('Google Maps Directions Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get directions',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  })
);

/**
 * @route GET /api/google-maps/geocode
 * @desc Geocode an address to coordinates
 * @access Public
 */
router.get('/geocode',
  validateRequest,
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
      const params = {
        address,
        key: environmentConfig.getGoogleMapsApiKey(),
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
            status: response.data.status
          },
          message: 'Geocoding completed successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to geocode address',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        });
      }
    } catch (error) {
      console.error('Google Maps Geocoding Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to geocode address',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  })
);

/**
 * @route GET /api/google-maps/reverse-geocode
 * @desc Reverse geocode coordinates to address
 * @access Public
 */
router.get('/reverse-geocode',
  validateRequest,
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
      const params = {
        latlng,
        key: environmentConfig.getGoogleMapsApiKey(),
        language
      };

      if (resultType) {
        params.result_type = resultType;
      }

      if (locationType) {
        params.location_type = locationType;
      }

      const response = await googleMapsClient.reverseGeocode({ params });

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
            status: response.data.status
          },
          message: 'Reverse geocoding completed successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to reverse geocode coordinates',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        });
      }
    } catch (error) {
      console.error('Google Maps Reverse Geocoding Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reverse geocode coordinates',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  })
);

/**
 * @route GET /api/google-maps/nearby-places
 * @desc Get nearby places
 * @access Public
 */
router.get('/nearby-places',
  validateRequest,
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
      const params = {
        location,
        key: environmentConfig.getGoogleMapsApiKey(),
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
            htmlAttributions: response.data.html_attributions
          },
          message: 'Nearby places retrieved successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to get nearby places',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        });
      }
    } catch (error) {
      console.error('Google Maps Nearby Places Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get nearby places',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  })
);

/**
 * @route GET /api/google-maps/distance-matrix
 * @desc Get distance matrix between multiple origins and destinations
 * @access Public
 */
router.get('/distance-matrix',
  validateRequest,
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
      const params = {
        origins: origins.split('|'),
        destinations: destinations.split('|'),
        key: environmentConfig.getGoogleMapsApiKey(),
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
        res.status(400).json({
          success: false,
          message: 'Failed to calculate distance matrix',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        });
      }
    } catch (error) {
      console.error('Google Maps Distance Matrix Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to calculate distance matrix',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  })
);

/**
 * @route GET /api/google-maps/elevation
 * @desc Get elevation data for coordinates
 * @access Public
 */
router.get('/elevation',
  validateRequest,
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
      const params = {
        key: environmentConfig.getGoogleMapsApiKey()
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
            status: response.data.status
          },
          message: 'Elevation data retrieved successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to get elevation data',
          error: {
            code: response.data.status,
            message: response.data.error_message || 'Google Maps API error'
          }
        });
      }
    } catch (error) {
      console.error('Google Maps Elevation Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get elevation data',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  })
);

module.exports = router;
