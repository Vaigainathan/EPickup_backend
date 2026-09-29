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

    const db = getFirestore();
    const orderRef = db.collection('marketplaceOrders').doc(orderId);
    const mirrored = await db.runTransaction(async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        return null;
      }

      const order = orderSnap.data() || {};
      const updates = {};
      const driverInfo = presentDriverInfo(booking.driverInfo);
      if (driverInfo) {
        const current = order.driverInfo;
        const sameDriver = current
          && current.name === driverInfo.name
          && current.phone === driverInfo.phone
          && current.vehicle === driverInfo.vehicle;
        if (!sameDriver) {
          updates.driverInfo = driverInfo;
        }
      }

      const completing = booking.status === 'delivered'
        && order.orderStatus !== 'cancelled'
        && order.orderStatus !== 'completed';
      if (completing) {
        updates.orderStatus = 'completed';
      }

      if (Object.keys(updates).length === 0) {
        return null;
      }

      updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      transaction.update(orderRef, updates);

      if (completing && order.shopId) {
        const shopRef = db.collection('shops').doc(order.shopId);
        transaction.set(shopRef, {
          orderCount: admin.firestore.FieldValue.increment(1)
        }, { merge: true });
      }

      return {
        mirrored: Object.keys(updates).filter((key) => key !== 'updatedAt'),
        orderCountIncremented: completing && Boolean(order.shopId)
      };
    });

    if (!mirrored) {
      return;
    }

    console.log('✅ [MARKETPLACE_SYNC] Mirrored booking change', {
      bookingId: change.doc.id,
      orderId,
      changeType: change.type,
      bookingStatus: booking.status,
      mirrored: mirrored.mirrored,
      orderCountIncremented: mirrored.orderCountIncremented
    });
  }
}

module.exports = new MarketplaceSyncService();
