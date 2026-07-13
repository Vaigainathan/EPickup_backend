/**
 * ⚠️ AUTHORITATIVE SOURCE OF TRUTH for fare calculations
 * 
 * This is the ONLY authoritative source for pricing logic.
 * All other files (customer app, driver app, bookingService.js) should match this.
 * 
 * CURRENT RATES:
 * - Customer Rate: ₹10/km
 * - Rounding: Math.ceil() (round up to next km, e.g. 8.4km → 9km = ₹90)
 * - Base Fare: ₹0 (removed completely)
 * - Commission: ₹1.15/km (deducted from driver points wallet)
 * - Driver Earnings: Full fare collected from customer
 * - Company Revenue: Points deducted from driver wallet
 * 
 * WHEN CHANGING RATES, UPDATE ALL:
 * 1. backend/src/services/fareCalculationService.js (THIS FILE)
 * 2. backend/src/services/bookingService.js
 * 3. customer-app/services/chargeCalculation.ts
 * 4. customer-app/services/routeCalculationService.ts
 * 5. customer-app/services/fareCalculationService.ts
 */

const axios = require('axios');

class FareCalculationService {
    constructor() {
        this.BASE_FARE_PER_KM = 10; // ₹10 per km (updated from previous rate)
        this.COMMISSION_PER_KM = 1.15; // 1.15 points per km commission (updated from 2)
        this.MINIMUM_FARE = 0; // NO MINIMUM FARE - removed to match customer app pricing
        this.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
        
        // Tiered pricing constants
        this.TIERED_PRICING_ENABLED = true; // Enable new tiered pricing system
        this.FULL_KM_RATE = 10; // ₹10 per full km
        this.REMAINDER_RATE = 5; // ₹5 for 100-500m remainder
        this.MIN_REMAINDER_KM = 0.1; // 100m minimum
        this.MAX_REMAINDER_KM = 0.5; // 500m maximum
    }

    /**
     * Calculate fare with new tiered pricing system
     * Tier 1: 0-0.1km (0-100m) → ₹5 minimum
     * Tier 2: 0.1-0.5km (100-500m) → ₹5 (single charge)
     * Tier 3: >0.5km remainder → Round up to next km at ₹10/km
     * 
     * Examples:
     * - 8.2km → 8km (₹80) + 0.2km (₹5) = ₹85
     * - 5.7km → Rounds to 6km = ₹60
     * - 5.4km → 5km (₹50) + 0.4km (₹5) = ₹55
     * - 0.05km (50m) → ₹5 minimum
     * 
     * @param {number} exactDistanceKm - Exact distance in kilometers
     * @returns {Object} Fare breakdown with tiered calculation
     */
    calculateFareWithTieredPricing(exactDistanceKm) {
        // Handle edge cases
        if (exactDistanceKm < 0) {
            throw new Error('Distance cannot be negative');
        }

        const fullKm = Math.floor(exactDistanceKm);
        const remainderKm = exactDistanceKm - fullKm;

        let fullKmCharge = 0;
        let remainderCharge = 0;
        const calculationMethod = 'tiered_v2';

        // Calculate charge for full kilometers
        fullKmCharge = fullKm * this.FULL_KM_RATE;

        // Calculate charge for remainder
        if (remainderKm === 0) {
            // No remainder, no extra charge
            remainderCharge = 0;
        } else if (remainderKm < this.MIN_REMAINDER_KM) {
            // Less than 100m: Apply minimum charge
            remainderCharge = this.REMAINDER_RATE;
        } else if (remainderKm <= this.MAX_REMAINDER_KM) {
            // 100m to 500m: Single flat charge
            remainderCharge = this.REMAINDER_RATE;
        } else {
            // More than 500m: Round up to next km and add to full km charge
            fullKmCharge += this.FULL_KM_RATE;
            remainderCharge = 0;
        }

        const totalFare = fullKmCharge + remainderCharge;
        const commission = (fullKm + (remainderKm > this.MAX_REMAINDER_KM ? 1 : 0)) * this.COMMISSION_PER_KM;
        const driverNet = totalFare;
        const companyRevenue = commission;
        
        // ✅ CRITICAL FIX: Calculate rounded distance for booking storage
        // If remainder > 0.5km, round up; otherwise use full kilometers
        const roundedDistanceKm = remainderKm > this.MAX_REMAINDER_KM ? fullKm + 1 : fullKm;

        return {
            exactDistanceKm: parseFloat(exactDistanceKm.toFixed(2)),
            roundedDistanceKm: roundedDistanceKm, // ✅ CRITICAL: Required for booking document
            fullKm: fullKm,
            remainderKm: parseFloat(remainderKm.toFixed(2)),
            fullKmCharge: Math.round(fullKmCharge),
            remainderCharge: Math.round(remainderCharge),
            totalFare: Math.round(totalFare),
            baseFare: Math.round(totalFare), // Keep for backward compatibility
            commission: Math.round(commission),
            driverNet: Math.round(driverNet),
            companyRevenue: Math.round(companyRevenue),
            breakdown: {
                perKmRate: this.FULL_KM_RATE,
                remainderRate: this.REMAINDER_RATE,
                commissionRate: this.COMMISSION_PER_KM,
                calculationMethod: calculationMethod,
                exactDistance: parseFloat(exactDistanceKm.toFixed(2)),
                fullKm: fullKm,
                remainderKm: parseFloat(remainderKm.toFixed(2)),
                fullKmCharge: Math.round(fullKmCharge),
                remainderCharge: Math.round(remainderCharge),
                pricingVersion: 2 // New tiered pricing version
            }
        };
    }

