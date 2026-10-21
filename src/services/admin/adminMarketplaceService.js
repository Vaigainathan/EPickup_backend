const { getFirestore } = require('../firebase');
const shopOrderService = require('../shopOrderService');
const { resolvePaidCheckSupport } = require('../marketplace/shopPaymentVerification');
const { markRefundSent, resolveRefundDispute } = require('../marketplace/refunds');
const { resolveMarketplaceHelp } = require('../marketplace/helpRequests');

const MARKETPLACE_HELP_TICKET_CATEGORY = 'marketplace_order';

function presentEnforcement(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    newStatuses: source.newStatuses === true,
    utrBlocksReject: source.utrBlocksReject === true
  };
}

class AdminMarketplaceService {
  getDb() {
    return getFirestore();
  }

  async listOrders({ limit = 20, offset = 0, status } = {}) {
    const db = this.getDb();
    const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

    let query = db.collection('marketplaceOrders');
    if (status) {
      query = query.where('orderStatus', '==', status);
    }
    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.limit(safeLimit + safeOffset).get();
    const docs = snapshot.docs.slice(safeOffset, safeOffset + safeLimit);

    const orders = docs.map((doc) => this.presentOrderSummary(doc.id, doc.data() || {}));
    return {
      orders,
      pagination: { limit: safeLimit, offset: safeOffset, count: orders.length }
    };
  }

  presentOrderSummary(orderId, data) {
    const payment = data.payment && typeof data.payment === 'object' ? data.payment : {};
    return {
      orderId,
      displayId: data.displayId || null,
      orderStatus: data.orderStatus || null,
      customerId: data.customerId || null,
      shopId: data.shopId || null,
      amount: payment.amountDue ?? payment.amount ?? data.amount ?? null,
      customerUtrLast4: typeof payment.customerUtr === 'string' ? payment.customerUtr.slice(-4) : null,
      linkedBookingId: data.linkedBookingId || null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    };
  }

  async getOrderDetail(orderId) {
    const db = this.getDb();
    const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
    if (!orderSnap.exists) {
      const error = new Error('Order not found');
      error.status = 404;
      error.code = 'ORDER_NOT_FOUND';
      throw error;
    }

    const data = orderSnap.data() || {};
    const eventsSnap = await db.collection('marketplaceOrders').doc(orderId)
      .collection('events')
      .orderBy('at', 'desc')
      .limit(100)
      .get()
      .catch(() => ({ docs: [] }));

    const refundsSnap = await db.collection('marketplaceOrders').doc(orderId)
      .collection('refunds')
      .get()
      .catch(() => ({ docs: [] }));

    let customer = null;
    let shop = null;
    if (data.customerId) {
      const customerSnap = await db.collection('users').doc(data.customerId).get();
      if (customerSnap.exists) {
        const c = customerSnap.data() || {};
        customer = { id: data.customerId, name: c.name, phone: c.phone, email: c.email };
      }
    }
    if (data.shopId) {
      const shopSnap = await db.collection('users').doc(data.shopId).get();
      if (shopSnap.exists) {
        const s = shopSnap.data() || {};
        shop = {
          id: data.shopId,
          name: (s.shop && s.shop.shopName) || s.name,
          phone: s.phone
        };
      }
    }

    return {
      order: { id: orderId, ...data },
      summary: this.presentOrderSummary(orderId, data),
      customer,
      shop,
      events: eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      refunds: refundsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    };
  }

  async cancelOrder({ orderId, operator, note }) {
    return shopOrderService.supportCancelBeforeHandover({ orderId, operator, note });
  }

  async resolvePaymentReview({ orderId, outcome, reason, operator }) {
    return shopOrderService.resolveReview({ orderId, outcome, reason, operator });
  }

  async resolvePaidCheck({ orderId, received, operator, body }) {
    return resolvePaidCheckSupport({
      orderId,
      received: received === true,
      operator,
      body: body || {}
    });
  }

  async recordRefundSent(payload) {
    return markRefundSent(payload);
  }

  async resolveRefundDispute(payload) {
    return resolveRefundDispute(payload);
  }

  async resolveHelpTicket(payload) {
    return resolveMarketplaceHelp(payload);
  }

  async listHelpTickets({ limit = 20, offset = 0, status } = {}) {
    const db = this.getDb();
    const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

    let query = db.collection('supportTickets').where('category', '==', MARKETPLACE_HELP_TICKET_CATEGORY);
    if (status) {
      query = query.where('status', '==', status);
    }
    const snapshot = await query.orderBy('createdAt', 'desc').limit(safeLimit + safeOffset).get();
    const tickets = snapshot.docs.slice(safeOffset, safeOffset + safeLimit)
      .map((doc) => ({ id: doc.id, ...doc.data() }));

    return { tickets, pagination: { limit: safeLimit, offset: safeOffset, count: tickets.length } };
  }

  async getHelpTicket(ticketId) {
    const db = this.getDb();
    const snap = await db.collection('supportTickets').doc(ticketId).get();
    if (!snap.exists) {
      const error = new Error('Ticket not found');
      error.status = 404;
      error.code = 'TICKET_NOT_FOUND';
      throw error;
    }
    const data = snap.data() || {};
    if (data.category !== MARKETPLACE_HELP_TICKET_CATEGORY) {
      const error = new Error('Help ticket not found');
      error.status = 404;
      error.code = 'TICKET_NOT_FOUND';
      throw error;
    }
    return { id: snap.id, ...data };
  }

  async getEnforcement() {
    const db = this.getDb();
    const snap = await db.collection('appSettings').doc('marketplace').get();
    const data = snap.exists ? (snap.data() || {}) : {};
    return {
      enforcement: presentEnforcement(data.MARKETPLACE_ENFORCEMENT),
      updatedAt: data.updatedAt || null
    };
  }
}

module.exports = new AdminMarketplaceService();
