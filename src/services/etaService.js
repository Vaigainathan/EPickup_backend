const axios = require('axios');

/**
 * ETA Service for EPickup
 * Handles accurate ETA calculations using Google Maps API
 */
class ETAService {
  constructor() {
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    this.baseUrl = 'https://maps.googleapis.com/maps/api';
  }

  /**
   * Calculate ETA between two points
   * @param {Object} origin - Origin coordinates
   * @param {Object} destination - Destination coordinates
   * @param {string} mode - Travel mode (driving, walking, bicycling)
   * @returns {Promise<Object>} ETA calculation result
   */
  async calculateETA(origin, destination, mode = 'driving') {
    try {
      const url = `${this.baseUrl}/directions/json`;
      const params = {
        origin: `${origin.latitude},${origin.longitude}`,
        destination: `${destination.latitude},${destination.longitude}`,
        mode: mode,
        key: this.googleMapsApiKey,
        traffic_model: 'best_guess',
        departure_time: 'now'
      };

      const response = await axios.get(url, { params });
      
      if (response.data.status !== 'OK') {
        throw new Error(`Google Maps API error: ${response.data.status}`);
      }

      const route = response.data.routes[0];
      const leg = route.legs[0];

      const etaResult = {
        distance: {
          text: leg.distance.text,
          value: leg.distance.value // meters
        },
        duration: {
          text: leg.duration.text,
          value: leg.duration.value // seconds
        },
        durationInTraffic: leg.duration_in_traffic ? {
          text: leg.duration_in_traffic.text,
          value: leg.duration_in_traffic.value
        } : null,
        eta: this.calculateETAFromDuration(leg.duration_in_traffic || leg.duration),
        polyline: route.overview_polyline.points,
        trafficInfo: this.extractTrafficInfo(route)
      };

      return {
        success: true,
        data: etaResult
      };

    } catch (error) {
      console.error('Error calculating ETA:', error);
      return {
        success: false,
        error: {
          code: 'ETA_CALCULATION_ERROR',
          message: 'Failed to calculate ETA',
          details: error.message
        }
      };
    }
  }

  /**
   * Calculate ETA for driver to pickup location
   * @param {Object} driverLocation - Driver's current location
   * @param {Object} pickupLocation - Pickup location
   * @param {string} vehicleType - Vehicle type
   * @returns {Promise<Object>} Pickup ETA
   */
  async calculatePickupETA(driverLocation, pickupLocation, vehicleType = '2_wheeler') {
    try {
      const mode = this.getTravelMode(vehicleType);
      const result = await this.calculateETA(driverLocation, pickupLocation, mode);

      if (!result.success) {
        return result;
      }

      const pickupETA = {
        ...result.data,
        type: 'pickup',
        estimatedPickupTime: result.data.eta,
        driverDistance: result.data.distance,
        driverDuration: result.data.duration
      };

      return {
        success: true,
        data: pickupETA
      };

    } catch (error) {
      console.error('Error calculating pickup ETA:', error);
      return {
        success: false,
        error: {
          code: 'PICKUP_ETA_ERROR',
          message: 'Failed to calculate pickup ETA',
          details: error.message
        }
      };
    }
  }

  /**
   * Get travel mode based on vehicle type
   * @param {string} vehicleType - Vehicle type
   * @returns {string} Travel mode
   */
  getTravelMode(vehicleType) {
    switch (vehicleType) {
      case '2_wheeler':
        return 'driving';
      case '4_wheeler':
        return 'driving';
      case 'bicycle':
        return 'bicycling';
      case 'walking':
        return 'walking';
      default:
        return 'driving';
    }
  }

  /**
   * Calculate ETA from duration
   * @param {Object} duration - Duration object
   * @returns {Date} Estimated arrival time
   */
  calculateETAFromDuration(duration) {
    const now = new Date();
    const etaSeconds = duration.value || 0;
    return new Date(now.getTime() + (etaSeconds * 1000));
  }

  /**
   * Extract traffic information from route
   * @param {Object} route - Route object from Google Maps API
   * @returns {Object} Traffic information
   */
  extractTrafficInfo(route) {
    const trafficInfo = {
      hasTraffic: false,
      trafficLevel: 'low',
      congestion: 0
    };

    if (route.legs && route.legs[0].duration_in_traffic) {
      const normalDuration = route.legs[0].duration.value;
      const trafficDuration = route.legs[0].duration_in_traffic.value;
      
      trafficInfo.hasTraffic = true;
      trafficInfo.congestion = ((trafficDuration - normalDuration) / normalDuration) * 100;
      
      if (trafficInfo.congestion > 50) {
        trafficInfo.trafficLevel = 'high';
      } else if (trafficInfo.congestion > 20) {
        trafficInfo.trafficLevel = 'medium';
      } else {
        trafficInfo.trafficLevel = 'low';
      }
    }

    return trafficInfo;
  }
}

// Create singleton instance
const etaService = new ETAService();

// Export functions
module.exports = {
  calculateETA: (origin, destination, mode) => 
    etaService.calculateETA(origin, destination, mode),
  calculatePickupETA: (driverLocation, pickupLocation, vehicleType) => 
    etaService.calculatePickupETA(driverLocation, pickupLocation, vehicleType)
};
