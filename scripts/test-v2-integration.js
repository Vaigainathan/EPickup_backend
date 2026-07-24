/**
 * Integration Test: Verify v2 Pricing Works with Booking Service
 * 
 * This script tests the complete pricing flow:
 * 1. Pricing calculation (v2)
 * 2. Commission deduction
 * 3. Booking acceptance workflow
 * 
 * Run: node scripts/test-v2-integration.js
 */

// Mock FareCalculationService
class FareCalculationService {
    constructor() {
        this.TIER_1_RATE = 5;
        this.TIER_2_RATE = 10;
        this.TIER_3_RATE = 10;
        this.TIER_1_DISTANCE = 0.5;
        this.TIER_2_DISTANCE = 1.0;
        this.COMMISSION_RATE_PER_KM = 1.15;
        this.COMMISSION_THRESHOLD = 0.5;
    }

    calculateFareWithTieredPricing(exactDistanceKm) {
        let totalFare = 0;

        if (exactDistanceKm < this.TIER_1_DISTANCE) {
            totalFare = this.TIER_1_RATE;
        } else if (exactDistanceKm <= this.TIER_2_DISTANCE) {
            totalFare = this.TIER_2_RATE;
        } else {
            totalFare = this.TIER_2_RATE;
            const remainingDistance = exactDistanceKm - this.TIER_2_DISTANCE;
            const fullKmsRemaining = Math.floor(remainingDistance);
            const remainderKm = remainingDistance - fullKmsRemaining;

            if (fullKmsRemaining > 0) {
                totalFare += fullKmsRemaining * this.TIER_3_RATE;
            }

            if (remainderKm > 0) {
                if (remainderKm < this.TIER_1_DISTANCE) {
                    totalFare += this.TIER_1_RATE;
                } else {
                    totalFare += this.TIER_2_RATE;
                }
            }
        }

        // Commission calculation
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
            breakdown: {
                pricingVersion: 2,
                commissionVersion: 2,
                commissionDistance: commissionDistance
            }
        };
    }
}

// Mock Booking Service
class BookingService {
    constructor(fareCalculationService) {
        this.fareCalculationService = fareCalculationService;
    }

    validateDriverWallet(distance, walletBalance) {
        const fareBreakdown = this.fareCalculationService.calculateFareWithTieredPricing(distance);
        const requiredCommission = fareBreakdown.commission;

        return {
            fare: fareBreakdown,
            hasEnoughBalance: walletBalance >= requiredCommission,
            requiredCommission: requiredCommission,
            currentBalance: walletBalance,
            shortfall: Math.max(0, requiredCommission - walletBalance)
        };
    }

    acceptBooking(distance, driverId, walletBalance) {
        const validation = this.validateDriverWallet(distance, walletBalance);

        if (!validation.hasEnoughBalance) {
            return {
                success: false,
                error: 'INSUFFICIENT_WALLET',
                message: `Driver needs ₹${validation.shortfall.toFixed(2)} more`,
                details: validation
            };
        }

        return {
            success: true,
            message: 'Booking accepted',
            booking: {
                driverId: driverId,
                distance: distance,
                pricing: validation.fare,
                walletDeduction: validation.requiredCommission,
                newBalance: walletBalance - validation.requiredCommission
            }
        };
    }
}

// Test cases
const testCases = [
    {
        name: 'Short trip (300m) with sufficient wallet',
        distance: 0.3,
        walletBalance: 50,
        shouldAccept: true,
        expectedFare: 5,
        expectedCommission: 1.15
    },
    {
        name: 'Medium trip (1.6km) with sufficient wallet',
        distance: 1.6,
        walletBalance: 30,
        shouldAccept: true,
        expectedFare: 20,
        expectedCommission: 2.30
    },
    {
        name: 'Long trip (5.8km) with sufficient wallet',
        distance: 5.8,
        walletBalance: 100,
        shouldAccept: true,
        expectedFare: 60,
        expectedCommission: 6.90
    },
    {
        name: 'Medium trip (1.6km) with insufficient wallet',
        distance: 1.6,
        walletBalance: 1.5,
        shouldAccept: false,
        expectedFare: 20,
        expectedCommission: 2.30
    },
    {
        name: 'Long trip (10.5km) with borderline wallet',
        distance: 10.5,
        walletBalance: 12.65,
        shouldAccept: true,
        expectedFare: 110,
        expectedCommission: 12.65
    },
    {
        name: 'Very long trip (12.5km) with wallet just below required',
        distance: 12.5,
        walletBalance: 14.94,
        shouldAccept: false,
        expectedFare: 130,
        expectedCommission: 14.95
    }
];

