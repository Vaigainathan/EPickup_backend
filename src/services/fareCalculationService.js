const axios = require('axios');

class FareCalculationService {
    constructor() {
        this.BASE_FARE_PER_KM = 10; // ₹10 per km
        this.COMMISSION_PER_KM = 1; // ₹1 per km commission
        this.MINIMUM_FARE = 50; // Minimum fare for any trip
        this.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    }

    /**
     * Calculate fare based on distance
     * @param {number} distanceKm - Distance in kilometers
     * @returns {Object} Fare breakdown
     */
    calculateFare(distanceKm) {
        const baseFare = Math.max(this.MINIMUM_FARE, distanceKm * this.BASE_FARE_PER_KM);
        const commission = distanceKm * this.COMMISSION_PER_KM;
        const driverNet = baseFare; // Driver gets full amount from customer
        const companyRevenue = commission; // Company gets commission from wallet

        return {
            distanceKm: parseFloat(distanceKm.toFixed(2)),
            baseFare: Math.round(baseFare),
            commission: Math.round(commission),
            driverNet: Math.round(driverNet),
            companyRevenue: Math.round(companyRevenue),
            breakdown: {
                perKmRate: this.BASE_FARE_PER_KM,
                commissionRate: this.COMMISSION_PER_KM,
                minimumFare: this.MINIMUM_FARE
            }
        };
    }

