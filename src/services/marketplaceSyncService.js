const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');

function presentDriverInfo(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const name = typeof raw.name === 'string' ? raw.name : '';
  const phone = typeof raw.phone === 'string' ? raw.phone : '';
  const vehicle = typeof raw.vehicle === 'string'
    ? raw.vehicle
    : (typeof raw.vehicleNumber === 'string' ? raw.vehicleNumber : '');
  if (!name && !phone && !vehicle) {
    return null;
  }
  return { name, phone, vehicle };
}

class MarketplaceSyncService {
  constructor() {
    this.unsubscribe = null;
    this.started = false;
  }

  start() {
    if (this.started) {
      console.log('ℹ️ [MARKETPLACE_SYNC] Listener already attached');
      return;
    }

    const db = getFirestore();
    this.started = true;
    this.unsubscribe = db.collection('bookings')
      .where('sourceType', '==', 'marketplace')
      .onSnapshot(
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            this.handleChange(change).catch((error) => {
              console.error('❌ [MARKETPLACE_SYNC] Change handler failed:', error.message);
            });
          });
        },
        (error) => {
          console.error('❌ [MARKETPLACE_SYNC] Listener error:', error.message);
        }
      );

    console.log('✅ [MARKETPLACE_SYNC] Listener attached (bookings sourceType=marketplace)');
  }

  stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.started = false;
    console.log('ℹ️ [MARKETPLACE_SYNC] Listener detached');
  }

  async handleChange(change) {
    if (change.type === 'removed') {
      return;
    }

    const booking = change.doc.data() || {};
    const orderId = booking.marketplaceOrderId;
    if (!orderId) {
      return;
    }

    // Ignore pending creates so this listener does not race mark-ready's own write.
    if (change.type === 'added' && booking.status === 'pending') {
      return;
    }

    const updates = {};
    const driverInfo = presentDriverInfo(booking.driverInfo);
    if (driverInfo) {
      updates.driverInfo = driverInfo;
    }
    if (booking.status === 'delivered') {
      updates.orderStatus = 'completed';
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    const orderRef = getFirestore().collection('marketplaceOrders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return;
    }

    const order = orderSnap.data() || {};
    if (updates.orderStatus === 'completed' && order.orderStatus === 'cancelled') {
      delete updates.orderStatus;
    }
    if (updates.driverInfo && order.driverInfo
      && order.driverInfo.name === updates.driverInfo.name
      && order.driverInfo.phone === updates.driverInfo.phone
      && order.driverInfo.vehicle === updates.driverInfo.vehicle
      && !updates.orderStatus) {
      return;
    }
    if (updates.orderStatus === 'completed' && order.orderStatus === 'completed' && !updates.driverInfo) {
      return;
    }
    if (Object.keys(updates).length === 0) {
      return;
    }

    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await orderRef.update(updates);
    console.log('✅ [MARKETPLACE_SYNC] Mirrored booking change', {
      bookingId: change.doc.id,
      orderId,
      changeType: change.type,
      bookingStatus: booking.status,
      mirrored: Object.keys(updates).filter((key) => key !== 'updatedAt')
    });
  }
}

module.exports = new MarketplaceSyncService();
