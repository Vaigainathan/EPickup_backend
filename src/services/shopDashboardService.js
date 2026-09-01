const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');

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
   * Placeholder until marketplaceOrders exists (blueprint §2.5 / §4 Dashboard).
   * Do not query Firestore or invent order counts.
   */
  getStats() {
    return {
      todayEarnings: 0,
      totalOrders: 0,
      awaitingPayment: 0,
      preparing: 0,
      ready: 0
    };
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
