const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');
const passwordService = require('./passwordService');
const shopOnboardingService = require('./shopOnboardingService');
const notificationService = require('./notificationService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function presentLocation(location) {
  if (!location) {
    return null;
  }
  const lat = location.latitude ?? location._latitude;
  const lng = location.longitude ?? location._longitude;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lng !== 'number' || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function presentBank(bank = {}) {
  return {
    accountHolderName: typeof bank.accountHolderName === 'string' ? bank.accountHolderName : '',
    bankName: typeof bank.bankName === 'string' ? bank.bankName : '',
    accountNumberLast4: typeof bank.accountNumberLast4 === 'string' ? bank.accountNumberLast4 : '',
    ifsc: typeof bank.ifsc === 'string' ? bank.ifsc : '',
    upiId: typeof bank.upiId === 'string' ? bank.upiId : '',
    upiVerified: bank.upiVerified === true
  };
}

class ShopSettingsService {
  getDb() {
    return getFirestore();
  }

  now() {
    return admin.firestore.FieldValue.serverTimestamp();
  }

  async requireCurrentPassword(shopId, currentPassword) {
    if (!currentPassword || typeof currentPassword !== 'string') {
      throw httpError(400, 'MISSING_PASSWORD', 'currentPassword is required');
    }

    try {
      const valid = await passwordService.verifyPasswordForUser(shopId, currentPassword);
      if (!valid) {
        throw httpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
      }
    } catch (error) {
      if (error.status) {
        throw error;
      }
      if (error.message === 'Current password is incorrect') {
        throw httpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
      }
      if (error.message === 'No password set for this account') {
        throw httpError(400, 'NO_PASSWORD', 'No password set for this account');
      }
      if (error.message === 'User not found') {
        throw httpError(404, 'USER_NOT_FOUND', 'User not found');
      }
      throw error;
    }
  }

  async notifySecurity(shopId, type) {
    try {
      await notificationService.sendTemplateNotification(shopId, 'SHOP', type, {});
    } catch (error) {
      console.error('❌ [SHOP_SETTINGS] Security notification failed:', error.message);
    }
  }

  async getProfile(shopId) {
    const ctx = await shopOnboardingService.loadShopContext(shopId);
    const shop = ctx.shop || {};
    const profile = ctx.shopProfile || {};
    const userData = ctx.userData || {};

    return {
      name: typeof userData.name === 'string' ? userData.name : '',
      email: typeof userData.email === 'string' ? userData.email : '',
      phone: typeof userData.phone === 'string' ? userData.phone : '',
      shopName: typeof shop.shopName === 'string' ? shop.shopName : '',
      shopType: typeof shop.shopType === 'string' ? shop.shopType : '',
      isOpen: shop.isOpen === true,
      address: typeof profile.address === 'string' ? profile.address : '',
      location: presentLocation(profile.location),
      bank: presentBank(profile.bank)
    };
  }

  async updateBusinessProfile(shopId, payload) {
    await this.requireCurrentPassword(shopId, payload.currentPassword);
    const ctx = await shopOnboardingService.loadShopContext(shopId);
    await shopOnboardingService.applyBusinessDetails(ctx, payload);
    return this.getProfile(shopId);
  }

  async reuploadDocument(shopId, type, files, payload) {
    const file = type === 'gst' ? files.gst : files.fssai;
    return shopOnboardingService.reuploadDocument(shopId, type, file, payload);
  }

  async verifyUpi(shopId, upiId) {
    return shopOnboardingService.verifyUpi(shopId, upiId, { requireEditable: false });
  }

  async updateBankDetails(shopId, payload) {
    await this.requireCurrentPassword(shopId, payload.currentPassword);
    await shopOnboardingService.saveBankDetails(shopId, payload, { requireEditable: false });
    await this.notifySecurity(shopId, 'BANK_DETAILS_UPDATED');
    return this.getProfile(shopId);
  }

  /**
   * True if this shop has any marketplace order still in preparing, ready, or handed_over.
   */
  async hasInProgressOrders(shopId) {
    const snapshot = await this.getDb()
      .collection('marketplaceOrders')
      .where('shopId', '==', shopId)
      .where('orderStatus', 'in', ['preparing', 'ready', 'handed_over'])
      .limit(1)
      .get();
    return !snapshot.empty;
  }

  async deactivate(shopId) {
    if (await this.hasInProgressOrders(shopId)) {
      throw httpError(409, 'ORDERS_IN_PROGRESS', 'Cannot deactivate while orders are in progress');
    }

    const ctx = await shopOnboardingService.loadShopContext(shopId);
    await ctx.userRef.update({
      isActive: false,
      'shop.isOpen': false,
      updatedAt: this.now()
    });

    return { isActive: false, isOpen: false };
  }

  async updateAccountProfile(shopId, payload) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) {
      throw httpError(400, 'INVALID_ACCOUNT', 'Name is required');
    }

    const updates = {
      name,
      displayName: name,
      updatedAt: this.now()
    };

    if (payload.email !== undefined) {
      const email = typeof payload.email === 'string' ? payload.email.trim() : '';
      if (email && !EMAIL_REGEX.test(email)) {
        throw httpError(400, 'INVALID_EMAIL', 'Invalid email address');
      }
      updates.email = email || null;
    }

    const ctx = await shopOnboardingService.loadShopContext(shopId);
    await ctx.userRef.update(updates);
    return this.getProfile(shopId);
  }

  async updateAccountPassword(shopId, payload) {
    const currentPassword = payload.currentPassword;
    const newPassword = payload.newPassword;
    const confirmPassword = payload.confirmPassword;

    if (!currentPassword || !newPassword || !confirmPassword) {
      throw httpError(400, 'MISSING_PASSWORD', 'currentPassword, newPassword, and confirmPassword are required');
    }
    if (newPassword !== confirmPassword) {
      throw httpError(400, 'PASSWORD_MISMATCH', 'newPassword and confirmPassword must match');
    }

    try {
      await passwordService.changePassword(shopId, currentPassword, newPassword);
    } catch (error) {
      if (error.message === 'Current password is incorrect') {
        throw httpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
      }
      if (error.message && error.message.startsWith('Password validation failed')) {
        throw httpError(400, 'WEAK_PASSWORD', error.message);
      }
      if (error.message === 'No password set for this account') {
        throw httpError(400, 'NO_PASSWORD', 'No password set for this account');
      }
      if (error.message === 'User not found') {
        throw httpError(404, 'USER_NOT_FOUND', 'User not found');
      }
      throw error;
    }

    await this.notifySecurity(shopId, 'PASSWORD_CHANGED');
    return { updated: true };
  }

  timestampMillis(value) {
    if (!value) {
      return 0;
    }
    if (typeof value.toMillis === 'function') {
      return value.toMillis();
    }
    if (typeof value.toDate === 'function') {
      return value.toDate().getTime();
    }
    const date = value instanceof Date ? value : new Date(value);
    const ms = date.getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }

  /**
   * Confirmed and refunded marketplace payments for this shop, newest first.
   * No date-range query — full history only.
   */
  async getPaymentHistory(shopId) {
    const snapshot = await this.getDb()
      .collection('marketplaceOrders')
      .where('shopId', '==', shopId)
      .orderBy('createdAt', 'desc')
      .get();

    const displayIdService = require('./displayIdService');
    const history = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      const payment = data.payment || {};
      const status = payment.status;
      if (status !== 'confirmed' && status !== 'refunded') {
        return;
      }
      const at = status === 'refunded'
        ? (payment.refundedAt || payment.confirmedAt || data.createdAt)
        : (payment.confirmedAt || data.createdAt);
      history.push({
        orderId: doc.id,
        displayId: data.displayId ?? null,
        displayIdFormatted: data.displayId == null ? null : displayIdService.formatDisplayId(data.displayId),
        amount: Number(payment.amount) || 0,
        paymentStatus: status,
        at
      });
    });

    history.sort((a, b) => this.timestampMillis(b.at) - this.timestampMillis(a.at));
    return { history };
  }
}

module.exports = new ShopSettingsService();
