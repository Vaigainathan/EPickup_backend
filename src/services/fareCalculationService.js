/**
 * ⚠️ AUTHORITATIVE SOURCE OF TRUTH for fare calculations
 * 
 * This is the ONLY authoritative source for pricing logic.
 * All other files (customer app, driver app, bookingService.js) should match this.
 * 
 * PRICING STRUCTURE v2 (2026-07-24 UPDATE - THREE-TIER):
 * - Tier 1 (0-500m): ₹5
 * - Tier 2 (500m-1km): ₹10 (rounds up to 1km)
 * - Tier 3 (>1km): ₹10/km additional
 * - Remainder handling: 0-500m = ₹5, 500m-1km = ₹10 (rounds to next km)
 * 
 * COMMISSION STRUCTURE v2 (2026-07-24 UPDATE - FLOOR + SMART REMAINDER):
 * - Flat: ₹1.15/km
 * - Rounding: FLOOR distance, then smart remainder
 *   - Remainder <500m: drop it (don't count)
 *   - Remainder ≥500m: round UP (count as full km)
 * 
 * Examples (PRICING):
 * - 0.3km → ₹5 (tier 1)
 * - 0.7km → ₹10 (tier 2, rounds to 1km)
 * - 1.3km → ₹10 + ₹5 = ₹15 (1km + 0.3km remainder tier 1)
 * - 1.6km → ₹10 + ₹10 = ₹20 (1km + 0.6km remainder tier 2, rounds up)
 * - 2.3km → ₹10 + ₹10 + ₹5 = ₹25
 * - 5.0km → ₹50
 * 
 * Examples (COMMISSION):
 * - 0.3km → floor=0, <500m → min=1km → ₹1.15
 * - 0.6km → floor=0, ≥500m → round UP to 1km → ₹1.15
 * - 1.3km → floor=1, <500m → 1km → ₹1.15
 * - 1.6km → floor=1, ≥500m → round UP to 2km → ₹2.30
 * - 2.6km → floor=2, ≥500m → round UP to 3km → ₹3.45
 * 
 * WHEN CHANGING RATES, UPDATE ALL:
 * 1. backend/src/services/fareCalculationService.js (THIS FILE)
 * 2. backend/src/services/bookingService.js
 * 3. customer-app/services/chargeCalculation.ts
 * 4. customer-app/services/routeCalculationService.ts
 * 5. customer-app/services/fareCalculationService.ts
 * 6. driver-app/services/fareCalculationService.ts
 */

const axios = require('axios');

class FareCalculationService {
    constructor() {
        // ✅ NEW PRICING STRUCTURE v2 (2026-07-24): BASE ₹10/KM MINIMUM
        this.BASE_RATE = 10;           // 0-1km = ₹10 (flat minimum)
        this.BASE_DISTANCE = 1.0;      // 1km is the base unit
        this.FULL_KM_RATE = 10;        // Each km after 1km = ₹10
        this.REMAINDER_RATE_TIER1 = 5; // <500m remainder = ₹5
        this.REMAINDER_RATE_TIER2 = 10; // ≥500m remainder = ₹10 (rounds up)
        this.REMAINDER_THRESHOLD = 0.5; // 500m threshold for tier 2
        
        // ✅ NEW COMMISSION STRUCTURE v2 (2026-07-24): FLOOR + SMART REMAINDER
        this.COMMISSION_RATE_PER_KM = 1.15;  // ₹1.15/km flat
        this.COMMISSION_THRESHOLD = 0.5;     // 500m threshold for rounding
        
        // Legacy constants (kept for backward compatibility)
        this.BASE_FARE_PER_KM = 10;
        this.MINIMUM_FARE = 0;
        this.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    }

