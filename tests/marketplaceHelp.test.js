const {
  deliveryInstantForHelp,
  presentCustomerHelp,
  customerStatus
} = require('../src/services/marketplace/helpRequests');
const { pickSupportTicketInput } = require('../src/services/customerSupportTicketInput');

describe('deliveryInstantForHelp', () => {
  it('prefers delivery.deliveredAt', () => {
    const ms = deliveryInstantForHelp({
      delivery: { deliveredAt: new Date('2026-10-01T12:00:00.000Z') }
    }, null);
    expect(ms).toBe(Date.parse('2026-10-01T12:00:00.000Z'));
  });

  it('falls back to delivery_stage event time then completedAt', () => {
    const eventMs = Date.parse('2026-10-01T11:00:00.000Z');
    expect(deliveryInstantForHelp({ delivery: {} }, eventMs)).toBe(eventMs);
    const completedMs = Date.parse('2026-10-01T13:00:00.000Z');
    expect(deliveryInstantForHelp({
      delivery: {},
      completedAt: new Date(completedMs)
    }, null)).toBe(completedMs);
  });
});

describe('presentCustomerHelp', () => {
  it('maps open to submitted and omits internal fields', () => {
    const view = presentCustomerHelp({
      id: 't1',
      status: 'open',
      problem: 'payment',
      description: 'secret',
      evidenceIds: ['e1'],
      supportNote: 'internal'
    });
    expect(view).toEqual({
      id: 't1',
      status: 'submitted',
      problem: 'payment',
      outcome: null
    });
    expect(customerStatus('open')).toBe('submitted');
  });
});

describe('pickSupportTicketInput', () => {
  it('keeps allowed fields and drops unknown keys', () => {
    const picked = pickSupportTicketInput({
      subject: 'Hi',
      description: 'Problem',
      category: 'billing',
      priority: 'high',
      orderId: 'should-not-store',
      evil: true
    });
    expect(picked).toEqual({
      subject: 'Hi',
      description: 'Problem',
      category: 'billing',
      priority: 'high'
    });
    expect(picked.orderId).toBeUndefined();
  });
});