    /**
     * Calculate fare based on distance with rounding up to next km
     * @param {number} exactDistanceKm - Exact distance in kilometers
     * @returns {Object} Fare breakdown
     */
    calculateFare(exactDistanceKm) {
        // Use new tiered pricing system
        if (this.TIERED_PRICING_ENABLED) {
            return this.calculateFareWithTieredPricing(exactDistanceKm);
        }
        
        // Fallback to old calculation (for backward compatibility)
        const roundedDistanceKm = Math.ceil(exactDistanceKm);
        const baseFare = roundedDistanceKm * this.BASE_FARE_PER_KM;
        const commission = roundedDistanceKm * this.COMMISSION_PER_KM;
        const driverNet = baseFare;
        const companyRevenue = commission;

        return {
            exactDistanceKm: parseFloat(exactDistanceKm.toFixed(2)),
            roundedDistanceKm: roundedDistanceKm,
            baseFare: Math.round(baseFare),
            commission: Math.round(commission),
            driverNet: Math.round(driverNet),
            companyRevenue: Math.round(companyRevenue),
            breakdown: {
                perKmRate: this.BASE_FARE_PER_KM,
                commissionRate: this.COMMISSION_PER_KM,
                minimumFare: this.MINIMUM_FARE,
                exactDistance: parseFloat(exactDistanceKm.toFixed(2)),
                roundedDistance: roundedDistanceKm,
                pricingVersion: 1
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
            // Deduct commission from driver's points wallet
            const walletUpdate = await this.deductCommissionFromPoints(
                driverId, 
                tripId, 
                fareDetails.fare.roundedDistanceKm, 
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
    async deductCommissionFromPoints(driverId, tripId, distanceKm, commissionAmount, tripDetails = {}) {
        try {
            const pointsService = require('./walletService');
            const result = await pointsService.deductPoints(
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
                    pointsDeducted: result.data.pointsDeducted,
                    newBalance: result.data.newBalance,
                    transactionId: result.data.transactionId,
                    status: 'success'
                };
            } else {
                return {
                    success: false,
                    error: result.error,
                    currentBalance: result.currentBalance,
                    requiredAmount: result.requiredAmount,
                    status: 'failed'
                };
            }
        } catch (error) {
            console.error('Error deducting commission from points:', error);
            return {
                success: false,
                error: 'Failed to deduct commission from points',
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
        if (!fareDetails) return false;

        // For tiered pricing (v2)
        if (fareDetails.breakdown?.pricingVersion === 2) {
            const { exactDistanceKm, fullKmCharge, remainderCharge, driverNet, breakdown } = fareDetails;
            
            if (!exactDistanceKm || exactDistanceKm < 0) return false;
            if (fullKmCharge === undefined || remainderCharge === undefined) return false;
            if (driverNet !== (fullKmCharge + remainderCharge)) return false;
            if (breakdown?.calculationMethod !== 'tiered_v2') return false;
            
            return true;
        }

        // For old pricing (v1) - backward compatibility
        const { distanceKm, baseFare, driverNet } = fareDetails;
        
        if (!distanceKm || distanceKm < 0) return false;
        if (driverNet !== baseFare) return false;
        
        return true;
    }
}

module.exports = new FareCalculationService();