    /**
     * Calculate fare with NEW v2 pricing (2026-07-24): BASE ₹10/KM MINIMUM
     * 
     * PRICING STRUCTURE:
     * - 0-1km: ₹10 (flat minimum)
     * - >1km: ₹10 (first 1km) + remainder logic
     *   - Remainder <500m: +₹5
     *   - Remainder ≥500m: +₹10 (rounds up)
     * 
     * COMMISSION (FLOOR + SMART REMAINDER):
     * - FLOOR distance, then:
     *   - Remainder <500m: drop it
     *   - Remainder ≥500m: round UP to next km
     * - Minimum: 1km commission
     * 
     * Examples:
     * - 0.3km → ₹10, Commission ₹1.15
     * - 1.0km → ₹10, Commission ₹1.15
     * - 1.3km → ₹15, Commission ₹1.15 (1km + 0.3km remainder)
     * - 1.6km → ₹20, Commission ₹2.30 (1km + 0.6km rounds up)
     * - 2.3km → ₹25, Commission ₹2.30 (1km + 1km + 0.3km)
     * - 5.0km → ₹50, Commission ₹5.75
     * 
     * @param {number} exactDistanceKm - Exact distance in kilometers
     * @returns {Object} Fare and commission breakdown
     */
    calculateFareWithTieredPricing(exactDistanceKm) {
        // Validate input
        if (exactDistanceKm < 0) {
            throw new Error('Distance cannot be negative');
        }

        // ===== PRICING CALCULATION =====
        let totalFare = 0;
        const pricingBreakdown = [];

        if (exactDistanceKm <= this.BASE_DISTANCE) {
            // 0-1km = ₹10 (flat minimum)
            totalFare = this.BASE_RATE;
            pricingBreakdown.push(`0-1km (base): ₹${this.BASE_RATE}`);
        } else {
            // > 1km: ₹10 for first 1km + remainder logic
            totalFare = this.BASE_RATE; // First 1km = ₹10
            pricingBreakdown.push(`First 1km: ₹${this.BASE_RATE}`);

            const remainingDistance = exactDistanceKm - this.BASE_DISTANCE;
            const fullKmsRemaining = Math.floor(remainingDistance);
            const remainderKm = remainingDistance - fullKmsRemaining;

            // Add charge for full km remaining
            if (fullKmsRemaining > 0) {
                const fullKmCharge = fullKmsRemaining * this.FULL_KM_RATE;
                totalFare += fullKmCharge;
                pricingBreakdown.push(`${fullKmsRemaining}km × ₹${this.FULL_KM_RATE}: ₹${fullKmCharge}`);
            }

            // Add charge for remainder km
            if (remainderKm > 0) {
                if (remainderKm < this.REMAINDER_THRESHOLD) {
                    // <500m remainder = ₹5
                    totalFare += this.REMAINDER_RATE_TIER1;
                    pricingBreakdown.push(`${(remainderKm * 1000).toFixed(0)}m remainder: ₹${this.REMAINDER_RATE_TIER1}`);
                } else {
                    // ≥500m remainder = ₹10 (rounds up)
                    totalFare += this.REMAINDER_RATE_TIER2;
                    pricingBreakdown.push(`${(remainderKm * 1000).toFixed(0)}m remainder (rounds): ₹${this.REMAINDER_RATE_TIER2}`);
                }
            }
        }

        // ===== COMMISSION CALCULATION (v2 FLOOR + SMART REMAINDER) =====
        let commissionDistance = Math.floor(exactDistanceKm); // FLOOR
        const remainder = exactDistanceKm - commissionDistance;

        // Smart remainder handling: if remainder ≥500m, round UP
        if (remainder >= this.COMMISSION_THRESHOLD) {
            commissionDistance += 1;
        }

        // Minimum 1km commission (even for <1km trips)
        commissionDistance = Math.max(1, commissionDistance);

        const totalCommission = Math.round(commissionDistance * this.COMMISSION_RATE_PER_KM * 100) / 100;

        // ===== RETURN RESULT =====
        return {
            exactDistanceKm: parseFloat(exactDistanceKm.toFixed(2)),
            roundedDistanceKm: Math.ceil(exactDistanceKm),
            totalFare: Math.round(totalFare * 100) / 100,
            baseFare: Math.round(totalFare * 100) / 100, // Keep for backward compatibility
            commission: totalCommission,
            driverEarnings: Math.round((totalFare - totalCommission) * 100) / 100,
            breakdown: {
                pricingVersion: 2, // v2 = new three-tier system
                commissionVersion: 2, // v2 = new floor + smart remainder
                distance: parseFloat(exactDistanceKm.toFixed(2)),
                pricingTier: exactDistanceKm <= this.TIER_1_DISTANCE ? 'tier1' : (exactDistanceKm <= this.TIER_2_DISTANCE ? 'tier2' : 'tier3+'),
                pricingBreakdown: pricingBreakdown.join(' + '),
                priceCalculation: `Total: ₹${Math.round(totalFare * 100) / 100}`,
                
                commissionDistance: commissionDistance,
                commissionFloor: Math.floor(exactDistanceKm),
                commissionRemainder: parseFloat(remainder.toFixed(2)),
                commissionRemainderHandling: remainder >= this.COMMISSION_THRESHOLD ? 'rounded_up' : 'dropped',
                commissionCalculation: `${commissionDistance}km × ₹${this.COMMISSION_RATE_PER_KM} = ₹${totalCommission}`,
                
                totalFare: Math.round(totalFare * 100) / 100,
                totalCommission: totalCommission,
                driverEarnings: Math.round((totalFare - totalCommission) * 100) / 100
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
