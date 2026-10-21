const { getFirestore } = require('../firebase');

const MARKETPLACE_ORDER_CATEGORY = 'marketplace_order';
const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function assertNotMarketplaceHelp(ticket) {
  if (ticket && ticket.category === MARKETPLACE_ORDER_CATEGORY) {
    httpError(
      409,
      'USE_MARKETPLACE_HELP',
      'Use /api/admin/marketplace/help endpoints for marketplace order tickets'
    );
  }
}

function ticketRecipientId(ticket) {
  return ticket.userId || ticket.customerId || null;
}

async function notifyTicketReply(ticketId, recipientId) {
  if (!recipientId) {
    return;
  }
  try {
    const notificationService = require('../notificationService');
    await notificationService.sendToUser(recipientId, {
      type: 'support_ticket_reply',
      title: 'Support replied',
      body: 'You have a new message on your support ticket.',
      data: { ticketId, type: 'support_ticket_reply' }
    });
  } catch (error) {
    console.error('❌ [ADMIN_SUPPORT_TICKET] push failed:', error.message);
  }
}

async function appendAdminReply({ ticketId, adminId, message }) {
  const trimmed = typeof message === 'string' ? message.trim() : '';
  if (!trimmed || trimmed.length > 1000) {
    httpError(400, 'VALIDATION_ERROR', 'Message must be between 1 and 1000 characters');
  }

  const db = getFirestore();
  const ticketRef = db.collection('supportTickets').doc(ticketId);
  const ticketDoc = await ticketRef.get();

  if (!ticketDoc.exists) {
    httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found');
  }

  const ticket = ticketDoc.data();
  assertNotMarketplaceHelp(ticket);

  if (ticket.status === 'closed') {
    httpError(400, 'TICKET_CLOSED', 'Cannot add message to closed ticket');
  }

  const newMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    senderId: adminId,
    senderType: 'admin',
    message: trimmed,
    timestamp: new Date()
  };

  await ticketRef.update({
    messages: [...(ticket.messages || []), newMessage],
    updatedAt: new Date(),
    status: 'in_progress'
  });

  await notifyTicketReply(ticketId, ticketRecipientId(ticket));

  return {
    ticketId,
    messageId: newMessage.id,
    timestamp: newMessage.timestamp
  };
}

async function setTicketStatus({ ticketId, status, adminId, adminNotes }) {
  if (!VALID_STATUSES.includes(status)) {
    httpError(400, 'VALIDATION_ERROR', 'Invalid status');
  }

  const db = getFirestore();
  const ticketRef = db.collection('supportTickets').doc(ticketId);
  const ticketDoc = await ticketRef.get();

  if (!ticketDoc.exists) {
    httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found');
  }

  const ticket = ticketDoc.data();
  assertNotMarketplaceHelp(ticket);

  const updateData = {
    status,
    updatedAt: new Date(),
    adminNotes: adminNotes || null,
    lastUpdatedBy: adminId
  };

  if (status === 'resolved') {
    updateData.resolvedAt = new Date();
    updateData.resolvedBy = adminId;
  }

  await ticketRef.update(updateData);

  return {
    ticketId,
    status,
    updatedAt: updateData.updatedAt
  };
}

module.exports = {
  MARKETPLACE_ORDER_CATEGORY,
  appendAdminReply,
  setTicketStatus
};
