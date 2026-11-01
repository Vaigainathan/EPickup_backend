const express = require('express');
const router = express.Router();

const endpointRemoved = (_req, res) => {
  res.status(410).json({
    success: false,
    error: {
      code: 'ENDPOINT_REMOVED',
      message: 'This wallet API has been removed. Use /api/driver/wallet endpoints.'
    },
    timestamp: new Date().toISOString()
  });
};

router.all('*', endpointRemoved);

module.exports = router;
