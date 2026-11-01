const VERIFIED_STATUS_VALUES = new Set([
  'verified',
  'approved',
  'approved_manual',
  'approved_by_admin',
  'approved_manual_review',
  'completed',
  'complete',
  'active'
]);

const BLOCKED_ACCOUNT_STATUSES = new Set([
  'banned',
  'suspended',
  'inactive',
  'disabled'
]);

function isDriverVerified(userData) {
  if (!userData || typeof userData !== 'object') {
    return false;
  }
  if (userData.driver?.isVerified === true || userData.isVerified === true) {
    return true;
  }
  const statusCandidates = [
    userData.driver?.verificationStatus,
    userData.verificationStatus
  ].filter((value) => typeof value === 'string' && value.trim().length > 0);
  if (statusCandidates.length === 0) {
    return false;
  }
  const normalized = statusCandidates[0].trim().toLowerCase();
  return VERIFIED_STATUS_VALUES.has(normalized);
}

function isDriverAccountActive(userData) {
  if (!userData || typeof userData !== 'object') {
    return false;
  }
  if (userData.isActive === false) {
    return false;
  }
  const accountStatus = userData.accountStatus;
  if (typeof accountStatus !== 'string' || accountStatus.trim() === '') {
    return true;
  }
  return !BLOCKED_ACCOUNT_STATUSES.has(accountStatus.trim().toLowerCase());
}

function isDriverOnlineAndAvailable(userData) {
  if (!userData || typeof userData !== 'object') {
    return false;
  }
  const driver = userData.driver;
  if (!driver || typeof driver !== 'object') {
    return false;
  }
  return driver.isOnline === true && driver.isAvailable === true;
}

function passesDriverNewBookingNotifyEligibility(userData) {
  return isDriverAccountActive(userData)
    && isDriverVerified(userData)
    && isDriverOnlineAndAvailable(userData);
}

function driverAccountSuspensionReason(userData) {
  if (!userData || typeof userData !== 'object') {
    return 'missing';
  }
  if (userData.isActive === false) {
    return 'inactive';
  }
  const accountStatus = userData.accountStatus;
  if (typeof accountStatus === 'string' && BLOCKED_ACCOUNT_STATUSES.has(accountStatus.trim().toLowerCase())) {
    return accountStatus.trim().toLowerCase();
  }
  return null;
}

module.exports = {
  VERIFIED_STATUS_VALUES,
  BLOCKED_ACCOUNT_STATUSES,
  isDriverVerified,
  isDriverAccountActive,
  isDriverOnlineAndAvailable,
  passesDriverNewBookingNotifyEligibility,
  driverAccountSuspensionReason
};
