function otpFromValue(value) {
  if (value == null || value === '') {
    return null;
  }
  return String(value);
}

/**
 * @param {object} orderData marketplace order document fields
 * @param {object|null} privateData private/handover document fields
 * @param {{ stripLegacy?: boolean }} options
 */
function planHandoverOtpMigration(orderData, privateData, options = {}) {
  const stripLegacy = options.stripLegacy === true;
  const legacyOtp = otpFromValue(orderData && orderData.handoverOtp);
  const privateOtp = otpFromValue(privateData && privateData.otp);

  if (!legacyOtp && !privateOtp) {
    return { action: 'skip', reason: 'no_otp' };
  }

  if (privateOtp) {
    if (stripLegacy && legacyOtp) {
      return { action: 'strip_legacy', otp: privateOtp };
    }
    return { action: 'skip', reason: 'private_ok' };
  }

  if (legacyOtp) {
    if (stripLegacy) {
      return { action: 'copy_and_strip', otp: legacyOtp };
    }
    return { action: 'copy', otp: legacyOtp };
  }

  return { action: 'skip', reason: 'unknown' };
}

function summarizeHandoverPlans(plans) {
  const summary = {
    scanned: plans.length,
    skipNoOtp: 0,
    skipPrivateOk: 0,
    wouldCopy: 0,
    wouldCopyAndStrip: 0,
    wouldStripLegacy: 0,
    legacyOnDoc: 0
  };
  plans.forEach((plan) => {
    if (plan.action === 'skip' && plan.reason === 'no_otp') {
      summary.skipNoOtp += 1;
    } else if (plan.action === 'skip' && plan.reason === 'private_ok') {
      summary.skipPrivateOk += 1;
    } else if (plan.action === 'copy') {
      summary.wouldCopy += 1;
      summary.legacyOnDoc += 1;
    } else if (plan.action === 'copy_and_strip') {
      summary.wouldCopyAndStrip += 1;
      summary.legacyOnDoc += 1;
    } else if (plan.action === 'strip_legacy') {
      summary.wouldStripLegacy += 1;
      summary.legacyOnDoc += 1;
    }
  });
  return summary;
}

module.exports = {
  otpFromValue,
  planHandoverOtpMigration,
  summarizeHandoverPlans
};
