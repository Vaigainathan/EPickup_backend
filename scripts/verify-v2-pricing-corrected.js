/**
 * Verification Script for v2 Pricing (Base ₹10/KM Minimum)
 * Tests all distance ranges for pricing and commission calculations
 * 
 * PRICING: 0-1km = ₹10 (flat minimum), then +₹10/km + remainder logic
 * COMMISSION: ₹1.15/km with FLOOR + smart remainder (min 1km)
 * 
 * Run: node scripts/verify-v2-pricing-corrected.js
 */

// Mock the service without Firebase dependency
class FareCalculationService {
    constructor() {
        // ✅ NEW PRICING STRUCTURE v2: BASE ₹10/KM MINIMUM
        this.BASE_RATE = 10;           // 0-1km = ₹10 (flat minimum)
        this.BASE_DISTANCE = 1.0;      // 1km is the base unit
        this.FULL_KM_RATE = 10;        // Each km after 1km = ₹10
        this.REMAINDER_RATE_TIER1 = 5; // <500m remainder = ₹5
        this.REMAINDER_RATE_TIER2 = 10; // ≥500m remainder = ₹10 (rounds up)
        this.REMAINDER_THRESHOLD = 0.5; // 500m threshold for tier 2
        
        // ✅ NEW COMMISSION STRUCTURE v2: FLOOR + SMART REMAINDER
        this.COMMISSION_RATE_PER_KM = 1.15;  // ₹1.15/km flat
        this.COMMISSION_THRESHOLD = 0.5;     // 500m threshold for rounding
    }

    calculateFareWithTieredPricing(exactDistanceKm) {
        if (exactDistanceKm < 0) {
            throw new Error('Distance cannot be negative');
        }

        let totalFare = 0;
        let pricingBreakdown = '';

        if (exactDistanceKm <= this.BASE_DISTANCE) {
            // 0-1km = ₹10 (flat minimum)
            totalFare = this.BASE_RATE;
            pricingBreakdown = `₹${this.BASE_RATE} (0-1km base)`;
        } else {
            // > 1km: ₹10 for first 1km + remainder logic
            totalFare = this.BASE_RATE;
            pricingBreakdown = `₹${this.BASE_RATE} (first 1km)`;

            const remainingDistance = exactDistanceKm - this.BASE_DISTANCE;
            const fullKmsRemaining = Math.floor(remainingDistance);
            const remainderKm = remainingDistance - fullKmsRemaining;

            if (fullKmsRemaining > 0) {
                const fullKmCharge = fullKmsRemaining * this.FULL_KM_RATE;
                totalFare += fullKmCharge;
                pricingBreakdown += ` + ₹${fullKmCharge} (${fullKmsRemaining}km)`;
            }

            if (remainderKm > 0) {
                if (remainderKm < this.REMAINDER_THRESHOLD) {
                    totalFare += this.REMAINDER_RATE_TIER1;
                    pricingBreakdown += ` + ₹${this.REMAINDER_RATE_TIER1} (${(remainderKm * 1000).toFixed(0)}m)`;
                } else {
                    totalFare += this.REMAINDER_RATE_TIER2;
                    pricingBreakdown += ` + ₹${this.REMAINDER_RATE_TIER2} (${(remainderKm * 1000).toFixed(0)}m rounds)`;
                }
            }
        }

        // COMMISSION CALCULATION: FLOOR + SMART REMAINDER
        let commissionDistance = Math.floor(exactDistanceKm);
        const remainder = exactDistanceKm - commissionDistance;

        if (remainder >= this.COMMISSION_THRESHOLD) {
            commissionDistance += 1;
        }

        commissionDistance = Math.max(1, commissionDistance);
        const totalCommission = Math.round(commissionDistance * this.COMMISSION_RATE_PER_KM * 100) / 100;

        return {
            exactDistanceKm: parseFloat(exactDistanceKm.toFixed(2)),
            totalFare: Math.round(totalFare * 100) / 100,
            commission: totalCommission,
            driverEarnings: Math.round((totalFare - totalCommission) * 100) / 100,
            pricingBreakdown: pricingBreakdown,
            commissionBreakdown: `${commissionDistance}km × ₹${this.COMMISSION_RATE_PER_KM} = ₹${totalCommission}`
        };
    }
}

