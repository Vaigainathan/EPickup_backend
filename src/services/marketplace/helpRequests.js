const crypto = require('crypto');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('../firebase');
const { MARKETPLACE_DEFAULTS } = require('../../config/marketplaceDefaults');
const { appendEvent } = require('./orderEvents');
const { toPaise } = require('../../validators/marketplace');
const { createRefund, refundRemainder } = require('./refunds');
const {
  httpError,
  requireUuid,
  millisOf
} = require('./evidenceCommon');
const { PURPOSE: HELP_EVIDENCE_PURPOSE } = require('./helpEvidence');

const MAX_DESCRIPTION = 1000;
const ITEM_PROBLEMS = new Set(['wrong_item', 'missing_item', 'damaged', 'quality']);
const ALL_PROBLEMS = new Set([...ITEM_PROBLEMS, 'payment', 'other']);
const OPEN_TICKET_STATUSES = new Set(['open', 'reviewing']);
const HOUR_MS = 60 * 60 * 1000;
const HELP_SUBMIT_DOC = 'helpSubmit';

function stripControls(text) {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      out += text[index];
    }
  }
  return out.trim();
}

function readHelpSettings(settingsData) {
  const source = settingsData && typeof settingsData === 'object' ? settingsData : {};
  function pick(key) {
    return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : MARKETPLACE_DEFAULTS[key];
  }
  return {
    windowHoursA: Number(pick('HELP_WINDOW_HOURS_A')),
    alertMinutes: Number(pick('HELP_ALERT_MINUTES'))
  };
}

function deliveryInstantForHelp(order, deliveredStageEventAtMs) {
  const delivery = order.delivery && typeof order.delivery === 'object' ? order.delivery : {};
  const fromField = millisOf(delivery.deliveredAt);
  if (Number.isFinite(fromField)) {
    return fromField;
  }
  if (Number.isFinite(deliveredStageEventAtMs)) {
    return deliveredStageEventAtMs;
  }
  const completedAt = millisOf(order.completedAt);
  if (Number.isFinite(completedAt)) {
    return completedAt;
  }
  return null;
}

function isDeliveredForItemHelp(data) {
  if (data.orderStatus === 'completed') {
    return true;
  }
  const stage = data.delivery && data.delivery.stage;
  return stage === 'delivered';
}

function customerStatus(stored) {
  if (stored === 'open') {
    return 'submitted';
  }
  return stored;
}

function presentCustomerHelp(ticket) {
  if (!ticket || typeof ticket !== 'object') {
    return null;
  }
  const resolution = ticket.resolution && typeof ticket.resolution === 'object' ? ticket.resolution : null;
  return {
    id: ticket.id ?? null,
    status: customerStatus(ticket.status),
    problem: ticket.problem ?? null,
    outcome: resolution && resolution.outcome != null ? resolution.outcome : null
  };
}

function priorityFor(problem, policyGroup) {
  if (policyGroup === 'A' && ITEM_PROBLEMS.has(problem)) {
    return 'high';
  }
  return 'normal';
}

function windowApplies(problem, policyGroup) {
  return policyGroup === 'A' && ITEM_PROBLEMS.has(problem);
}

function parseProblem(body) {
  const problem = body && body.problem;
  if (typeof problem !== 'string' || !ALL_PROBLEMS.has(problem)) {
    throw httpError(400, 'VALIDATION', 'problem must be a supported help category');
  }
  return problem;
}

function parseDescription(body) {
  if (!body || typeof body.description !== 'string') {
    throw httpError(400, 'VALIDATION', 'description is required');
  }
  const description = stripControls(body.description);
  if (description.length === 0) {
    throw httpError(400, 'VALIDATION', 'description is required');
  }
  if (description.length > MAX_DESCRIPTION) {
    throw httpError(400, 'VALIDATION', 'description must be 1000 characters or fewer');
  }
  return description;
}

function parseHelpEvidenceIds(body) {
  if (!body || !Array.isArray(body.evidenceIds)) {
    return [];
  }
  const ids = [];
  body.evidenceIds.forEach((id) => {
    if (typeof id !== 'string' || !id.trim()) {
      throw httpError(400, 'EVIDENCE_INVALID', 'evidenceIds must be ids from this order');
    }
    const trimmed = id.trim();
    if (!ids.includes(trimmed)) {
      ids.push(trimmed);
    }
  });
  if (ids.length > 3) {
    throw httpError(400, 'EVIDENCE_INVALID', 'At most 3 evidence files are allowed');
  }
  return ids;
}

async function notifyHelpUpdate(customerId, data, orderId) {
  if (!customerId) {
    return;
  }
  try {
    const notificationService = require('../notificationService');
    const { marketplacePushVariables } = require('./marketplacePush');
    await notificationService.sendTemplateNotification(customerId, 'MARKETPLACE', 'HELP_UPDATE', {
      ...marketplacePushVariables(data, orderId)
    });
  } catch (error) {
    console.error('❌ [MARKETPLACE_HELP] push failed', error.message);
  }
}

