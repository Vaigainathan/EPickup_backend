/**
 * Unit tests for tiered pricing calculation
 * Tests the new ₹10/km + ₹5 for 100-500m logic
 */

const fareCalculationService = require('../src/services/fareCalculationService');

// Test cases
const testCases = [
    {
        distance: 8.2,
        expected: {
            fullKm: 8,
            remainderKm: 0.2,
            fullKmCharge: 80,
            remainderCharge: 5,
            totalFare: 85,
            description: '8.2km → 8km (₹80) + 0.2km (₹5) = ₹85'
        }
    },
    {
        distance: 5.7,
        expected: {
            fullKm: 5,
            remainderKm: 0.7,
            fullKmCharge: 60,
            remainderCharge: 0,
            totalFare: 60,
            description: '5.7km → Rounds to 6km = ₹60'
        }
    },
    {
        distance: 5.4,
        expected: {
            fullKm: 5,
            remainderKm: 0.4,
            fullKmCharge: 50,
            remainderCharge: 5,
            totalFare: 55,
            description: '5.4km → 5km (₹50) + 0.4km (₹5) = ₹55'
        }
    },
    {
        distance: 0.05,
        expected: {
            fullKm: 0,
            remainderKm: 0.05,
            fullKmCharge: 0,
            remainderCharge: 5,
            totalFare: 5,
            description: '0.05km (50m) → ₹5 minimum'
        }
    },
    {
        distance: 0.2,
        expected: {
            fullKm: 0,
            remainderKm: 0.2,
            fullKmCharge: 0,
            remainderCharge: 5,
            totalFare: 5,
            description: '0.2km (200m) → ₹5'
        }
    },
    {
        distance: 0.8,
        expected: {
            fullKm: 0,
            remainderKm: 0.8,
            fullKmCharge: 10,
            remainderCharge: 0,
            totalFare: 10,
            description: '0.8km (800m) → 1km → ₹10'
        }
    },
    {
        distance: 10.0,
        expected: {
            fullKm: 10,
            remainderKm: 0,
            fullKmCharge: 100,
            remainderCharge: 0,
            totalFare: 100,
            description: '10km → ₹100'
        }
    },
    {
        distance: 3.5,
        expected: {
            fullKm: 3,
            remainderKm: 0.5,
            fullKmCharge: 30,
            remainderCharge: 5,
            totalFare: 35,
            description: '3.5km → 3km (₹30) + 0.5km (₹5) = ₹35'
        }
    },
    {
        distance: 2.6,
        expected: {
            fullKm: 2,
            remainderKm: 0.6,
            fullKmCharge: 30,
            remainderCharge: 0,
            totalFare: 30,
            description: '2.6km → 3km = ₹30'
        }
    }
];

// Run tests
console.log('🧪 TIERED PRICING CALCULATION TESTS\n');
console.log('=' .repeat(80));

let passedTests = 0;
let failedTests = 0;

testCases.forEach((testCase, index) => {
    console.log(`\n📍 Test ${index + 1}: ${testCase.expected.description}`);
    console.log('-'.repeat(80));

    try {
        const result = fareCalculationService.calculateFare(testCase.distance);

        // Verify each component
        const checks = [
            { 
                name: 'Full KM', 
                expected: testCase.expected.fullKm, 
                actual: result.fullKm,
                pass: result.fullKm === testCase.expected.fullKm
            },
            { 
                name: 'Remainder KM', 
                expected: testCase.expected.remainderKm, 
                actual: Math.round(result.remainderKm * 100) / 100,
                pass: Math.round(result.remainderKm * 100) / 100 === testCase.expected.remainderKm
            },
            { 
                name: 'Full KM Charge', 
                expected: testCase.expected.fullKmCharge, 
                actual: result.fullKmCharge,
                pass: result.fullKmCharge === testCase.expected.fullKmCharge
            },
            { 
                name: 'Remainder Charge', 
                expected: testCase.expected.remainderCharge, 
                actual: result.remainderCharge,
                pass: result.remainderCharge === testCase.expected.remainderCharge
            },
            { 
                name: 'Total Fare', 
                expected: testCase.expected.totalFare, 
                actual: result.totalFare,
                pass: result.totalFare === testCase.expected.totalFare
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
            exactDistance: result.exactDistanceKm,
            fullKm: result.fullKm,
            remainderKm: result.remainderKm,
            fullKmCharge: result.fullKmCharge,
            remainderCharge: result.remainderCharge,
            totalFare: result.totalFare,
            commission: result.commission,
            driverNet: result.driverNet,
            companyRevenue: result.companyRevenue,
            calculationMethod: result.breakdown.calculationMethod,
            pricingVersion: result.breakdown.pricingVersion
        }, null, 2));

    } catch (error) {
        console.log(`❌ ERROR: ${error.message}`);
        failedTests++;
    }
});

// Summary
console.log('\n' + '='.repeat(80));
console.log('\n📊 TEST SUMMARY');
console.log(`✅ Passed: ${passedTests}`);
console.log(`❌ Failed: ${failedTests}`);
console.log(`📈 Total: ${passedTests + failedTests}`);
console.log(`✨ Success Rate: ${Math.round((passedTests / (passedTests + failedTests)) * 100)}%\n`);

if (failedTests === 0) {
    console.log('🎉 All tests passed!\n');
    process.exit(0);
} else {
    console.log('⚠️ Some tests failed!\n');
    process.exit(1);
}
