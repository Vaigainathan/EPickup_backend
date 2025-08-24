const config = require('../config/environment');

class ServiceAreaValidationService {
  constructor() {
    this.serviceCenter = config.getServiceAreaCenter();
    this.radiusConfig = config.getServiceAreaRadius();
    this.validationConfig = config.getServiceAreaConfig().VALIDATION;
  }

  /**
   * Calculate distance between two points using Haversine formula
   * @param {number} lat1 - Latitude of first point
   * @param {number} lon1 - Longitude of first point
   * @param {number} lat2 - Latitude of second point
   * @param {number} lon2 - Longitude of second point
   * @returns {number} Distance in meters
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  deg2rad(deg) {
    return deg * (Math.PI/180);
  }

  /**
   * Check if a location is within the service area
   * @param {number} latitude - Location latitude
   * @param {number} longitude - Location longitude
   * @returns {Object} Validation result
   */
  validateLocation(latitude, longitude) {
    if (!this.validationConfig.ENABLED) {
      return {
        isValid: true,
        distance: 0,
        message: 'Service area validation disabled'
      };
    }

    const distance = this.calculateDistance(
      this.serviceCenter.LATITUDE,
      this.serviceCenter.LONGITUDE,
      latitude,
      longitude
    );

    const isWithinMinRadius = distance >= this.radiusConfig.MIN_METERS;
    const isWithinMaxRadius = distance <= this.radiusConfig.MAX_METERS;
    const isApproachingBoundary = distance >= this.validationConfig.WARNING_THRESHOLD;

    const isValid = isWithinMinRadius && isWithinMaxRadius;

    let message = '';
    if (!isValid) {
      if (distance < this.radiusConfig.MIN_METERS) {
        message = `Location is too close to ${this.serviceCenter.NAME}. Service is available only within 25 km radius of ${this.serviceCenter.NAME}.`;
      } else {
        message = `Location is outside the service area. Service is available only within 25 km radius of ${this.serviceCenter.NAME}.`;
      }
    } else if (isApproachingBoundary) {
      message = `Location is near the service boundary. Service area extends up to 27 km from ${this.serviceCenter.NAME}.`;
    }

    return {
      isValid,
      distance: Math.round(distance),
      distanceKm: Math.round(distance / 1000 * 10) / 10,
      isApproachingBoundary,
      message,
      serviceCenter: this.serviceCenter,
      radiusConfig: this.radiusConfig
    };
  }

  /**
   * Validate booking locations (pickup and dropoff)
   * @param {Object} bookingData - Booking data with pickup and dropoff coordinates
   * @returns {Object} Validation result
   */
  validateBookingLocations(bookingData) {
    const pickupValidation = this.validateLocation(
      bookingData.pickup.coordinates.latitude,
      bookingData.pickup.coordinates.longitude
    );

    const dropoffValidation = this.validateLocation(
      bookingData.dropoff.coordinates.latitude,
      bookingData.dropoff.coordinates.longitude
    );

    const isValid = pickupValidation.isValid && dropoffValidation.isValid;

    let message = '';
    if (!pickupValidation.isValid) {
      message = `Pickup location: ${pickupValidation.message}`;
    } else if (!dropoffValidation.isValid) {
      message = `Dropoff location: ${dropoffValidation.message}`;
    } else if (pickupValidation.isApproachingBoundary || dropoffValidation.isApproachingBoundary) {
      message = 'One or more locations are near the service boundary.';
    }

    return {
      isValid,
      pickup: pickupValidation,
      dropoff: dropoffValidation,
      message,
      serviceCenter: this.serviceCenter,
      radiusConfig: this.radiusConfig
    };
  }

  /**
   * Validate driver location for going online
   * @param {number} latitude - Driver latitude
   * @param {number} longitude - Driver longitude
   * @returns {Object} Validation result
   */
  validateDriverLocation(latitude, longitude) {
    const validation = this.validateLocation(latitude, longitude);
    
    if (!validation.isValid && this.validationConfig.STRICT_MODE) {
      validation.message = `Driver location is outside service area. Cannot go online. ${validation.message}`;
    }

    return validation;
  }

  /**
   * Get service area information for client apps
   * @returns {Object} Service area information
   */
  getServiceAreaInfo() {
    return {
      center: this.serviceCenter,
      radius: this.radiusConfig,
      validation: this.validationConfig,
      message: `Service is available within ${this.radiusConfig.MIN_METERS/1000}-${this.radiusConfig.MAX_METERS/1000} km radius of ${this.serviceCenter.NAME}`
    };
  }

  /**
   * Check if a route is within service area
   * @param {Array} routeCoordinates - Array of {latitude, longitude} coordinates
   * @returns {Object} Validation result
   */
  validateRoute(routeCoordinates) {
    if (!Array.isArray(routeCoordinates) || routeCoordinates.length === 0) {
      return {
        isValid: false,
        message: 'Invalid route coordinates'
      };
    }

    const validations = routeCoordinates.map(coord => 
      this.validateLocation(coord.latitude, coord.longitude)
    );

    const invalidPoints = validations.filter(v => !v.isValid);
    const approachingBoundaryPoints = validations.filter(v => v.isApproachingBoundary);

    const isValid = invalidPoints.length === 0;

    let message = '';
    if (invalidPoints.length > 0) {
      message = `Route contains ${invalidPoints.length} points outside service area.`;
    } else if (approachingBoundaryPoints.length > 0) {
      message = `Route contains ${approachingBoundaryPoints.length} points near service boundary.`;
    }

    return {
      isValid,
      totalPoints: routeCoordinates.length,
      invalidPoints: invalidPoints.length,
      approachingBoundaryPoints: approachingBoundaryPoints.length,
      message,
      validations
    };
  }
}

module.exports = new ServiceAreaValidationService();
