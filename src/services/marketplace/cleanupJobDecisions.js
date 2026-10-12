const { millisOf } = require('./evidenceCommon');

const OPEN_REFUND_STATUSES = new Set(['upi_needed', 'due', 'sent', 'disputed']);
const FINAL_REFUND_STATUSES = new Set(['confirmed', 'closed']);
const OPEN_TICKET_STATUSES = new Set(['open', 'reviewing']);

function isUpiMasked(upi) {
  return typeof upi === 'string' && upi.includes('****');
}

function maskUpiId(upi) {
  if (typeof upi !== 'string' || upi.trim() === '') {
    return null;
  }
  const trimmed = upi.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    return '****';
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.length <= 2 ? local.charAt(0) : local.slice(0, 2);
  return `${visible}****@${domain}`;
}

function shouldDeleteUnattachedEvidence(row, nowMs, maxAgeMs) {
  if (!row || row.attached === true) {
    return false;
  }
  const createdMs = millisOf(row.createdAt);
  if (!Number.isFinite(createdMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    return false;
  }
  return nowMs - createdMs > maxAgeMs;
}

function paymentReviewResolvedAt(orderData) {
  const payment = orderData && orderData.payment;
  const review = payment && payment.review;
  if (!review || review.status !== 'resolved') {
    return null;
  }
  const outcome = review.outcome && typeof review.outcome === 'object' ? review.outcome : null;
  return millisOf(outcome && outcome.decidedAt);
}

function shouldExpirePaymentEvidence(orderData, nowMs, retentionMs) {
  const resolvedMs = paymentReviewResolvedAt(orderData);
  if (!Number.isFinite(resolvedMs) || !Number.isFinite(retentionMs) || retentionMs <= 0) {
    return false;
  }
  const review = orderData.payment && orderData.payment.review;
  if (review && review.status === 'open') {
    return false;
  }
  return nowMs - resolvedMs > retentionMs;
}

function helpTicketResolvedAt(ticket) {
  if (!ticket || ticket.status !== 'resolved') {
    return null;
  }
  if (OPEN_TICKET_STATUSES.has(ticket.status)) {
    return null;
  }
  const resolution = ticket.resolution && typeof ticket.resolution === 'object' ? ticket.resolution : null;
  return millisOf(resolution && resolution.decidedAt);
}

function shouldExpireHelpEvidence(ticket, nowMs, retentionMs) {
  if (!ticket || OPEN_TICKET_STATUSES.has(ticket.status)) {
    return false;
  }
  const resolvedMs = helpTicketResolvedAt(ticket);
  if (!Number.isFinite(resolvedMs) || !Number.isFinite(retentionMs) || retentionMs <= 0) {
    return false;
  }
  return nowMs - resolvedMs > retentionMs;
}

function refundFinalizedAt(refund) {
  if (!refund || !FINAL_REFUND_STATUSES.has(refund.status)) {
    return null;
  }
  if (refund.status === 'confirmed') {
    return millisOf(refund.ackAt);
  }
  return millisOf(refund.autoClosedAt);
}

function shouldMaskRefundUpi(refund, nowMs, retentionMs) {
  if (!refund || OPEN_REFUND_STATUSES.has(refund.status)) {
    return false;
  }
  if (!FINAL_REFUND_STATUSES.has(refund.status)) {
    return false;
  }
  const upi = refund.customerUpiId;
  if (typeof upi !== 'string' || upi.trim() === '' || isUpiMasked(upi)) {
    return false;
  }
  const finalizedMs = refundFinalizedAt(refund);
  if (!Number.isFinite(finalizedMs) || !Number.isFinite(retentionMs) || retentionMs <= 0) {
    return false;
  }
  return nowMs - finalizedMs > retentionMs;
}

function computePoolUsedRatio(totalAllocated, poolSize, legacyRegistered = 0) {
  const allocated = Number(totalAllocated);
  const legacy = Number(legacyRegistered);
  const size = Number(poolSize);
  const used = (Number.isFinite(allocated) && allocated >= 0 ? allocated : 0)
    + (Number.isFinite(legacy) && legacy >= 0 ? legacy : 0);
  if (!Number.isFinite(size) || size <= 0) {
    return 0;
  }
  return used / size;
}

function shouldAlertPoolUsage(usedRatio, threshold) {
  const ratio = Number(usedRatio);
  const limit = Number(threshold);
  if (!Number.isFinite(ratio) || !Number.isFinite(limit) || limit <= 0) {
    return false;
  }
  return ratio >= limit;
}

function shouldSendPoolAlert({ usedRatio, threshold, lastAlertIstDay, istDay }) {
  if (!shouldAlertPoolUsage(usedRatio, threshold)) {
    return false;
  }
  if (!istDay || typeof istDay !== 'string') {
    return true;
  }
  return lastAlertIstDay !== istDay;
}

function claimPoolAlertDay({ usedRatio, threshold, lastAlertIstDay, istDay }) {
  if (!shouldSendPoolAlert({ usedRatio, threshold, lastAlertIstDay, istDay })) {
    return { claim: false, reason: lastAlertIstDay === istDay ? 'already_alerted_today' : 'below_threshold' };
  }
  return { claim: true, istDay };
}

module.exports = {
  claimPoolAlertDay,
  OPEN_REFUND_STATUSES,
  OPEN_TICKET_STATUSES,
  computePoolUsedRatio,
  helpTicketResolvedAt,
  isUpiMasked,
  maskUpiId,
  paymentReviewResolvedAt,
  refundFinalizedAt,
  shouldAlertPoolUsage,
  shouldDeleteUnattachedEvidence,
  shouldExpireHelpEvidence,
  shouldExpirePaymentEvidence,
  shouldMaskRefundUpi,
  shouldSendPoolAlert
};