    /**
     * Calculate distance between two points using Google Maps API
     * @param {Object} pickup - Pickup coordinates {lat, lng}
     * @param {Object} dropoff - Dropoff coordinates {lat, lng}
     * @returns {Promise<Object>} Distance and fare details
     */
    async calculateDistanceAndFare(pickup, dropoff) {
        try {
            const distance = await this.getDistanceFromGoogleMaps(pickup, dropoff);
            const fare = this.calculateFare(distance);

            return {
                distanceKm: distance,
                fare: fare,
                pickup: pickup,
                dropoff: dropoff,
                calculatedAt: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error calculating distance and fare:', error);
            throw new Error('Failed to calculate fare');
        }
    }

    /**
     * Get distance from Google Maps Distance Matrix API
     * @param {Object} pickup - Pickup coordinates
     * @param {Object} dropoff - Dropoff coordinates
     * @returns {Promise<number>} Distance in kilometers
     */
    async getDistanceFromGoogleMaps(pickup, dropoff) {
        try {
            const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;
            const params = {
                origins: `${pickup.lat},${pickup.lng}`,
                destinations: `${dropoff.lat},${dropoff.lng}`,
                key: this.GOOGLE_MAPS_API_KEY,
                units: 'metric'
            };

            const response = await axios.get(url, { params });
            
            if (response.data.status === 'OK') {
                const element = response.data.rows[0].elements[0];
                if (element.status === 'OK') {
                    return element.distance.value / 1000; // Convert meters to kilometers
                }
            }
            
            throw new Error('Invalid response from Google Maps API');
        } catch (error) {
            console.error('Google Maps API error:', error);
            // Fallback to direct distance calculation
            return this.calculateDirectDistance(pickup, dropoff);
        }
    }

    /**
     * Calculate direct distance using Haversine formula (fallback)
     * @param {Object} pickup - Pickup coordinates
     * @param {Object} dropoff - Dropoff coordinates
     * @returns {number} Distance in kilometers
     */
    calculateDirectDistance(pickup, dropoff) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = this.toRadians(dropoff.lat - pickup.lat);
        const dLng = this.toRadians(dropoff.lng - pickup.lng);
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRadians(pickup.lat)) * Math.cos(this.toRadians(dropoff.lat)) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Convert degrees to radians
     * @param {number} degrees - Degrees
     * @returns {number} Radians
     */
    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Process trip completion and deduct commission from wallet
     * @param {string} tripId - Trip ID
     * @param {Object} fareDetails - Fare calculation details
     * @param {string} driverId - Driver ID
     * @param {Object} tripDetails - Additional trip details for commission record
     * @returns {Promise<Object>} Updated trip and wallet details
     */
    async processTripCompletion(tripId, fareDetails, driverId, tripDetails = {}) {
        try {
            // Deduct commission from driver's wallet
            const walletUpdate = await this.deductCommissionFromWallet(
                driverId, 
                tripId, 
                fareDetails.fare.distanceKm, 
                fareDetails.fare.commission,
                {
                    pickupLocation: tripDetails.pickupLocation || {},
                    dropoffLocation: tripDetails.dropoffLocation || {},
                    tripFare: fareDetails.fare.baseFare,
                    ...tripDetails
                }
            );
            
            if (!walletUpdate.success) {
                return {
                    success: false,
                    error: walletUpdate.error,
                    walletError: walletUpdate
                };
            }
            
            // Update trip status
            const tripUpdate = await this.updateTripStatus(tripId, 'completed', fareDetails);
            
            return {
                success: true,
                tripId: tripId,
                driverId: driverId,
                fareDetails: fareDetails,
                walletUpdate: walletUpdate,
                tripUpdate: tripUpdate,
                processedAt: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error processing trip completion:', error);
            return {
                success: false,
                error: 'Failed to process trip completion'
            };
        }
    }

    /**
     * Deduct commission from driver's wallet
     * @param {string} driverId - Driver ID
     * @param {string} tripId - Trip ID
     * @param {number} distanceKm - Distance in kilometers
     * @param {number} commissionAmount - Commission amount to deduct
     * @param {Object} tripDetails - Trip details for transaction record
     * @returns {Promise<Object>} Updated wallet details
     */
    async deductCommissionFromWallet(driverId, tripId, distanceKm, commissionAmount, tripDetails = {}) {
        try {
            const walletService = require('./walletService');
            const result = await walletService.deductCommission(
                driverId, 
                tripId, 
                distanceKm, 
                commissionAmount, 
                tripDetails
            );
            
            if (result.success) {
                return {
                    success: true,
                    driverId: driverId,
                    commissionDeducted: result.commissionDeducted,
                    newBalance: result.newBalance,
                    canWork: result.canWork,
                    isLowBalance: result.isLowBalance,
                    remainingTrips: result.remainingTrips,
                    transactionId: result.transactionId,
                    status: 'success'
                };
            } else {
                return {
                    success: false,
                    error: result.error,
                    required: result.required,
                    available: result.available,
                    status: 'failed'
                };
            }
        } catch (error) {
            console.error('Error deducting commission from wallet:', error);
            return {
                success: false,
                error: 'Failed to deduct commission from wallet',
                status: 'error'
            };
        }
    }

    /**
     * Update trip status
     * @param {string} tripId - Trip ID
     * @param {string} status - New status
     * @param {Object} fareDetails - Fare details
     * @returns {Promise<Object>} Updated trip details
     */
    async updateTripStatus(tripId, status, fareDetails) {
        // This would integrate with your trip service
        // For now, returning mock data
        return {
            tripId: tripId,
            status: status,
            fareDetails: fareDetails,
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Get fare estimate for a route
     * @param {Object} pickup - Pickup location
     * @param {Object} dropoff - Dropoff location
     * @returns {Promise<Object>} Fare estimate
     */
    async getFareEstimate(pickup, dropoff) {
        try {
            const distanceAndFare = await this.calculateDistanceAndFare(pickup, dropoff);
            
            return {
                estimate: distanceAndFare.fare,
                distance: distanceAndFare.distanceKm,
                pickup: pickup,
                dropoff: dropoff,
                estimatedAt: new Date().toISOString(),
                validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes validity
            };
        } catch (error) {
            console.error('Error getting fare estimate:', error);
            throw new Error('Failed to get fare estimate');
        }
    }

    /**
     * Validate fare calculation
     * @param {Object} fareDetails - Fare details to validate
     * @returns {boolean} Validation result
     */
    validateFareCalculation(fareDetails) {
        const { distanceKm, baseFare, commission, driverNet } = fareDetails;
        
        // Basic validation
        if (distanceKm <= 0) return false;
        if (baseFare < this.MINIMUM_FARE) return false;
        if (commission !== distanceKm * this.COMMISSION_PER_KM) return false;
        if (driverNet !== baseFare) return false;
        
        return true;
    }
}

module.exports = new FareCalculationService();
