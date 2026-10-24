const express = require('express');
const adminMarketplaceService = require('../services/admin/adminMarketplaceService');
const {
  restrictCustomerMarketplace,
  unrestrictCustomerMarketplace
} = require('../services/admin/customerMarketplaceRestrictionService');

const router = express.Router();

router.get('/enforcement', async (req, res) => {
  try {
    const data = await adminMarketplaceService.getEnforcement();
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: 'ENFORCEMENT_READ_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const data = await adminMarketplaceService.listOrders(req.query);
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: 'LIST_ORDERS_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/orders/:orderId', async (req, res) => {
  try {
    const data = await adminMarketplaceService.getOrderDetail(req.params.orderId);
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'GET_ORDER_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/orders/:orderId/cancel', async (req, res) => {
  try {
    const operator = req.body?.operator || req.user.uid || req.user.userId;
    const data = await adminMarketplaceService.cancelOrder({
      orderId: req.params.orderId,
      operator,
      note: req.body?.reason || req.body?.note || 'Admin cancel'
    });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'CANCEL_ORDER_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/orders/:orderId/payment-review/resolve', async (req, res) => {
  try {
    const { outcome, reason, operator: bodyOperator } = req.body || {};
    const operator = bodyOperator || req.user.uid || req.user.userId;
    const data = await adminMarketplaceService.resolvePaymentReview({
      orderId: req.params.orderId,
      outcome,
      reason,
      operator
    });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'RESOLVE_PAYMENT_REVIEW_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/orders/:orderId/paid-check/resolve', async (req, res) => {
  try {
    const { outcome, operator: bodyOperator, body: paidCheckBody } = req.body || {};
    const operator = bodyOperator || req.user.uid || req.user.userId;
    const received = outcome === 'received';
    const data = await adminMarketplaceService.resolvePaidCheck({
      orderId: req.params.orderId,
      received,
      operator,
      body: paidCheckBody || {}
    });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'RESOLVE_PAID_CHECK_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/orders/:orderId/refunds/:refundId/sent', async (req, res) => {
  try {
    const { refundUtr, reason, operator: bodyOperator, amount } = req.body || {};
    const operator = bodyOperator || req.user.uid || req.user.userId;
    const data = await adminMarketplaceService.recordRefundSent({
      orderId: req.params.orderId,
      refundId: req.params.refundId,
      refundUtr,
      amount,
      actor: { type: 'support', id: operator },
      eventReason: reason || 'Admin refund sent'
    });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'REFUND_SENT_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/orders/:orderId/refunds/:refundId/dispute/resolve', async (req, res) => {
  try {
    const { outcome, to, operator: bodyOperator } = req.body || {};
    const operator = bodyOperator || req.user.uid || req.user.userId;
    const data = await adminMarketplaceService.resolveRefundDispute({
      orderId: req.params.orderId,
      refundId: req.params.refundId,
      outcome,
      to: to || null,
      operator
    });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'REFUND_DISPUTE_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/help/tickets', async (req, res) => {
  try {
    const data = await adminMarketplaceService.listHelpTickets(req.query);
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    const code = error.code || 'LIST_HELP_TICKETS_ERROR';
    console.error('[ADMIN_MARKETPLACE] GET /help/tickets failed', {
      code,
      message: error.message,
      statusFilter: req.query?.status || null
    });
    res.status(500).json({
      success: false,
      error: { code: 'LIST_HELP_TICKETS_ERROR', message: 'Failed to list help tickets' },
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/help/tickets/:ticketId', async (req, res) => {
  try {
    const data = await adminMarketplaceService.getHelpTicket(req.params.ticketId);
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'GET_HELP_TICKET_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/help/tickets/:ticketId/resolve', async (req, res) => {
  try {
    const { status, outcome, amount, supportNote, operator: bodyOperator } = req.body || {};
    const operator = bodyOperator || req.user.uid || req.user.userId;
    const data = await adminMarketplaceService.resolveHelpTicket({
      ticketId: req.params.ticketId,
      status,
      outcome: outcome || null,
      amount,
      operator,
      supportNote
    });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'RESOLVE_HELP_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/customers/:customerId/restrict', async (req, res) => {
  try {
    const { reason, operator: bodyOperator, force } = req.body || {};
    const operator = bodyOperator || req.user.uid || req.user.userId;
    const data = await restrictCustomerMarketplace(req.params.customerId, {
      reason,
      operator,
      force: force === true
    });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'RESTRICT_CUSTOMER_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/customers/:customerId/unrestrict', async (req, res) => {
  try {
    const operator = req.body?.operator || req.user.uid || req.user.userId;
    const data = await unrestrictCustomerMarketplace(req.params.customerId, { operator });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'UNRESTRICT_CUSTOMER_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