async function submitMarketplaceHelp({
  customerId,
  orderId,
  idempotencyKey,
  body,
  nowMs
}) {
  const key = requireUuid(idempotencyKey);
  const problem = parseProblem(body);
  const description = parseDescription(body);
  const evidenceIds = parseHelpEvidenceIds(body);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const submitRef = orderRef.collection('private').doc(HELP_SUBMIT_DOC);

  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const data = ownedOrderInTx(orderSnap, customerId);

    const submitSnap = await tx.get(submitRef);
    if (submitSnap.exists) {
      const prior = submitSnap.data() || {};
      if (prior.idempotencyKey === key && prior.ticketId) {
        const ticketSnap = await tx.get(db.collection('supportTickets').doc(prior.ticketId));
        if (ticketSnap.exists) {
          return {
            replay: true,
            ticket: { id: ticketSnap.id, ...(ticketSnap.data() || {}) },
            data
          };
        }
      }
    }

    if (data.hasOpenHelp === true) {
      throw httpError(409, 'HELP_ALREADY_OPEN', 'A help request is already open for this order');
    }

    if (ITEM_PROBLEMS.has(problem) && !isDeliveredForItemHelp(data)) {
      throw httpError(409, 'INVALID_STATE', 'Item problems can be reported after delivery');
    }

    const settingsSnap = await tx.get(db.collection('appSettings').doc('marketplace'));
    const settings = readHelpSettings(settingsSnap.exists ? settingsSnap.data() : null);

    if (windowApplies(problem, data.policyGroup)) {
      const deliveredMs = deliveryInstantForHelp(data, null);
      if (!Number.isFinite(deliveredMs)) {
        throw httpError(409, 'INVALID_STATE', 'Delivery time is not available for this order');
      }
      const windowMs = settings.windowHoursA * HOUR_MS;
      if (!Number.isFinite(windowMs) || windowMs <= 0) {
        throw httpError(409, 'HELP_WINDOW_CLOSED', 'The help window has closed for this order');
      }
      if (now - deliveredMs > windowMs) {
        throw httpError(409, 'HELP_WINDOW_CLOSED', 'The help window has closed for this order');
      }
    }

    if (ITEM_PROBLEMS.has(problem) && evidenceIds.length === 0) {
      throw httpError(400, 'VALIDATION', 'Photos are required for this problem');
    }

    const evidenceSnaps = [];
    for (const id of evidenceIds) {
      evidenceSnaps.push(await tx.get(db.collection('evidenceUploads').doc(id)));
    }
    evidenceIds.forEach((id, index) => {
      const snap = evidenceSnaps[index];
      const row = snap.exists ? (snap.data() || {}) : null;
      if (!row || row.orderId !== orderId || row.customerId !== customerId || row.purpose !== HELP_EVIDENCE_PURPOSE) {
        throw httpError(400, 'EVIDENCE_INVALID', 'evidenceIds must be ids from this order');
      }
    });

    const ticketId = crypto.randomBytes(12).toString('hex');
    const ticketRef = db.collection('supportTickets').doc(ticketId);
    const at = Timestamp.fromMillis(now);
    const ticket = {
      category: 'marketplace_order',
      customerId,
      orderId,
      shopId: data.shopId || null,
      displayId: data.displayId ?? null,
      problem,
      description,
      evidenceIds,
      policyGroup: data.policyGroup ?? null,
      priority: priorityFor(problem, data.policyGroup),
      status: 'open',
      resolution: null,
      assignedTo: null,
      supportNote: null,
      idempotencyKey: key,
      createdAt: at,
      updatedAt: at
    };

    tx.set(ticketRef, ticket);
    evidenceSnaps.forEach((snap) => {
      if (snap.exists) {
        tx.update(snap.ref, { attached: true, ticketId });
      }
    });

    const existingIds = Array.isArray(data.helpTicketIds) ? data.helpTicketIds.slice() : [];
    existingIds.push(ticketId);

    tx.update(orderRef, {
      helpTicketIds: existingIds,
      hasOpenHelp: true,
      updatedAt: at
    });
    tx.set(submitRef, { idempotencyKey: key, ticketId, createdAt: at });

    appendEvent(tx, orderRef, {
      type: 'help_request',
      actor: { type: 'customer', id: customerId },
      data: { ticketId, problem }
    }, data.customerId);

    return { replay: false, ticket: { id: ticketId, ...ticket }, data };
  });

  if (!outcome.replay) {
    await notifyHelpUpdate(customerId, outcome.data, orderId);
  }

  return {
    ticket: presentCustomerHelp(outcome.ticket)
  };
}

function ownedOrderInTx(orderSnap, customerId) {
  if (!orderSnap.exists) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const data = orderSnap.data() || {};
  if (data.customerId !== customerId) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  return data;
}