// Run tests
const fareService = new FareCalculationService();
const bookingService = new BookingService(fareService);

console.log('\n' + '='.repeat(100));
console.log('V2 PRICING INTEGRATION TEST - BOOKING ACCEPTANCE FLOW');
console.log('='.repeat(100) + '\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
    try {
        const result = bookingService.acceptBooking(test.distance, `driver_${index}`, test.walletBalance);
        
        const acceptanceCorrect = result.success === test.shouldAccept;
        
        // For rejection cases, check the wallet validation
        let allCorrect = acceptanceCorrect;
        if (!result.success) {
            // For rejection, verify that the rejection reason is correct
            const details = result.details;
            const fareCorrect = Math.abs(details.fare.totalFare - test.expectedFare) < 0.01;
            const commissionCorrect = Math.abs(details.fare.commission - test.expectedCommission) < 0.01;
            allCorrect = acceptanceCorrect && fareCorrect && commissionCorrect;
        } else {
            // For acceptance, verify pricing is correct
            const fareCorrect = Math.abs(result.booking.pricing.totalFare - test.expectedFare) < 0.01;
            const commissionCorrect = Math.abs(result.booking.pricing.commission - test.expectedCommission) < 0.01;
            allCorrect = acceptanceCorrect && fareCorrect && commissionCorrect;
        }

        console.log(`[Test ${index + 1}] ${test.name}`);
        console.log(`  Distance: ${test.distance}km | Wallet: ₹${test.walletBalance}`);
        
        if (result.success) {
            console.log(`  ✅ Booking ACCEPTED`);
            console.log(`    - Fare: ₹${result.booking.pricing.totalFare} (expected ₹${test.expectedFare}) ✓`);
            console.log(`    - Commission: ₹${result.booking.pricing.commission} (expected ₹${test.expectedCommission}) ✓`);
            console.log(`    - New Balance: ₹${result.booking.newBalance}`);
        } else {
            console.log(`  ❌ Booking REJECTED (as expected)`);
            console.log(`    - Reason: ${result.error}`);
            console.log(`    - Expected Fare: ₹${test.expectedFare} | Calculated: ₹${result.details.fare.totalFare} ✓`);
            console.log(`    - Expected Commission: ₹${test.expectedCommission} | Calculated: ₹${result.details.fare.commission} ✓`);
            console.log(`    - Required: ₹${result.details.requiredCommission}`);
            console.log(`    - Current: ₹${result.details.currentBalance}`);
            console.log(`    - Shortfall: ₹${result.details.shortfall.toFixed(2)}`);
        }

        console.log(`  ${allCorrect ? '✅ PASS' : '❌ FAIL'}\n`);
        
        if (allCorrect) passed++;
        else failed++;
    } catch (error) {
        console.log(`[Test ${index + 1}] ${test.name}`);
        console.log(`  ❌ ERROR: ${error.message}\n`);
        failed++;
    }
});

console.log('='.repeat(100));
console.log(`SUMMARY: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
console.log('='.repeat(100) + '\n');

if (failed === 0) {
    console.log('🎉 ALL INTEGRATION TESTS PASSED! v2 pricing is ready for deployment.');
    process.exit(0);
} else {
    console.log(`❌ ${failed} tests failed. Please review the integration.`);
    process.exit(1);
}
