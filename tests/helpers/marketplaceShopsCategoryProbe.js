console.log = () => {};
console.warn = () => {};

const http = require('http');
const path = require('path');
const express = require('express');

const { sanitizeInput } = require(path.join(__dirname, '../../src/middleware/validation'));
const customerMarketplaceService = require(path.join(__dirname, '../../src/services/customerMarketplaceService'));

const category = process.argv[2];
const lat = process.argv[3] || '12.9';
const lng = process.argv[4] || '77.6';

customerMarketplaceService.collectEligibleShopRows = async () => ({ rows: [], settings: {} });

const app = express();
app.use(sanitizeInput);
app.get('/api/customer/marketplace/shops', async (req, res) => {
  try {
    const data = await customerMarketplaceService.listShops(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message
      }
    });
  }
});

const query = `lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&category=${encodeURIComponent(category)}`;
const requestPath = `/api/customer/marketplace/shops?${query}`;

const server = app.listen(0, () => {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}${requestPath}`;
  http.get(url, (response) => {
    let body = '';
    response.on('data', (chunk) => {
      body += chunk;
    });
    response.on('end', () => {
      server.close(() => {
        process.stdout.write(JSON.stringify({
          status: response.statusCode,
          body: JSON.parse(body)
        }));
      });
    });
  }).on('error', (error) => {
    server.close(() => {
      console.error(error);
      process.exit(1);
    });
  });
});
