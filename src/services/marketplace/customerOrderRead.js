const { FieldPath, Timestamp } = require('firebase-admin/firestore');
const {
  ONGOING_ORDER_STATUSES,
  TERMINAL_ORDER_STATUSES
} = require('./orderStateMachine');
const { presentCustomerOrder, presentCustomerOrderSummary } = require('./customerOrderView');
const { loadRefundDocs } = require('./refunds');
const { httpError, paymentDetailsFromStored } = require('./createCustomerOrder');

const PAYMENT_DETAILS_STATUSES = ['awaiting_payment'];

function encodeCursor(createdAt, id) {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
  } catch {
    throw httpError(400, 'INVALID_CURSOR', 'Invalid cursor');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw httpError(400, 'INVALID_CURSOR', 'Invalid cursor');
  }
  if (typeof parsed.id !== 'string' || parsed.id.trim() === '' || typeof parsed.createdAt !== 'string') {
    throw httpError(400, 'INVALID_CURSOR', 'Invalid cursor');
  }
  const millis = Date.parse(parsed.createdAt);
  if (!Number.isFinite(millis)) {
    throw httpError(400, 'INVALID_CURSOR', 'Invalid cursor');
  }
  return { id: parsed.id, createdAt: new Date(millis).toISOString() };
}

function parseLimit(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return 20;
  }
  if (!/^\d+$/.test(String(raw))) {
    throw httpError(400, 'VALIDATION', 'limit must be an integer from 1 to 20');
  }
  const limit = Number(raw);
  if (limit < 1 || limit > 20) {
    throw httpError(400, 'VALIDATION', 'limit must be an integer from 1 to 20');
  }
  return limit;
}

function statusesForGroup(group) {
  if (group === 'ongoing') {
    return ONGOING_ORDER_STATUSES;
  }
  if (group === 'history') {
    return TERMINAL_ORDER_STATUSES;
  }
  throw httpError(400, 'VALIDATION', 'group must be ongoing or history');
}

async function listCustomerOrders(db, customerId, query) {
  const statuses = statusesForGroup(query.group);
  const limit = parseLimit(query.limit);
  const cursor = decodeCursor(query.cursor);
  let request = db.collection('marketplaceOrders')
    .where('customerId', '==', customerId)
    .where('orderStatus', 'in', statuses)
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
    .limit(limit + 1);
  if (cursor) {
    request = request.startAfter(Timestamp.fromDate(new Date(cursor.createdAt)), cursor.id);
  }
  const snapshot = await request.get();
  const page = snapshot.docs.slice(0, limit);
  const orders = page.map((doc) => presentCustomerOrderSummary({ ...doc.data(), id: doc.id }));
  const last = orders[orders.length - 1];
  const nextCursor = snapshot.docs.length > limit && last
    ? encodeCursor(last.createdAt, last.id)
    : null;
  return { orders, nextCursor };
}

async function getCustomerOrder(db, customerId, orderId) {
  const snapshot = await db.collection('marketplaceOrders').doc(orderId).get();
  if (!snapshot.exists) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const data = snapshot.data() || {};
  if (data.customerId !== customerId) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const refunds = await loadRefundDocs(snapshot.ref);
  const order = presentCustomerOrder({ ...data, id: snapshot.id, refunds });
  const body = { order };
  if (PAYMENT_DETAILS_STATUSES.includes(order.orderStatus)) {
    body.paymentDetails = paymentDetailsFromStored(data);
  }
  return body;
}

module.exports = {
  PAYMENT_DETAILS_STATUSES,
  encodeCursor,
  decodeCursor,
  listCustomerOrders,
  getCustomerOrder
};
