console.log = () => {};
console.warn = () => {};

const http = require('http');
const path = require('path');
const express = require('express');

const { sanitizeInput } = require(path.join(__dirname, '../../src/middleware/validation'));

const mountPath = process.argv[2];
const category = process.argv[3] || '';

const app = express();
app.use(sanitizeInput);
app.get(mountPath, (req, res) => {
  res.json({ category: req.query.category });
});

const server = app.listen(0, () => {
  const port = server.address().port;
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  const url = `http://127.0.0.1:${port}${mountPath}${query}`;
  http.get(url, (response) => {
    let body = '';
    response.on('data', (chunk) => {
      body += chunk;
    });
    response.on('end', () => {
      server.close(() => {
        process.stdout.write(body);
      });
    });
  }).on('error', (error) => {
    server.close(() => {
      console.error(error);
      process.exit(1);
    });
  });
});
