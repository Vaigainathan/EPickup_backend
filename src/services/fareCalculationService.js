/**
 * ⚠️ AUTHORITATIVE SOURCE OF TRUTH for fare calculations
 * 
 * This is the ONLY authoritative source for pricing logic.
 * All other files (customer app, driver app, bookingService.js) should match this.
 * 
 * PRICING STRUCTURE (UPDATED):
 * - Base rate (first 2km): ₹20 flat
 * - After 2km: ₹10/km + ₹5 for 100-500m remainder
 * - Rounding: >500m remainder rounds up to next km at ₹10
 * 
 * COMMISSION STRUCTURE (UPDATED):
 * - Base commission (first 2km): ₹2.30 fixed
 * - Additional full km: ₹1.15/km
 * - Remainder (100-500m): ₹0 (NO commission)
 * - Remainder >500m: ₹1.15 for rounded km
 * 
 * Examples:
 * - 1.8km → Price ₹20, Commission ₹2.30
 * - 2km → Price ₹20, Commission ₹2.30
 * - 2.5km → Price ₹25 (₹20 + ₹5), Commission ₹2.30 (no commission for 0.5km remainder)
 * - 3.2km → Price ₹35 (₹20 + ₹10 + ₹5), Commission ₹3.45 (₹2.30 + ₹1.15)
 * - 8.2km → Price ₹105 (₹20 + ₹80 + ₹5), Commission ₹9.20 (₹2.30 + 6×₹1.15)
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
        // ✅ NEW PRICING STRUCTURE: Base rate for first 2km
        this.BASE_RATE_FIRST_2KM = 20; // ₹20 for any distance ≤ 2km
        this.BASE_RATE_DISTANCE = 2; // First 2km get base rate
        this.FULL_KM_RATE_AFTER_BASE = 10; // ₹10 per km after first 2km
        
        // ✅ NEW COMMISSION STRUCTURE: Separated base and per-km
        this.BASE_COMMISSION = 2.30; // ₹2.30 fixed for first 2km
        this.COMMISSION_PER_KM_ADDITIONAL = 1.15; // ₹1.15 per additional full km only
        
        // Legacy constants (kept for backward compatibility)
        this.BASE_FARE_PER_KM = 10;
        this.COMMISSION_PER_KM = 1.15;
        this.MINIMUM_FARE = 0;
        this.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
        
        // Tiered pricing constants
        this.TIERED_PRICING_ENABLED = true;
        this.FULL_KM_RATE = 10;
        this.REMAINDER_RATE = 5;
        this.MIN_REMAINDER_KM = 0.1;
        this.MAX_REMAINDER_KM = 0.5;
    }

    /**
     * Calculate fare with new base rate (first 2km) + tiered pricing system
     * 
     * PRICING:
     * - ≤2km: ₹20 flat
     * - >2km: ₹20 (base) + tiered pricing for (distance - 2km)
     *   - Each full km: ₹10
     *   - 100-500m remainder: ₹5
     *   - >500m remainder: rounds to next km at ₹10
     * 
     * COMMISSION:
     * - ≤2km: ₹2.30 fixed
     * - >2km: ₹2.30 (base) + ₹1.15 per full km of additional distance only
     *   - 100-500m remainder: ₹0 (no commission)
     *   - >500m remainder: ₹1.15 for rounded km
     * 
     * Examples:
     * - 1.8km → Price ₹20, Commission ₹2.30
     * - 2km → Price ₹20, Commission ₹2.30
     * - 2.5km → Price ₹25 (₹20 + ₹5), Commission ₹2.30 (no commission for 0.5km remainder)
     * - 3.2km → Price ₹35 (₹20 + ₹10 + ₹5), Commission ₹3.45 (₹2.30 + ₹1.15 for 1km)
     * - 5.7km → Price ₹60 (₹20 + ₹30 + round 0.7→₹10), Commission ₹6.90 (₹2.30 + 3×₹1.15 + ₹1.15 rounded)
     * - 8.2km → Price ₹105 (₹20 + ₹80 + ₹5), Commission ₹9.20 (₹2.30 + 6×₹1.15)
     * 
     * @param {number} exactDistanceKm - Exact distance in kilometers
     * @returns {Object} Fare and commission breakdown
     */
    calculateFareWithTieredPricing(exactDistanceKm) {
        // Handle edge cases
        if (exactDistanceKm < 0) {
            throw new Error('Distance cannot be negative');
        }

        // ✅ NEW LOGIC: Apply base rate for first 2km
        if (exactDistanceKm <= this.BASE_RATE_DISTANCE) {
            // Distance ≤ 2km: Flat rate
            const roundedDistanceKm = Math.ceil(exactDistanceKm);

            return {
                exactDistanceKm: parseFloat(exactDistanceKm.toFixed(2)),
                roundedDistanceKm: roundedDistanceKm,
                fullKm: Math.floor(exactDistanceKm),
                remainderKm: parseFloat((exactDistanceKm - Math.floor(exactDistanceKm)).toFixed(2)),
                fullKmCharge: this.BASE_RATE_FIRST_2KM,
                remainderCharge: 0,
                totalFare: this.BASE_RATE_FIRST_2KM,
                baseFare: this.BASE_RATE_FIRST_2KM,
                commission: Math.round(this.BASE_COMMISSION * 100) / 100, // Keep 2 decimals
                driverNet: this.BASE_RATE_FIRST_2KM,
                companyRevenue: Math.round(this.BASE_COMMISSION * 100) / 100,
                breakdown: {
                    perKmRate: this.BASE_RATE_FIRST_2KM / this.BASE_RATE_DISTANCE, // Effective rate
                    remainderRate: this.REMAINDER_RATE,
                    commissionRate: this.BASE_COMMISSION,
                    calculationMethod: 'base_rate',
                    exactDistance: parseFloat(exactDistanceKm.toFixed(2)),
                    pricingVersion: 3, // New base rate version
                    priceBreakdown: `₹${this.BASE_RATE_FIRST_2KM} (base rate for first 2km)`,
                    commissionBreakdown: `₹${this.BASE_COMMISSION.toFixed(2)} (base commission)`
                }
            };
        }

        // ✅ NEW LOGIC: For distance > 2km, apply tiered pricing to remainder
        const basePrice = this.BASE_RATE_FIRST_2KM;
        const baseCommission = this.BASE_COMMISSION;
        
        // Distance after base rate
        const remainingDistance = exactDistanceKm - this.BASE_RATE_DISTANCE;
        const fullKmRemaining = Math.floor(remainingDistance);
        const remainderKmRemaining = remainingDistance - fullKmRemaining;

        // Calculate pricing for remaining distance
        let additionalPrice = fullKmRemaining * this.FULL_KM_RATE_AFTER_BASE;
        const additionalCommission = fullKmRemaining * this.COMMISSION_PER_KM_ADDITIONAL;
        let remainderCharge = 0;
        let roundedKmExtra = 0;

        if (remainderKmRemaining === 0) {
            // No remainder
            remainderCharge = 0;
            roundedKmExtra = 0;
        } else if (remainderKmRemaining < this.MIN_REMAINDER_KM) {
            // Less than 100m: Apply minimum charge
            remainderCharge = this.REMAINDER_RATE;
            roundedKmExtra = 0; // No commission for remainder < 100m
        } else if (remainderKmRemaining <= this.MAX_REMAINDER_KM) {
            // 100m to 500m: Single flat charge
            remainderCharge = this.REMAINDER_RATE;
            roundedKmExtra = 0; // No commission for 100-500m remainder
        } else {
            // More than 500m: Round up to next km
            additionalPrice += this.FULL_KM_RATE_AFTER_BASE;
            roundedKmExtra = 1; // One more km for commission
            remainderCharge = 0;
        }

        // Total values
        const totalPrice = basePrice + additionalPrice + remainderCharge;
        const totalCommission = baseCommission + additionalCommission + (roundedKmExtra * this.COMMISSION_PER_KM_ADDITIONAL);
        const driverNet = Math.round(totalPrice);
        
        // For booking storage
        const totalFullKm = this.BASE_RATE_DISTANCE + fullKmRemaining + (remainderKmRemaining > this.MAX_REMAINDER_KM ? 1 : 0);
        const finalRemainder = remainderKmRemaining > this.MAX_REMAINDER_KM ? 0 : remainderKmRemaining;

        return {
            exactDistanceKm: parseFloat(exactDistanceKm.toFixed(2)),
            roundedDistanceKm: totalFullKm,
            fullKm: Math.floor(exactDistanceKm),
            remainderKm: parseFloat(finalRemainder.toFixed(2)),
            fullKmCharge: Math.round(basePrice + additionalPrice),
            remainderCharge: Math.round(remainderCharge),
            totalFare: Math.round(totalPrice),
            baseFare: Math.round(totalPrice), // Keep for backward compatibility
            commission: Math.round(totalCommission * 100) / 100,
            driverNet: Math.round(driverNet),
            companyRevenue: Math.round(totalCommission * 100) / 100,
            breakdown: {
                perKmRate: this.FULL_KM_RATE_AFTER_BASE,
                remainderRate: this.REMAINDER_RATE,
                commissionRate: this.COMMISSION_PER_KM_ADDITIONAL,
                baseRate: this.BASE_RATE_FIRST_2KM,
                baseCommission: this.BASE_COMMISSION,
                calculationMethod: 'tiered_with_base_rate',
                exactDistance: parseFloat(exactDistanceKm.toFixed(2)),
                pricingVersion: 3, // New base rate version
                priceBreakdown: `₹${basePrice} (base) + ₹${additionalPrice} (${fullKmRemaining}km) + ₹${remainderCharge} (remainder)`,
                commissionBreakdown: `₹${baseCommission.toFixed(2)} (base) + ₹${Math.round(additionalCommission * 100) / 100} (${fullKmRemaining}km) + ₹${Math.round(roundedKmExtra * this.COMMISSION_PER_KM_ADDITIONAL * 100) / 100} (rounded)`,
                details: {
                    basePrice: this.BASE_RATE_FIRST_2KM,
                    baseCommission: this.BASE_COMMISSION,
                    remainingDistance: parseFloat(remainingDistance.toFixed(2)),
                    fullKmRemaining: fullKmRemaining,
                    remainderKmRemaining: parseFloat(remainderKmRemaining.toFixed(2)),
                    additionalPrice: additionalPrice,
                    additionalCommission: Math.round(additionalCommission * 100) / 100,
                    roundedKmExtra: roundedKmExtra
                }
            }
        };
    }

    /**
     * Calculate fare based on distance (primary entry point)
     * Delegates to tiered pricing with base rate
     * @param {number} exactDistanceKm - Exact distance in kilometers
     * @returns {Object} Fare breakdown
     */
    calculateFare(exactDistanceKm) {
        // Use new tiered pricing system with base rate (always enabled)
        return this.calculateFareWithTieredPricing(exactDistanceKm);
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
