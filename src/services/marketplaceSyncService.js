const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');
const { appendEvent } = require('./marketplace/orderEvents');
const notificationService = require('./notificationService');
const displayIdService = require('./displayIdService');

const STAGE_ORDER = ['searching', 'assigned', 'at_shop', 'picked_up', 'on_the_way', 'delivered'];
const BELOW_PICKUP = new Set(['searching', 'assigned', 'at_shop']);
const PUSH_BY_STAGE = {
  assigned: 'ORDER_ASSIGNED',
  at_shop: 'DRIVER_AT_SHOP',
  delivered: 'ORDER_DELIVERED'
};

const STATUS_TO_STAGE = {
  pending: 'searching',
  confirmed: 'searching',
  searching: 'searching',
  driver_assigned: 'assigned',
  accepted: 'assigned',
  driver_enroute: 'assigned',
  driver_arrived: 'at_shop',
  picked_up: 'picked_up',
  photo_captured: 'picked_up',
  in_transit: 'on_the_way',
  at_dropoff: 'on_the_way',
  money_collection: 'on_the_way',
  delivered: 'delivered',
  completed: 'delivered',
  cancelled: 'cancelled'
};

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

function currentStageOf(order) {
  const delivery = order && order.delivery;
  if (!delivery || typeof delivery.stage !== 'string' || delivery.stage === '') {
    return null;
  }
  return delivery.stage;
}

function rankOf(stage) {
  return STAGE_ORDER.indexOf(stage);
}

function emptyPlan(stage) {
  return {
    stage,
    clearDriverInfo: false,
    driverInfo: null,
    fare: undefined,
    deliveryFee: undefined,
    event: null,
    complete: false,
    orderStatus: null,
    push: null,
    supportAlert: null
  };
}

function hasDriverInfo(raw) {
  return Boolean(presentDriverInfo(raw));
}

function applyFare(plan, order, booking) {
  const total = booking.fare && booking.fare.totalFare;
  if (typeof total !== 'number' || !Number.isFinite(total)) {
    return;
  }
  const currentFare = order.delivery && typeof order.delivery.fare === 'number'
    ? order.delivery.fare
    : null;
  const currentFee = typeof order.deliveryFee === 'number' ? order.deliveryFee : null;
  if (currentFare !== total || currentFee !== total) {
    plan.fare = total;
    plan.deliveryFee = total;
  }
}

function applyDriver(plan, order, booking) {
  if (plan.clearDriverInfo) {
    return;
  }
  const driverInfo = presentDriverInfo(booking.driverInfo);
  if (!driverInfo) {
    return;
  }
  const current = presentDriverInfo(order.driverInfo);
  const same = current
    && current.name === driverInfo.name
    && current.phone === driverInfo.phone
    && current.vehicle === driverInfo.vehicle;
  if (!same) {
    plan.driverInfo = driverInfo;
  }
}

function planDeliverySync(order, booking) {
  const source = order && typeof order === 'object' ? order : {};
  const status = booking && booking.status;
  const currentStage = currentStageOf(source);
  const plan = emptyPlan(currentStage);
  const mapped = STATUS_TO_STAGE[status];
  if (!mapped) {
    return plan;
  }

  const terminal = source.orderStatus === 'cancelled' || source.orderStatus === 'completed';

  if (status === 'cancelled') {
    if (currentStage !== 'cancelled') {
      plan.stage = 'cancelled';
      plan.event = { stage: 'cancelled', bookingStatus: 'cancelled' };
      plan.supportAlert = 'booking_cancelled';
    }
    applyFare(plan, source, booking);
    return plan;
  }

  if (status === 'pending') {
    const belowPickup = currentStage == null || BELOW_PICKUP.has(currentStage);
    if (!belowPickup) {
      plan.event = { stage: currentStage, bookingStatus: 'pending', kept: true };
      plan.supportAlert = 'pending_after_pickup';
      applyFare(plan, source, booking);
      return plan;
    }
    const stageChange = currentStage !== 'searching';
    const clearDriver = hasDriverInfo(source.driverInfo);
    plan.stage = 'searching';
    plan.clearDriverInfo = clearDriver;
    if (stageChange || clearDriver) {
      plan.event = { stage: 'searching', bookingStatus: 'pending' };
    }
    applyFare(plan, source, booking);
    return plan;
  }

  const nextRank = rankOf(mapped);
  const currentRank = rankOf(currentStage);
  const canAdvance = currentStage !== 'cancelled'
    && nextRank >= 0
    && (currentStage == null || currentRank < 0 || nextRank > currentRank);
  if (canAdvance && mapped !== currentStage) {
    plan.stage = mapped;
    plan.event = { stage: mapped, bookingStatus: status };
    if (PUSH_BY_STAGE[mapped]) {
      plan.push = mapped;
    }
  }

  applyDriver(plan, source, booking);
  applyFare(plan, source, booking);

  const finalStage = plan.stage || currentStage;
  if (!terminal && finalStage === 'delivered' && source.orderStatus === 'handed_over' && plan.event) {
    plan.complete = true;
    plan.orderStatus = 'completed';
  }

  return plan;
}

