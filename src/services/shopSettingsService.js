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
   * marketplaceOrders does not exist yet — always none.
   * Later: query in-progress marketplace orders for this shopId.
   */
  hasInProgressOrders(/* shopId */) {
    return false;
  }

  async deactivate(shopId) {
    if (this.hasInProgressOrders(shopId)) {
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

  /**
   * Placeholder until marketplaceOrders exists. Do not query or invent history.
   */
  getPaymentHistory() {
    return { history: [] };
  }
}

module.exports = new ShopSettingsService();
