const ALLOWED_SUPPORT_TICKET_FIELDS = ['subject', 'description', 'category', 'priority'];

function pickSupportTicketInput(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const picked = {};
  ALLOWED_SUPPORT_TICKET_FIELDS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      picked[key] = source[key];
    }
  });
  return picked;
}

module.exports = {
  ALLOWED_SUPPORT_TICKET_FIELDS,
  pickSupportTicketInput
};
