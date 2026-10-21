const express = require('express');
const router = express.Router();

/**
 * @route   POST /api/admin/signup
 * @desc    Disabled — use staging bootstrap or super_admin staff creation
 * @access  Closed
 */
router.post('/', (req, res) => {
  return res.status(410).json({
    success: false,
    error: {
      code: 'ADMIN_SIGNUP_DISABLED',
      message: 'Admin self-signup is disabled. Contact a super admin or use the staging bootstrap script.'
    },
    timestamp: new Date().toISOString()
  });
});

router.all('*', (req, res) => {
  return res.status(410).json({
    success: false,
    error: {
      code: 'ADMIN_SIGNUP_DISABLED',
      message: 'Admin self-signup is disabled.'
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
