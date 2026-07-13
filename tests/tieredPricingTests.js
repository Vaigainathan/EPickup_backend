/**
 * Unit tests for tiered pricing calculation with BASE RATE (first 2km)
 * Tests the new ₹20 base (first 2km) + ₹10/km tiered + ₹5 for 100-500m logic
 * 
 * NEW PRICING:
 * - ≤2km: ₹20 flat
 * - >2km: ₹20 (base) + ₹10/km for additional + ₹5 for 100-500m remainder
 * 
 * NEW COMMISSION:
 * - ≤2km: ₹2.30 flat
 * - >2km: ₹2.30 (base) + ₹1.15/km for additional full kms only
 */

const fareCalculationService = require('../src/services/fareCalculationService');

// Test cases with new base rate pricing and commission structure
const testCases = [
    // ✅ BASE RATE TESTS (≤2km)
    {
        distance: 1.8,
        expected: {
            totalFare: 20,
            commission: 2.30,
            description: '1.8km → ₹20 (base rate), Commission ₹2.30'
        }
    },
    {
        distance: 2.0,
        expected: {
            totalFare: 20,
            commission: 2.30,
            description: '2km → ₹20 (base rate), Commission ₹2.30'
        }
    },
    // ✅ BASE RATE + REMAINDER TESTS (>2km with remainder ≤500m)
    {
        distance: 2.5,
        expected: {
            totalFare: 25,
            commission: 2.30,
            description: '2.5km → ₹25 (₹20 base + ₹5 for 0.5km), Commission ₹2.30 (no commission for remainder)'
        }
    },
    // ✅ BASE RATE + FULL KM + REMAINDER TESTS
    {
        distance: 3.2,
        expected: {
            totalFare: 35,
            commission: 3.45,
            description: '3.2km → ₹35 (₹20 + ₹10 + ₹5), Commission ₹3.45 (₹2.30 base + ₹1.15 for 1km)'
        }
    },
    {
        distance: 5.0,
        expected: {
            totalFare: 50,
            commission: 5.75,
            description: '5km → ₹50 (₹20 + ₹30), Commission ₹5.75 (₹2.30 + 3×₹1.15)'
        }
    },
    // ✅ BASE RATE + ROUNDING TEST (remainder >500m rounds up)
    {
        distance: 5.7,
        expected: {
            totalFare: 60,
            commission: 6.90,
            description: '5.7km → ₹60 (₹20 + ₹40 rounded for 0.7km→1km), Commission ₹6.90 (₹2.30 + 4×₹1.15)'
        }
    },
    {
        distance: 3.6,
        expected: {
            totalFare: 40,
            commission: 4.60,
            description: '3.6km → ₹40 (₹20 + ₹20 rounded for 1.6km→2km), Commission ₹4.60 (₹2.30 + 2×₹1.15)'
        }
    },
    // ✅ LONG DISTANCE TEST
    {
        distance: 8.2,
        expected: {
            totalFare: 85,
            commission: 9.20,
            description: '8.2km → ₹85 (₹20 base + ₹60 for 6km + ₹5), Commission ₹9.20 (₹2.30 + 6×₹1.15)'
        }
    },
    // ✅ EDGE CASE: Exactly 0.5km remainder
    {
        distance: 2.5,
        expected: {
            totalFare: 25,
            commission: 2.30,
            description: '2.5km → ₹25, Commission ₹2.30 (exactly 0.5km remainder, no commission)'
        }
    },
    // ✅ EDGE CASE: Just over 0.5km remainder (rounds up)
    {
        distance: 2.51,
        expected: {
            totalFare: 30,
            commission: 3.45,
            description: '2.51km → ₹30 (₹20 + ₹10 rounded), Commission ₹3.45 (rounds up 1km, gets ₹1.15)'
        }
    }
];

// Run tests
console.log('🧪 TIERED PRICING CALCULATION TESTS (With Base Rate & New Commission)\n');
console.log('='.repeat(90));

let passedTests = 0;
let failedTests = 0;

testCases.forEach((testCase, index) => {
    console.log(`\n📍 Test ${index + 1}: ${testCase.expected.description}`);
    console.log('-'.repeat(90));

    try {
        const result = fareCalculationService.calculateFare(testCase.distance);

        // Verify each component
        const checks = [
            { 
                name: 'Total Fare', 
                expected: testCase.expected.totalFare, 
                actual: result.totalFare,
                pass: result.totalFare === testCase.expected.totalFare
            },
            { 
                name: 'Commission', 
                expected: testCase.expected.commission, 
                actual: Math.round(result.commission * 100) / 100,
                pass: Math.round(result.commission * 100) / 100 === testCase.expected.commission
            }
        ];

        let testPassed = true;
        checks.forEach(check => {
            const status = check.pass ? '✅' : '❌';
            console.log(`  ${status} ${check.name}: Expected ₹${check.expected}, Got ₹${check.actual}`);
            if (!check.pass) testPassed = false;
        });

        if (testPassed) {
            console.log(`\n🎉 TEST PASSED`);
            passedTests++;
        } else {
            console.log(`\n❌ TEST FAILED`);
            failedTests++;
        }

        // Show full result object
        console.log('\nFull Result:', JSON.stringify({
            distance: result.exactDistanceKm,
            totalFare: result.totalFare,
            commission: result.commission,
            driverNet: result.driverNet,
            companyRevenue: result.companyRevenue,
            pricingBreakdown: result.breakdown.priceBreakdown,
            commissionBreakdown: result.breakdown.commissionBreakdown,
            pricingVersion: result.breakdown.pricingVersion,
            details: result.breakdown.details
        }, null, 2));

    } catch (error) {
        console.log(`❌ ERROR: ${error.message}`);
        console.log(error.stack);
        failedTests++;
    }
});

// Summary
console.log('\n' + '='.repeat(90));
console.log('\n📊 TEST SUMMARY');
console.log(`✅ Passed: ${passedTests}`);
console.log(`❌ Failed: ${failedTests}`);
console.log(`📈 Total: ${passedTests + failedTests}`);
console.log(`✨ Success Rate: ${Math.round((passedTests / (passedTests + failedTests)) * 100)}%\n`);

if (failedTests === 0) {
    console.log('🎉 All tests passed! ✨\n');
    console.log('✅ Base rate pricing verified');
    console.log('✅ Commission structure verified');
    console.log('✅ All edge cases covered\n');
    process.exit(0);
} else {
    console.log('⚠️ Some tests failed! Please review.\n');
    process.exit(1);
}
