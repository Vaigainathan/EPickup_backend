const PDFDocument = require('pdfkit');
const { getFirestore } = require('../firebase');
const { loadRefundDocs } = require('./refunds');
const { httpError } = require('./httpError');
const {
  shopOrderFilename,
  pipeShopOrderReceipt
} = require('../receiptService');

async function streamShopOrderReceipt(res, customerId, orderId) {
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const data = orderSnap.data() || {};
  if (data.customerId !== customerId) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  if (data.orderStatus !== 'completed') {
    throw httpError(409, 'INVALID_STATE', 'Receipt is only available for completed orders');
  }

  const refunds = await loadRefundDocs(orderRef);
  const filename = shopOrderFilename(data.displayId);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument();
  doc.pipe(res);
  pipeShopOrderReceipt(doc, { ...data, id: orderId }, refunds);
  doc.end();
}

async function writeShopOrderReceiptToFile(filePath, customerId, orderId) {
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const data = orderSnap.data() || {};
  if (data.customerId !== customerId) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  if (data.orderStatus !== 'completed') {
    throw httpError(409, 'INVALID_STATE', 'Receipt is only available for completed orders');
  }
  const refunds = await loadRefundDocs(orderRef);
  const fs = require('fs');
  const doc = new PDFDocument();
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);
  pipeShopOrderReceipt(doc, { ...data, id: orderId }, refunds);
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return { filename: shopOrderFilename(data.displayId), orderId };
}

module.exports = {
  streamShopOrderReceipt,
  writeShopOrderReceiptToFile
};
