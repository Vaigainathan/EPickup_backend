const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { assertAdminRole, isAdminRole } = require('../constants/adminRoles');

async function findAdminByEmail(db, email) {
  const normalized = email.trim().toLowerCase();
  const snap = await db.collection('adminUsers').where('email', '==', email).limit(1).get();
  if (!snap.empty) {
    return { doc: snap.docs[0], data: snap.docs[0].data() };
  }
  const snapInsensitive = await db.collection('adminUsers').where('email', '==', normalized).limit(1).get();
  if (!snapInsensitive.empty) {
    return { doc: snapInsensitive.docs[0], data: snapInsensitive.docs[0].data() };
  }
  return null;
}

/**
 * Create or link staff admin (idempotent on email).
 * Password is never logged.
 */
async function createAdminStaff({
  email,
  displayName,
  role,
  temporaryPassword,
  createdBy
}) {
  assertAdminRole(role);

  if (!email || !displayName || !temporaryPassword) {
    const error = new Error('email, displayName, and temporaryPassword are required');
    error.code = 'MISSING_FIELDS';
    error.status = 400;
    throw error;
  }

  if (typeof temporaryPassword !== 'string' || temporaryPassword.length < 8) {
    const error = new Error('temporaryPassword must be at least 8 characters');
    error.code = 'INVALID_PASSWORD';
    error.status = 400;
    throw error;
  }

  const db = getFirestore();
  const auth = getAuth();

  const existing = await findAdminByEmail(db, email);
  if (existing) {
    return {
      created: false,
      linked: false,
      uid: existing.doc.id,
      email: existing.data.email,
      displayName: existing.data.displayName,
      role: existing.data.role
    };
  }

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    const usersSnap = await db.collection('users').doc(userRecord.uid).get();
    if (usersSnap.exists) {
      const existingType = usersSnap.data()?.userType;
      if (existingType && existingType !== 'admin') {
        const error = new Error('This email is already registered to a non-admin account');
        error.code = 'EMAIL_BELONGS_TO_OTHER_ROLE';
        error.status = 409;
        throw error;
      }
    }
  } catch (err) {
    if (err.code === 'EMAIL_BELONGS_TO_OTHER_ROLE') {
      throw err;
    }
    if (err.code !== 'auth/user-not-found') {
      throw err;
    }
    userRecord = await auth.createUser({
      email,
      password: temporaryPassword,
      displayName,
      emailVerified: false
    });
  }

  const uid = userRecord.uid;
  const now = new Date().toISOString();
  const adminData = {
    uid,
    id: uid,
    email,
    displayName,
    name: displayName,
    userType: 'admin',
    role,
    isActive: true,
    accountStatus: 'active',
    isEmailVerified: userRecord.emailVerified === true,
    createdAt: now,
    updatedAt: now,
    createdBy: createdBy || null,
    lastLogin: null
  };

  await Promise.all([
    db.collection('adminUsers').doc(uid).set(adminData, { merge: true }),
    db.collection('users').doc(uid).set(adminData, { merge: true })
  ]);

  await auth.setCustomUserClaims(uid, {
    userType: 'admin',
    role
  });

  return {
    created: true,
    linked: userRecord.metadata?.creationTime !== userRecord.metadata?.lastSignInTime,
    uid,
    email,
    displayName,
    role
  };
}

async function disableAdminStaff(uid, { disabledBy } = {}) {
  const db = getFirestore();
  const auth = getAuth();

  const adminRef = db.collection('adminUsers').doc(uid);
  const adminDoc = await adminRef.get();
  if (!adminDoc.exists) {
    const error = new Error('Admin user not found');
    error.code = 'ADMIN_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  await auth.updateUser(uid, { disabled: true });

  const patch = {
    isActive: false,
    accountStatus: 'inactive',
    disabledAt: new Date().toISOString(),
    disabledBy: disabledBy || null,
    updatedAt: new Date().toISOString()
  };

  await Promise.all([
    adminRef.set(patch, { merge: true }),
    db.collection('users').doc(uid).set(patch, { merge: true })
  ]);

  return { uid, ...patch };
}

module.exports = {
  createAdminStaff,
  disableAdminStaff,
  findAdminByEmail,
  isAdminRole
};
