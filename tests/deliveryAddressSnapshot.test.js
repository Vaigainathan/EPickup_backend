const { GeoPoint } = require('firebase-admin/firestore');
const {
  addressText,
  snapshotDeliveryAddress
} = require('../src/services/marketplace/createCustomerOrder');

describe('snapshotDeliveryAddress', () => {
  const coords = new GeoPoint(12.4963, 78.5678);
  const customer = { name: 'Customer Name', phone: '9876543210' };

  test('legacy address keeps text and coordinates only in core fields', () => {
    const legacy = {
      id: 'addr_1',
      text: 'Legacy display line',
      coordinates: { latitude: 12.4963, longitude: 78.5678 }
    };
    const snap = snapshotDeliveryAddress(legacy, customer, {
      addressId: 'addr_1',
      coordinates: coords
    });
    expect(snap.addressId).toBe('addr_1');
    expect(snap.text).toBe(addressText(legacy));
    expect(snap.text).toBe('Legacy display line');
    expect(snap.coordinates).toBe(coords);
    expect(snap.receiverName).toBe('Customer Name');
    expect(snap.receiverPhone).toBe('+919876543210');
  });

  test('full structured address copies optional string fields', () => {
    const full = {
      name: 'Work',
      type: 'work',
      address: 'Formatted line',
      houseNo: '12A',
      street: 'Station Road',
      landmark: 'Near bus stand',
      receiverName: 'Receiver',
      receiverPhone: '9123456789',
      coordinates: { latitude: 12.5, longitude: 78.57 }
    };
    const snap = snapshotDeliveryAddress(full, customer, {
      addressId: 'addr_2',
      coordinates: coords
    });
    expect(snap.label).toBe('Work');
    expect(snap.type).toBe('work');
    expect(snap.houseNo).toBe('12A');
    expect(snap.street).toBe('Station Road');
    expect(snap.landmark).toBe('Near bus stand');
    expect(snap.receiverName).toBe('Receiver');
    expect(snap.receiverPhone).toBe('+919123456789');
    expect(snap.text).toBe('Formatted line');
  });
});