// Test cases with expected results
const testCases = [
    // BASE RATE: 0-1km = ₹10 (flat minimum)
    { distance: 0.3, expectedFare: 10, expectedCommission: 1.15, label: 'Base: 0.3km' },
    { distance: 0.5, expectedFare: 10, expectedCommission: 1.15, label: 'Base: 0.5km' },
    { distance: 1.0, expectedFare: 10, expectedCommission: 1.15, label: 'Base: Exactly 1km' },
    
    // >1km with remainder tier 1 (<500m)
    { distance: 1.3, expectedFare: 15, expectedCommission: 1.15, label: '>1km: 1.3km (₹10 + ₹5)' },
    { distance: 1.4, expectedFare: 15, expectedCommission: 1.15, label: '>1km: 1.4km (₹10 + ₹5)' },
    
    // >1km with remainder tier 2 (≥500m)
    { distance: 1.5, expectedFare: 20, expectedCommission: 2.30, label: '>1km: 1.5km (₹10 + ₹10 rounds)' },
    { distance: 1.6, expectedFare: 20, expectedCommission: 2.30, label: '>1km: 1.6km (₹10 + ₹10 rounds)' },
    { distance: 1.7, expectedFare: 20, expectedCommission: 2.30, label: '>1km: 1.7km (₹10 + ₹10 rounds)' },
    
    // >1km with multiple full km
    { distance: 2.0, expectedFare: 20, expectedCommission: 2.30, label: '>1km: Exactly 2km' },
    { distance: 2.3, expectedFare: 25, expectedCommission: 2.30, label: '>1km: 2.3km (₹10 + ₹10 + ₹5)' },
    { distance: 2.5, expectedFare: 30, expectedCommission: 3.45, label: '>1km: 2.5km (₹10 + ₹10 + ₹10 rounds)' },
    { distance: 2.6, expectedFare: 30, expectedCommission: 3.45, label: '>1km: 2.6km (₹10 + ₹10 + ₹10 rounds)' },
    { distance: 3.3, expectedFare: 35, expectedCommission: 3.45, label: '>1km: 3.3km (₹30 + ₹5)' },
    
    // Longer distances
    { distance: 5.0, expectedFare: 50, expectedCommission: 5.75, label: '>1km: 5km' },
    { distance: 5.5, expectedFare: 60, expectedCommission: 6.90, label: '>1km: 5.5km (rounds to 6km)' },
    { distance: 5.8, expectedFare: 60, expectedCommission: 6.90, label: '>1km: 5.8km (₹40 + ₹10)' },
    { distance: 10.0, expectedFare: 100, expectedCommission: 11.50, label: '>1km: 10km' },
    { distance: 10.3, expectedFare: 105, expectedCommission: 11.50, label: '>1km: 10.3km (₹100 + ₹5)' },
    { distance: 10.5, expectedFare: 110, expectedCommission: 12.65, label: '>1km: 10.5km (rounds to 11km)' },
    { distance: 12.3, expectedFare: 125, expectedCommission: 13.80, label: '>1km: 12.3km (₹120 + ₹5)' },
    { distance: 12.5, expectedFare: 130, expectedCommission: 14.95, label: '>1km: 12.5km (rounds to 13km)' },
];

// Run tests
const service = new FareCalculationService();
let passed = 0;
let failed = 0;

console.log('\n' + '='.repeat(100));
console.log('V2 PRICING VERIFICATION - BASE ₹10/KM MINIMUM + COMMISSION FLOOR + SMART REMAINDER');
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
        console.log(`  Breakdown: ${result.pricingBreakdown}`);
        console.log(`  Commission Calc: ${result.commissionBreakdown}`);
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
    console.log('🎉 ALL TESTS PASSED! v2 pricing (₹10/km base minimum) is correctly implemented.');
    process.exit(0);
} else {
    console.log(`❌ ${failed} tests failed. Please review the pricing logic.`);
    process.exit(1);
}
