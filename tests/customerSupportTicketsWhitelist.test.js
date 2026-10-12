const { pickSupportTicketInput, ALLOWED_SUPPORT_TICKET_FIELDS } = require('../src/services/customerSupportTicketInput');

describe('customer support ticket input', () => {
  it('only whitelists documented fields', () => {
    expect(ALLOWED_SUPPORT_TICKET_FIELDS).toEqual(['subject', 'description', 'category', 'priority']);
  });

  it('ignores extra keys without storing them', () => {
    const body = pickSupportTicketInput({ subject: 'A', extra: 1, nested: { x: 2 } });
    expect(Object.keys(body)).toEqual(['subject']);
  });
});
