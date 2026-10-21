const express = require('express');
const { requireAdminRole } = require('../middleware/auth');
const adminShopService = require('../services/admin/adminShopService');

const router = express.Router();
const superAdminOnly = requireAdminRole(['super_admin']);

router.get('/', async (req, res) => {
  try {
    const result = await adminShopService.listShops(req.query);
    res.json({ success: true, data: result, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'LIST_SHOPS_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/:shopId', async (req, res) => {
  try {
    const data = await adminShopService.getShopDetail(req.params.shopId);
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'GET_SHOP_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/:shopId/upi-verify', superAdminOnly, async (req, res) => {
  try {
    const { verifiedName } = req.body || {};
    const operator = req.user.uid || req.user.userId;
    const data = await adminShopService.verifyUpi(req.params.shopId, verifiedName, operator);
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'UPI_VERIFY_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/:shopId/approve', superAdminOnly, async (req, res) => {
  try {
    const operator = req.user.uid || req.user.userId;
    const data = await adminShopService.approve(req.params.shopId, operator);
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'APPROVE_SHOP_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/:shopId/reject', superAdminOnly, async (req, res) => {
  try {
    const { reason, sections } = req.body || {};
    const operator = req.user.uid || req.user.userId;
    const data = await adminShopService.reject(req.params.shopId, { reason, sections, operator });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'REJECT_SHOP_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/:shopId/suspend', superAdminOnly, async (req, res) => {
  try {
    const { reason, operator: bodyOperator } = req.body || {};
    const operator = bodyOperator || req.user.uid || req.user.userId;
    const data = await adminShopService.suspend(req.params.shopId, { reason, operator });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'SUSPEND_SHOP_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/:shopId/unsuspend', superAdminOnly, async (req, res) => {
  try {
    const operator = req.user.uid || req.user.userId;
    const data = await adminShopService.unsuspend(req.params.shopId, operator);
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: { code: error.code || 'UNSUSPEND_SHOP_ERROR', message: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
