/**
 * Read-only push diagnostics (no Firestore writes).
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function toIso(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return null;
}

function tokenPresence(userData) {
  const data = userData && typeof userData === 'object' ? userData : {};
  const expo = typeof data.expoPushToken === 'string' && data.expoPushToken.trim() !== '';
  const fcm = typeof data.fcmToken === 'string' && data.fcmToken.trim() !== '';
  return { hasExpoPushToken: expo, hasFcmToken: fcm, hasAny: expo || fcm };
}

function summarizeUserDoc(uid, userData) {
  const data = userData && typeof userData === 'object' ? userData : {};
  const userType = data.userType || null;
  const tokens = tokenPresence(data);
  const row = {
    uid,
    userType,
    hasExpoPushToken: tokens.hasExpoPushToken,
    hasFcmToken: tokens.hasFcmToken,
    tokenUpdatedAt: toIso(data.tokenUpdatedAt),
    registrationSource: data.registrationSource ?? null,
    platform: data.platform ?? null,
    deviceIdPresent: typeof data.deviceId === 'string' && data.deviceId.trim() !== ''
  };
  if (userType === 'driver') {
    const driver = data.driver && typeof data.driver === 'object' ? data.driver : {};
    row.isOnline = driver.isOnline === true;
    row.isAvailable = driver.isAvailable === true;
    row.isVerified = driver.verificationStatus === 'verified'
      || driver.verificationStatus === 'approved'
      || data.verificationStatus === 'verified'
      || data.verificationStatus === 'approved';
  }
  return row;
}

function resolveAuthUidFromRoleDoc(roleUid, userData) {
  const data = userData && typeof userData === 'object' ? userData : {};
  const stored = data.originalFirebaseUID;
  if (typeof stored === 'string' && stored.trim() !== '' && stored.trim() !== roleUid) {
    return { authUid: stored.trim(), source: 'originalFirebaseUID' };
  }
  return { authUid: roleUid, source: 'role-id' };
}

function dualDocTokenReport(roleUid, roleData, authSnap) {
  const resolved = resolveAuthUidFromRoleDoc(roleUid, roleData);
  const roleTokens = tokenPresence(roleData);
  let authTokens = { hasExpoPushToken: false, hasFcmToken: false, hasAny: false };
  let authDocExists = false;
  if (resolved.authUid !== roleUid) {
    if (authSnap && authSnap.exists) {
      authDocExists = true;
      authTokens = tokenPresence(authSnap.data());
    }
  }
  return {
    roleUid,
    registerUsesJwtUid: roleUid,
    authUidForSession: resolved.authUid,
    authUidSource: resolved.source,
    tokensOnRoleDoc: roleTokens,
    tokensOnAuthDoc: resolved.authUid !== roleUid
      ? { docExists: authDocExists, ...authTokens }
      : null,
    mismatchRisk: resolved.authUid !== roleUid
      && authTokens.hasAny
      && !roleTokens.hasAny
  };
}

function aggregateNotifications(docs, nowMs) {
  const byUser = {};
  docs.forEach((doc) => {
    const data = doc.data ? doc.data() : doc;
    const userId = data && data.userId;
    if (!userId) {
      return;
    }
    if (!byUser[userId]) {
      byUser[userId] = {
        userId,
        counts: { sent: 0, failed: 0, other: 0 },
        errorMessages: new Set(),
        recent: []
      };
    }
    const bucket = byUser[userId];
    const status = data.status || 'other';
    if (status === 'sent') {
      bucket.counts.sent += 1;
    } else if (status === 'failed') {
      bucket.counts.failed += 1;
    } else {
      bucket.counts.other += 1;
    }
    if (data.errorMessage) {
      bucket.errorMessages.add(String(data.errorMessage));
    }
    bucket.recent.push({
      type: data.type || null,
      status: data.status || null,
      sentAt: toIso(data.sentAt || data.createdAt),
      errorMessage: data.errorMessage ? String(data.errorMessage) : null
    });
  });

  Object.values(byUser).forEach((bucket) => {
    bucket.recent.sort((a, b) => {
      const ta = a.sentAt ? Date.parse(a.sentAt) : 0;
      const tb = b.sentAt ? Date.parse(b.sentAt) : 0;
      return tb - ta;
    });
    bucket.recent = bucket.recent.slice(0, 5);
    bucket.errorMessages = [...bucket.errorMessages];
  });
  return byUser;
}

async function loadUsersForDiagnose(db) {
  const shops = [];
  const drivers = [];
  const customers = [];

  const shopSnap = await db.collection('users').where('userType', '==', 'shop').get();
  shopSnap.docs.forEach((doc) => {
    shops.push(summarizeUserDoc(doc.id, doc.data()));
  });

  const driverSnap = await db.collection('users').where('userType', '==', 'driver').get();
  driverSnap.docs.forEach((doc) => {
    drivers.push(summarizeUserDoc(doc.id, doc.data()));
  });

  const customerSnap = await db.collection('users')
    .where('userType', '==', 'customer')
    .limit(20)
    .get();
  customerSnap.docs.forEach((doc) => {
    customers.push(summarizeUserDoc(doc.id, doc.data()));
  });

  return { shops, drivers, customers };
}

async function loadDualDocReports(db, shops, drivers) {
  const reports = [];
  const rows = [...shops.map((s) => ({ uid: s.uid, userType: 'shop' })),
    ...drivers.map((d) => ({ uid: d.uid, userType: 'driver' }))];

  for (let index = 0; index < rows.length; index += 1) {
    const { uid } = rows[index];
    const roleSnap = await db.collection('users').doc(uid).get();
    const roleData = roleSnap.exists ? roleSnap.data() : null;
    const resolved = resolveAuthUidFromRoleDoc(uid, roleData);
    let authSnap = null;
    if (resolved.authUid !== uid) {
      authSnap = await db.collection('users').doc(resolved.authUid).get();
    }
    reports.push(dualDocTokenReport(uid, roleData, authSnap));
  }
  return reports;
}

async function loadNotificationStats(db, nowMs = Date.now()) {
  const since = new Date(nowMs - SEVEN_DAYS_MS);
  const snapshot = await db.collection('notifications')
    .where('sentAt', '>=', since)
    .get()
    .catch(async () => {
      const fallback = await db.collection('notifications')
        .where('createdAt', '>=', since)
        .get();
      return fallback;
    });

  return aggregateNotifications(snapshot.docs, nowMs);
}

function buildSummary({ shops, drivers, dualDocReports, notificationByUser }) {
  const shopMissing = shops.filter((s) => !s.hasExpoPushToken && !s.hasFcmToken).length;
  const driverMissing = drivers.filter((d) => !d.hasExpoPushToken && !d.hasFcmToken).length;
  const mismatchCount = dualDocReports.filter((r) => r.mismatchRisk).length;

  const failuresByReason = {};
  Object.values(notificationByUser).forEach((row) => {
    row.errorMessages.forEach((msg) => {
      failuresByReason[msg] = (failuresByReason[msg] || 0) + 1;
    });
  });

  let failedNotifications = 0;
  Object.values(notificationByUser).forEach((row) => {
    failedNotifications += row.counts.failed;
  });

  return {
    shopsWithoutToken: shopMissing,
    shopsTotal: shops.length,
    driversWithoutToken: driverMissing,
    driversTotal: drivers.length,
    dualDocMismatchRisk: mismatchCount,
    notificationsFailedLast7Days: failedNotifications,
    failuresByErrorMessage: failuresByReason,
    registerEndpointNote:
      'POST /api/fcm-tokens/register writes users/{req.user.uid} where uid = JWT userId || uid (auth middleware).'
  };
}

async function runDiagnosePush(db, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const users = await loadUsersForDiagnose(db);
  const dualDocReports = await loadDualDocReports(db, users.shops, users.drivers);
  const notificationByUser = await loadNotificationStats(db, nowMs);
  const summary = buildSummary({
    shops: users.shops,
    drivers: users.drivers,
    dualDocReports,
    notificationByUser
  });

  return {
    diagnosePush: true,
    readOnly: true,
    generatedAt: new Date(nowMs).toISOString(),
    users,
    dualDocReports,
    notificationByUser,
    summary
  };
}

module.exports = {
  SEVEN_DAYS_MS,
  summarizeUserDoc,
  tokenPresence,
  resolveAuthUidFromRoleDoc,
  dualDocTokenReport,
  aggregateNotifications,
  runDiagnosePush
};
