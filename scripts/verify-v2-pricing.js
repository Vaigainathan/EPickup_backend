/**
 * Verification Script for v2 Pricing (Three-Tier System)
 * Tests all distance ranges for pricing and commission calculations
 * 
 * Run: node scripts/verify-v2-pricing.js
 */

// Mock the service without Firebase dependency
class FareCalculationService {
    constructor() {
        // ✅ NEW PRICING STRUCTURE v2 (2026-07-24): THREE-TIER SYSTEM
        this.TIER_1_RATE = 5;          // 0-500m = ₹5
        this.TIER_2_RATE = 10;         // 500m-1km = ₹10
        this.TIER_3_RATE = 10;         // Each km after 1km = ₹10
        this.TIER_1_DISTANCE = 0.5;    // 500m
        this.TIER_2_DISTANCE = 1.0;    // 1km
        
        // ✅ NEW COMMISSION STRUCTURE v2 (2026-07-24): FLOOR + SMART REMAINDER
        this.COMMISSION_RATE_PER_KM = 1.15;  // ₹1.15/km flat
        this.COMMISSION_THRESHOLD = 0.5;     // 500m threshold for rounding
    }

    calculateFareWithTieredPricing(exactDistanceKm) {
        if (exactDistanceKm < 0) {
            throw new Error('Distance cannot be negative');
        }

        let totalFare = 0;
        const pricingBreakdown = '';

        if (exactDistanceKm < this.TIER_1_DISTANCE) {
            totalFare = this.TIER_1_RATE;
            pricingBreakdown.push(`0-${(this.TIER_1_DISTANCE * 1000).toFixed(0)}m: ₹${this.TIER_1_RATE}`);
        } else if (exactDistanceKm <= this.TIER_2_DISTANCE) {
            totalFare = this.TIER_2_RATE;
            pricingBreakdown.push(`500m-1km: ₹${this.TIER_2_RATE}`);
        } else {
            totalFare = this.TIER_2_RATE;
            pricingBreakdown.push(`First 1km: ₹${this.TIER_2_RATE}`);

            const remainingDistance = exactDistanceKm - this.TIER_2_DISTANCE;
            const fullKmsRemaining = Math.floor(remainingDistance);
            const remainderKm = remainingDistance - fullKmsRemaining;

            if (fullKmsRemaining > 0) {
                const fullKmCharge = fullKmsRemaining * this.TIER_3_RATE;
                totalFare += fullKmCharge;
                pricingBreakdown.push(`${fullKmsRemaining}km × ₹${this.TIER_3_RATE}: ₹${fullKmCharge}`);
            }

            if (remainderKm > 0) {
                if (remainderKm < this.TIER_1_DISTANCE) {
                    totalFare += this.TIER_1_RATE;
                    pricingBreakdown.push(`${(remainderKm * 1000).toFixed(0)}m remainder: ₹${this.TIER_1_RATE}`);
                } else {
                    totalFare += this.TIER_2_RATE;
                    pricingBreakdown.push(`${(remainderKm * 1000).toFixed(0)}m remainder (rounds): ₹${this.TIER_2_RATE}`);
                }
            }
        }

        // COMMISSION CALCULATION
        let commissionDistance = Math.floor(exactDistanceKm);
        const remainder = exactDistanceKm - commissionDistance;

        if (remainder >= this.COMMISSION_THRESHOLD) {
            commissionDistance += 1;
        }

        commissionDistance = Math.max(1, commissionDistance);
        const totalCommission = Math.round(commissionDistance * this.COMMISSION_RATE_PER_KM * 100) / 100;

        return {
            exactDistanceKm: parseFloat(exactDistanceKm.toFixed(2)),
            roundedDistanceKm: Math.ceil(exactDistanceKm),
            totalFare: Math.round(totalFare * 100) / 100,
            baseFare: Math.round(totalFare * 100) / 100,
            commission: totalCommission,
            driverEarnings: Math.round((totalFare - totalCommission) * 100) / 100,
            breakdown: {
                pricingVersion: 2,
                commissionVersion: 2,
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
}

// Test cases with expected results
const testCases = [
    // TIER 1: 0-500m
    { distance: 0.3, expectedFare: 5, expectedCommission: 1.15, label: 'Tier 1: 0-500m' },
    
    // TIER 2: 500m-1km (rounds up at 500m and above)
    { distance: 0.5, expectedFare: 10, expectedCommission: 1.15, label: 'Tier 2: Exactly 500m (rounds up)' },
    { distance: 0.6, expectedFare: 10, expectedCommission: 1.15, label: 'Tier 2: 600m (rounds up)' },
    { distance: 0.7, expectedFare: 10, expectedCommission: 1.15, label: 'Tier 2: 700m' },
    { distance: 1.0, expectedFare: 10, expectedCommission: 1.15, label: 'Tier 2: Exactly 1km' },
    
    // TIER 3: >1km with remainder tier 1 (<500m)
    { distance: 1.3, expectedFare: 15, expectedCommission: 1.15, label: 'Tier 3: 1.3km (1km + 0.3km tier1)' },
    { distance: 1.4, expectedFare: 15, expectedCommission: 1.15, label: 'Tier 3: 1.4km (1km + 0.4km tier1)' },
    
    // TIER 3: >1km with remainder tier 2 (≥500m)
    { distance: 1.5, expectedFare: 20, expectedCommission: 2.30, label: 'Tier 3: 1.5km (1km + 0.5km tier2, rounds up)' },
    { distance: 1.6, expectedFare: 20, expectedCommission: 2.30, label: 'Tier 3: 1.6km (1km + 0.6km tier2, rounds up)' },
    { distance: 1.7, expectedFare: 20, expectedCommission: 2.30, label: 'Tier 3: 1.7km (1km + 0.7km tier2, rounds up)' },
    
    // TIER 3: 2+km
    { distance: 2.0, expectedFare: 20, expectedCommission: 2.30, label: 'Tier 3: Exactly 2km' },
    { distance: 2.3, expectedFare: 25, expectedCommission: 2.30, label: 'Tier 3: 2.3km (2km + 0.3km tier1)' },
    { distance: 2.5, expectedFare: 30, expectedCommission: 3.45, label: 'Tier 3: 2.5km (2km + 0.5km tier2, rounds up)' },
    { distance: 2.6, expectedFare: 30, expectedCommission: 3.45, label: 'Tier 3: 2.6km (2km + 0.6km tier2, rounds up)' },
    { distance: 3.3, expectedFare: 35, expectedCommission: 3.45, label: 'Tier 3: 3.3km (3km + 0.3km tier1)' },
    
    // Longer distances
    { distance: 5.0, expectedFare: 50, expectedCommission: 5.75, label: 'Tier 3: 5km' },
    { distance: 5.5, expectedFare: 60, expectedCommission: 6.90, label: 'Tier 3: 5.5km (5km + 0.5km rounds up)' },
    { distance: 5.8, expectedFare: 60, expectedCommission: 6.90, label: 'Tier 3: 5.8km (5km + 0.8km rounds up)' },
    { distance: 10.0, expectedFare: 100, expectedCommission: 11.50, label: 'Tier 3: 10km' },
    { distance: 10.3, expectedFare: 105, expectedCommission: 11.50, label: 'Tier 3: 10.3km (0.3km < 0.5km)' },
    { distance: 10.5, expectedFare: 110, expectedCommission: 12.65, label: 'Tier 3: 10.5km (0.5km rounds up)' },
    { distance: 12.3, expectedFare: 125, expectedCommission: 13.80, label: 'Tier 3: 12.3km' },
    { distance: 12.5, expectedFare: 130, expectedCommission: 14.95, label: 'Tier 3: 12.5km (0.5km rounds up)' },
];

// Run tests
const service = new FareCalculationService();
let passed = 0;
let failed = 0;

console.log('\n' + '='.repeat(100));
console.log('V2 PRICING VERIFICATION - THREE-TIER SYSTEM + FLOOR + SMART REMAINDER');
console.log('='.repeat(100) + '\n');

testCases.forEach((test, index) => {
    try {
        const result = service.calculateFareWithTieredPricing(test.distance);
        
        const fareMatch = result.totalFare === test.expectedFare;
        const commissionMatch = result.commission === test.expectedCommission;
        
        const status = (fareMatch && commissionMatch) ? '✅ PASS' : '❌ FAIL';
        
        console.log(`[Test ${index + 1}] ${test.label}`);
        console.log(`  Distance: ${test.distance}km`);
        console.log(`  Pricing: ₹${result.totalFare} (expected ₹${test.expectedFare}) ${fareMatch ? '✓' : '✗'}`);
        console.log(`  Commission: ₹${result.commission} (expected ₹${test.expectedCommission}) ${commissionMatch ? '✓' : '✗'}`);
        console.log(`  Breakdown: ${result.breakdown.pricingBreakdown}`);
        console.log(`  Commission Calc: ${result.breakdown.commissionCalculation}`);
        console.log(`  ${status}\n`);
        
        if (fareMatch && commissionMatch) {
            passed++;
        } else {
            failed++;
        }
    } catch (error) {
        console.log(`[Test ${index + 1}] ${test.label}`);
        console.log(`  ❌ ERROR: ${error.message}\n`);
        failed++;
    }
});

console.log('='.repeat(100));
console.log(`SUMMARY: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
console.log('='.repeat(100) + '\n');

if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED! v2 pricing is correctly implemented.');
    process.exit(0);
} else {
    console.log(`❌ ${failed} tests failed. Please review the pricing logic.`);
    process.exit(1);
}
