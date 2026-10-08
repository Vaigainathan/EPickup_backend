const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'epickup-test' });
}

jest.mock('../src/services/firebase', () => {
  const docs = new Map();
  function ref(path) {
    return {
      path,
      async get() {
        const data = docs.get(path);
        return {
          exists: data !== undefined,
          data: () => data
        };
      },
      async set(data) {
        docs.set(path, data);
      },
      collection() {
        return { doc: () => ref(path) };
      }
    };
  }
  const db = {
    collection(name) {
      return {
        doc(id) {
          return ref(`${name}/${id}`);
        }
      };
    }
  };
  return {
    getFirestore: () => db,
    __docs: docs
  };
});

afterAll(async () => {
  await Promise.all(admin.apps.map((app) => app.delete()));
});

const firebase = require('../src/services/firebase');
const notificationService = require('../src/services/notificationService');
const locationTrackingService = require('../src/services/locationTrackingService');
const shopOrderService = require('../src/services/shopOrderService');
const fareCalculationService = require('../src/services/fareCalculationService');
const bookingStateMachine = require('../src/services/bookingStateMachine');
const { fareFieldsFromCalculation } = require('../src/services/fareQuoteService');

function cashConfirmDistanceKm(booking) {
  const exactDistanceKm = Number(
    (booking.distance && booking.distance.total)
    ?? booking.exactDistance
    ?? (booking.pricing && booking.pricing.distance)
    ?? 0
  );
  if (exactDistanceKm > 0) {
    return exactDistanceKm;
  }
  return 0.5;
}

describe('parcel side effects', () => {
  test('marketplace accept, deliver, and tracking do not send parcel customer pushes', async () => {
    const sendToUser = jest.spyOn(notificationService, 'sendToUser').mockResolvedValue({ success: true });
    const assigned = await notificationService.notifyCustomerDriverAssigned(
      { sourceType: 'marketplace', customerId: 'cust-1', id: 'book-1' },
      { name: 'Ravi' }
    );
    const delivered = await notificationService.notifyCustomerPackageDelivered({
      sourceType: 'marketplace',
      customerId: 'cust-1',
      id: 'book-1'
    });
    expect(assigned.skipped).toBe(true);
    expect(delivered.skipped).toBe(true);
    expect(sendToUser).not.toHaveBeenCalled();

    firebase.__docs.set('bookings/book-1', { sourceType: 'marketplace' });
    const tracking = await locationTrackingService.startTracking('book-1', 'driver-1', 'cust-1');
    expect(tracking.skipped).toBe(true);
    expect(locationTrackingService.activeTrackings.has('book-1')).toBe(false);

    await notificationService.notifyCustomerDriverAssigned(
      { sourceType: 'parcel', customerId: 'cust-1', id: 'book-2' },
      { name: 'Ravi' }
    );
    expect(sendToUser).toHaveBeenCalledTimes(1);
    sendToUser.mockRestore();
  });

  test('admin cancel does not send the parcel customer template for marketplace', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../src/routes/adminBookingManagement.js'), 'utf8');
    expect(source).toContain("bookingData.sourceType !== 'marketplace' && notificationService.sendTemplateNotification");
  });

  test('money_collection stays allowed', () => {
    expect(bookingStateMachine.validateTransition('delivered', 'money_collection').isValid).toBe(true);
    expect(bookingStateMachine.validateTransition('money_collection', 'completed').isValid).toBe(true);
  });

  test('marketplace and parcel bookings produce the same cash-confirm commission', () => {
    const distanceKm = 3.6;
    const fare = fareCalculationService.calculateFare(distanceKm);
    const marketplace = shopOrderService.marketplaceBookingFareFields(fare, distanceKm);
    const parcelService = {
      distance: { value: distanceKm, total: distanceKm, text: `${distanceKm} km` }
    };
    const parcelCustomer = fareFieldsFromCalculation(fare, distanceKm);

    const marketplaceKm = cashConfirmDistanceKm(marketplace);
    const serviceKm = cashConfirmDistanceKm(parcelService);
    const customerKm = cashConfirmDistanceKm(parcelCustomer);

    expect(typeof marketplace.distance).toBe('number');
    expect(marketplace.distance).toBe(parcelCustomer.distance);
    expect(marketplace.exactDistance).toBe(parcelCustomer.exactDistance);
    expect(marketplace.exactDistance).toBe(fare.exactDistanceKm);
    expect(marketplace.pricing.distance).toBeUndefined();
    expect(marketplaceKm).toBe(distanceKm);
    expect(marketplaceKm).not.toBe(0.5);
    expect(fareCalculationService.calculateFare(marketplaceKm).commission)
      .toBe(fareCalculationService.calculateFare(serviceKm).commission);
    expect(fareCalculationService.calculateFare(marketplaceKm).commission)
      .toBe(fareCalculationService.calculateFare(customerKm).commission);
    expect(marketplace.fare).toEqual(fareFieldsFromCalculation(fare, distanceKm).fare);
  });
});
