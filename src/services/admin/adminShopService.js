const admin = require('firebase-admin');
const { getFirestore } = require('../firebase');
const shopOnboardingService = require('../shopOnboardingService');
const shopSettingsService = require('../shopSettingsService');
const { verifiedNameFromBank } = require('./shopApprovalPlan');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

class AdminShopService {
  getDb() {
    return getFirestore();
  }

  async listShops({
    limit = 20,
    offset = 0,
    approvalStatus,
    nameSearch,
    upiVerified
  } = {}) {
    const db = this.getDb();
    const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

    let query = db.collection('users').where('userType', '==', 'shop');
    if (approvalStatus) {
      query = query.where('shop.approvalStatus', '==', approvalStatus);
    }

    const snapshot = await query.get();
    const shopIds = snapshot.docs.map((doc) => doc.id);
    const shopSnaps = await Promise.all(
      shopIds.map((id) => db.collection('shops').doc(id).get())
    );
    const shopProfileById = new Map(
      shopSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() || {}])
    );

    const needle = typeof nameSearch === 'string' ? nameSearch.trim().toLowerCase() : '';
    const wantUpiVerified = upiVerified === true || upiVerified === 'true';

    let rows = snapshot.docs.map((doc) => {
      const data = doc.data() || {};
      const shop = data.shop && typeof data.shop === 'object' ? data.shop : {};
      const profile = shopProfileById.get(doc.id) || {};
      const bank = profile.bank && typeof profile.bank === 'object' ? profile.bank : {};
      const verifiedName = verifiedNameFromBank(bank);
      return {
        shopId: doc.id,
        shopName: shop.shopName || data.name || '',
        approvalStatus: shop.approvalStatus || 'pending',
        isActive: data.isActive !== false,
        upiVerified: Boolean(verifiedName),
        upiVerifiedName: verifiedName || null,
        submitted: shop.submitted === true || profile.submitted === true,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      };
    });

    if (needle) {
      rows = rows.filter((row) => row.shopName.toLowerCase().includes(needle));
    }
    if (wantUpiVerified) {
      rows = rows.filter((row) => row.upiVerified);
    }

    rows.sort((a, b) => {
      const aTime = a.updatedAt?.toMillis?.() || new Date(a.updatedAt || 0).getTime() || 0;
      const bTime = b.updatedAt?.toMillis?.() || new Date(b.updatedAt || 0).getTime() || 0;
      return bTime - aTime;
    });

    const page = rows.slice(safeOffset, safeOffset + safeLimit);
    return {
      shops: page,
      pagination: {
        limit: safeLimit,
        offset: safeOffset,
        total: rows.length
      }
    };
  }

  async getShopDetail(shopId) {
    const db = this.getDb();
    const [userSnap, shopSnap] = await Promise.all([
      db.collection('users').doc(shopId).get(),
      db.collection('shops').doc(shopId).get()
    ]);

    if (!userSnap.exists) {
      httpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
    }

    const userData = userSnap.data() || {};
    if (userData.userType !== 'shop') {
      httpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
    }

    const onboardingStatus = await shopOnboardingService.getStatus(shopId);
    const profile = shopSnap.exists ? (shopSnap.data() || {}) : {};
    const bank = profile.bank && typeof profile.bank === 'object' ? profile.bank : {};

    return {
      shopId,
      user: {
        name: userData.name,
        email: userData.email,
        phone: userData.phone,
        isActive: userData.isActive !== false,
        shop: userData.shop || {}
      },
      profile,
      upiVerified: Boolean(verifiedNameFromBank(bank)),
      onboardingStatus
    };
  }

  async verifyUpi(shopId, verifiedName, operator) {
    return shopOnboardingService.adminVerifyUpiName(shopId, verifiedName, operator);
  }

  async approve(shopId, operator) {
    return shopOnboardingService.adminApprove(shopId, operator);
  }

  async reject(shopId, { reason, sections, operator }) {
    return shopOnboardingService.adminReject(shopId, { reason, sections, operator });
  }

  async suspend(shopId, { reason, operator }) {
    if (!reason || !operator) {
      httpError(400, 'MISSING_FIELDS', 'reason and operator are required');
    }
    const result = await shopSettingsService.deactivate(shopId);
    const db = this.getDb();
    await db.collection('users').doc(shopId).set({
      suspendedAt: admin.firestore.FieldValue.serverTimestamp(),
      suspendedBy: operator,
      suspendReason: reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { shopId, suspended: true, result };
  }

  async unsuspend(shopId, operator) {
    const db = this.getDb();
    const userRef = db.collection('users').doc(shopId);
    const snap = await userRef.get();
    if (!snap.exists) {
      httpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
    }
    await userRef.update({
      isActive: true,
      'shop.isOpen': true,
      suspendedAt: null,
      suspendedBy: null,
      suspendReason: null,
      unsuspendedBy: operator || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { shopId, reactivated: true };
  }
}

module.exports = new AdminShopService();
