const { normalizeAdminRole, isAdminRole } = require('../constants/adminRoles');

/**
 * Admin access requires Firestore proof or Firebase custom claim userType=admin.
 * customClaims.role alone is not sufficient.
 */
function evaluateAdminAccess({ customClaims = {}, adminUsersDoc, usersDoc }) {
  const claims = customClaims || {};
  const adminUsersData = adminUsersDoc?.exists ? adminUsersDoc.data() : null;
  const usersData = usersDoc?.exists ? usersDoc.data() : null;

  let adminUserData = null;
  let source = '';

  if (adminUsersData) {
    adminUserData = adminUsersData;
    source = 'adminUsers_collection';
  } else if (usersData && usersData.userType === 'admin') {
    adminUserData = usersData;
    source = 'users_collection';
  } else if (claims.userType === 'admin' && (adminUsersData || usersData)) {
    adminUserData = adminUsersData || usersData;
    source = 'custom_claims_with_firestore';
  }

  if (!adminUserData) {
    return { allowed: false, adminUserData: null, source: '' };
  }

  const uid = adminUserData.uid || adminUserData.id;
  const role = normalizeAdminRole(uid, adminUserData.role || claims.role);
  if (claims.role && isAdminRole(claims.role) && claims.role !== role) {
    // Firestore wins after normalization
  }

  const isActive = adminUserData.isActive !== false
    && adminUserData.accountStatus !== 'inactive'
    && adminUserData.accountStatus !== 'disabled';

  if (!isActive) {
    return { allowed: false, adminUserData: null, source: 'inactive', inactive: true };
  }

  return {
    allowed: true,
    adminUserData: { ...adminUserData, role },
    source
  };
}

module.exports = {
  evaluateAdminAccess
};
