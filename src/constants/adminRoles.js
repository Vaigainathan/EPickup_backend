const ADMIN_ROLES = Object.freeze(['super_admin', 'support']);

const DEFAULT_ADMIN_ROLE = 'super_admin';

const missingRoleWarningLogged = new Set();

function isAdminRole(value) {
  return typeof value === 'string' && ADMIN_ROLES.includes(value);
}

/**
 * Legacy admins without role are treated as super_admin (log once per uid).
 * @param {string} uid
 * @param {string|undefined|null} role
 * @returns {'super_admin'|'support'}
 */
function normalizeAdminRole(uid, role) {
  if (isAdminRole(role)) {
    return role;
  }
  if (uid && !missingRoleWarningLogged.has(uid)) {
    missingRoleWarningLogged.add(uid);
    console.warn(
      `⚠️ [ADMIN_ROLE] Missing or invalid admin role for ${uid}; defaulting to ${DEFAULT_ADMIN_ROLE}`
    );
  }
  return DEFAULT_ADMIN_ROLE;
}

/** @param {string} role */
function assertAdminRole(role) {
  if (!isAdminRole(role)) {
    const error = new Error(`Invalid admin role: ${role}`);
    error.code = 'INVALID_ADMIN_ROLE';
    error.status = 400;
    throw error;
  }
}

function clearAdminRoleWarningsForTests() {
  missingRoleWarningLogged.clear();
}

module.exports = {
  ADMIN_ROLES,
  DEFAULT_ADMIN_ROLE,
  isAdminRole,
  normalizeAdminRole,
  assertAdminRole,
  clearAdminRoleWarningsForTests
};