async function loadHelpTicketForOrder(db, order) {
  if (!order || order.hasOpenHelp !== true) {
    return null;
  }
  const ids = Array.isArray(order.helpTicketIds) ? order.helpTicketIds : [];
  const ticketId = ids.length > 0 ? ids[ids.length - 1] : null;
  if (!ticketId) {
    return null;
  }
  const snap = await db.collection('supportTickets').doc(ticketId).get();
  if (!snap.exists) {
    return null;
  }
  const ticket = snap.data() || {};
  if (!OPEN_TICKET_STATUSES.has(ticket.status)) {
    return null;
  }
  return presentCustomerHelp({ id: snap.id, ...ticket });
}

async function resolveMarketplaceHelp({
  ticketId,
  status,
  outcome,
  amount,
  items,
  operator,
  supportNote
}) {
  if (!ticketId) {
    throw httpError(400, 'VALIDATION', 'ticketId is required');
  }
  if (status !== 'reviewing' && status !== 'resolved') {
    throw httpError(400, 'VALIDATION', 'status must be reviewing or resolved');
  }
  if (status === 'resolved') {
    if (outcome !== 'no_action' && outcome !== 'refund') {
      throw httpError(400, 'VALIDATION', 'outcome must be no_action or refund when resolved');
    }
  } else if (outcome) {
    throw httpError(400, 'VALIDATION', 'outcome is only set when resolving');
  }

  const db = getFirestore();
  const ticketRef = db.collection('supportTickets').doc(ticketId);

  const result = await db.runTransaction(async (tx) => {
    const ticketSnap = await tx.get(ticketRef);
    if (!ticketSnap.exists) {
      throw httpError(404, 'NOT_FOUND', 'Help ticket not found');
    }
    const ticket = ticketSnap.data() || {};
    if (ticket.category !== 'marketplace_order') {
      throw httpError(404, 'NOT_FOUND', 'Help ticket not found');
    }
    const orderRef = db.collection('marketplaceOrders').doc(ticket.orderId);
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    const data = orderSnap.data() || {};
    const at = FieldValue.serverTimestamp();
    const patch = {
      status,
      updatedAt: at
    };
    if (typeof supportNote === 'string' && supportNote.trim()) {
      patch.supportNote = supportNote.trim();
    }

    let refundId = null;
    if (status === 'resolved') {
      const resolution = {
        outcome,
        decidedBy: operator || 'support',
        decidedAt: Timestamp.now()
      };
      if (outcome === 'refund') {
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
          throw httpError(400, 'VALIDATION', 'amount must be a positive number for a refund outcome');
        }
        const payment = data.payment || {};
        const received = payment.receivedAmount != null ? payment.receivedAmount : payment.amount;
        const receivedPaise = toPaise(received);
        const { remainderPaise, refunds: existingRefunds } = await refundRemainder(tx, orderRef, receivedPaise);
        const amountPaise = toPaise(amount);
        if (amountPaise > remainderPaise) {
          throw httpError(409, 'VALIDATION', 'Refund amount exceeds the remaining refundable balance');
        }
        const created = await createRefund(tx, {
          orderRef,
          data,
          reason: 'support_decision',
          amount,
          items: Array.isArray(items) ? items : [],
          actor: { type: 'support', id: operator || 'support' },
          eventReason: 'help_resolution',
          resultingOrderStatus: data.orderStatus,
          existingRefunds
        });
        refundId = created.refundId;
        resolution.refundAmount = amount;
        if (Array.isArray(items) && items.length > 0) {
          resolution.items = items;
        }
      }
      patch.resolution = resolution;
      patch.assignedTo = operator || null;
      tx.update(orderRef, {
        hasOpenHelp: false,
        updatedAt: at
      });
      appendEvent(tx, orderRef, {
        type: 'help_resolved',
        actor: { type: 'support', id: operator || 'support' },
        data: { ticketId, outcome, refundId }
      }, data.customerId);
    }

    tx.update(ticketRef, patch);
    return {
      data,
      orderId: ticket.orderId,
      customerId: data.customerId,
      refundId,
      ticket: { ...ticket, ...patch, id: ticketId }
    };
  });

  if (status === 'resolved' || status === 'reviewing') {
    await notifyHelpUpdate(result.customerId, result.data, result.orderId);
  }

  return { ticketId, refundId: result.refundId || null };
}

function alertHelp(message, ticketId, orderId) {
  console.warn(`⚠️ [MARKETPLACE_HELP] ${message}`, { ticketId, orderId });
  try {
    const Sentry = require('../../../instrument.js');
    if (Sentry && typeof Sentry.captureMessage === 'function') {
      Sentry.captureMessage(message, {
        level: 'warning',
        extra: { ticketId, orderId }
      });
    }
  } catch (error) {
    console.error('❌ [MARKETPLACE_HELP] Alert failed', error.message);
  }
}

module.exports = {
  MAX_DESCRIPTION,
  ITEM_PROBLEMS,
  ALL_PROBLEMS,
  deliveryInstantForHelp,
  presentCustomerHelp,
  submitMarketplaceHelp,
  resolveMarketplaceHelp,
  loadHelpTicketForOrder,
  readHelpSettings,
  alertHelp,
  customerStatus
};
