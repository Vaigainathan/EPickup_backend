const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');

function toJsDate(value) {
  if (!value) {
    return null;
  }
  if (typeof value.toDate === 'function') {
    return value.toDate();
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function kolkataDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function isConfirmedTodayIst(payment) {
  if (!payment || payment.status !== 'confirmed') {
    return false;
  }
  const confirmedAt = toJsDate(payment.confirmedAt);
  if (!confirmedAt) {
    return false;
  }
  return kolkataDateKey(confirmedAt) === kolkataDateKey(new Date());
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

class ShopDashboardService {
  getDb() {
    return getFirestore();
  }

  now() {
    return admin.firestore.FieldValue.serverTimestamp();
  }

  async getUserShop(shopId) {
    const userDoc = await this.getDb().collection('users').doc(shopId).get();
    if (!userDoc.exists) {
      throw httpError(404, 'USER_NOT_FOUND', 'User not found');
    }
    const userData = userDoc.data() || {};
    if (userData.userType !== 'shop') {
      throw httpError(403, 'FORBIDDEN', 'This resource requires shop role');
    }
    return {
      ref: userDoc.ref,
      shop: userData.shop || {}
    };
  }

  /**
   * Per-shop marketplace order stats for the Shop App dashboard contract:
   * todayEarnings, totalOrders, awaitingPayment, preparing, ready.
   */
  async getStats(shopId) {
    const snapshot = await this.getDb()
      .collection('marketplaceOrders')
      .where('shopId', '==', shopId)
      .orderBy('createdAt', 'desc')
      .get();

    const stats = {
      todayEarnings: 0,
      totalOrders: snapshot.size,
      awaitingPayment: 0,
      preparing: 0,
      ready: 0
    };

    snapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      if (data.orderStatus === 'awaiting_payment') {
        stats.awaitingPayment += 1;
      } else if (data.orderStatus === 'preparing') {
        stats.preparing += 1;
      } else if (data.orderStatus === 'ready') {
        stats.ready += 1;
      }

      const payment = data.payment || {};
      if (isConfirmedTodayIst(payment)) {
        stats.todayEarnings += Number(payment.amount) || 0;
      }
    });

    return stats;
  }

  async getProfile(shopId) {
    const shopSettingsService = require('./shopSettingsService');
    return shopSettingsService.getProfile(shopId);
  }

  async setOpenStatus(shopId, isOpen) {
    if (typeof isOpen !== 'boolean') {
      throw httpError(400, 'INVALID_STATUS', 'isOpen must be a boolean');
    }

    const { ref } = await this.getUserShop(shopId);
    await ref.update({
      'shop.isOpen': isOpen,
      updatedAt: this.now()
    });

    return { isOpen };
  }
}

module.exports = new ShopDashboardService();