function planWrites(plan, order) {
  if (!plan) {
    return false;
  }
  if (plan.event || plan.complete || plan.clearDriverInfo || plan.driverInfo) {
    return true;
  }
  if (plan.fare !== undefined) {
    return true;
  }
  const current = currentStageOf(order);
  return Boolean(plan.stage && plan.stage !== current);
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
    if (!change || change.type === 'removed') {
      return null;
    }

    const booking = change.doc.data() || {};
    if (change.type === 'added' && booking.status === 'pending') {
      return null;
    }

    return this.syncBooking({
      bookingId: change.doc.id,
      booking
    });
  }

  async syncBooking({ bookingId, booking }) {
    const orderId = booking && booking.marketplaceOrderId;
    if (!orderId) {
      return null;
    }

    const db = getFirestore();
    const orderRef = db.collection('marketplaceOrders').doc(orderId);
    const outcome = await db.runTransaction(async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        return null;
      }
      const order = orderSnap.data() || {};
      const plan = planDeliverySync(order, booking);
      if (!planWrites(plan, order)) {
        return { wrote: false, plan, order, orderId: orderSnap.id };
      }

      const updates = {};
      const stageNow = currentStageOf(order);
      if (plan.stage && plan.stage !== stageNow) {
        updates['delivery.stage'] = plan.stage;
      }
      if (plan.clearDriverInfo) {
        updates.driverInfo = admin.firestore.FieldValue.delete();
      } else if (plan.driverInfo) {
        updates.driverInfo = plan.driverInfo;
      }
      if (plan.fare !== undefined) {
        updates['delivery.fare'] = plan.fare;
        updates.deliveryFee = plan.deliveryFee;
      }
      if (plan.orderStatus) {
        updates.orderStatus = plan.orderStatus;
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(orderRef, updates);
      }
      if (plan.complete && order.shopId) {
        transaction.set(db.collection('shops').doc(order.shopId), {
          orderCount: admin.firestore.FieldValue.increment(1)
        }, { merge: true });
      }
      if (plan.event) {
        appendEvent(transaction, orderRef, {
          type: 'delivery_stage',
          actor: { type: 'system', id: 'marketplace-sync' },
          data: plan.event
        });
      }

      return { wrote: true, plan, order, orderId: orderSnap.id };
    });

    if (!outcome) {
      return null;
    }

    if (outcome.plan && outcome.plan.supportAlert) {
      console.error('[MARKETPLACE_SYNC] support alert', {
        bookingId: bookingId || null,
        orderId,
        reason: outcome.plan.supportAlert
      });
    }

    if (outcome.wrote && outcome.plan && outcome.plan.push) {
      await this.notifyStage(outcome.order, outcome.orderId, outcome.plan.push);
    }

    if (outcome.wrote) {
      console.log('✅ [MARKETPLACE_SYNC] Mirrored booking change', {
        bookingId: bookingId || null,
        orderId,
        bookingStatus: booking.status,
        stage: outcome.plan.stage,
        completed: outcome.plan.complete === true
      });
    }

    return outcome;
  }

  async notifyStage(order, orderId, stage) {
    const template = PUSH_BY_STAGE[stage];
    const customerId = order && order.customerId;
    if (!template || !customerId) {
      return;
    }
    const snapshot = order.shopSnapshot && typeof order.shopSnapshot === 'object' ? order.shopSnapshot : {};
    try {
      const result = await notificationService.sendTemplateNotification(
        customerId,
        'MARKETPLACE',
        template,
        {
          type: template,
          orderId,
          displayId: displayIdService.formatDisplayId(order.displayId),
          shopName: typeof snapshot.name === 'string' ? snapshot.name : '',
          action: 'view_order'
        }
      );
      if (result && result.success === false) {
        console.error('❌ [MARKETPLACE_SYNC] Notification failed:', (result.error && result.error.code) || result.error);
      }
    } catch (error) {
      console.error('❌ [MARKETPLACE_SYNC] Notification failed:', error.message);
    }
  }
}

const marketplaceSyncService = new MarketplaceSyncService();
marketplaceSyncService.planDeliverySync = planDeliverySync;
marketplaceSyncService.STATUS_TO_STAGE = STATUS_TO_STAGE;
marketplaceSyncService.planWrites = planWrites;

module.exports = marketplaceSyncService;
