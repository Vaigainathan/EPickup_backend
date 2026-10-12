const {
  shouldDeleteUnattachedEvidence,
  shouldExpirePaymentEvidence,
  shouldExpireHelpEvidence,
  shouldMaskRefundUpi,
  maskUpiId
} = require('../src/services/marketplace/cleanupJobDecisions');

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * DAY_MS;
const NOW = Date.parse('2026-10-12T10:00:00.000Z');

describe('marketplace cleanup decisions', () => {
  test('deletes unattached evidence older than 24 hours', () => {
    const row = { attached: false, createdAt: new Date(NOW - DAY_MS - 1) };
    expect(shouldDeleteUnattachedEvidence(row, NOW, DAY_MS)).toBe(true);
    expect(shouldDeleteUnattachedEvidence({ attached: false, createdAt: new Date(NOW) }, NOW, DAY_MS)).toBe(false);
  });

  test('never expires payment evidence while review is open', () => {
    const order = {
      payment: {
        review: {
          status: 'open',
          outcome: { decidedAt: new Date(NOW - RETENTION_MS - 1) }
        }
      }
    };
    expect(shouldExpirePaymentEvidence(order, NOW, RETENTION_MS)).toBe(false);
  });

  test('expires payment evidence after resolved review passes retention', () => {
    const order = {
      payment: {
        review: {
          status: 'resolved',
          outcome: { decidedAt: new Date(NOW - RETENTION_MS - 1) }
        }
      }
    };
    expect(shouldExpirePaymentEvidence(order, NOW, RETENTION_MS)).toBe(true);
  });

  test('never expires help evidence for open tickets', () => {
    const ticket = {
      status: 'open',
      resolution: { decidedAt: new Date(NOW - RETENTION_MS - 1) }
    };
    expect(shouldExpireHelpEvidence(ticket, NOW, RETENTION_MS)).toBe(false);
  });

  test('masks refund UPI only for finalized refunds past retention', () => {
    const open = { status: 'due', customerUpiId: 'alice@ybl', dueBy: new Date(NOW) };
    expect(shouldMaskRefundUpi(open, NOW, RETENTION_MS)).toBe(false);

    const finalized = {
      status: 'confirmed',
      customerUpiId: 'alice@ybl',
      ackAt: new Date(NOW - RETENTION_MS - 1)
    };
    expect(shouldMaskRefundUpi(finalized, NOW, RETENTION_MS)).toBe(true);
    expect(maskUpiId('alice@ybl')).toBe('al****@ybl');
  });
});
