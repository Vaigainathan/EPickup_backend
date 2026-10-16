const PDFDocument = require('pdfkit');
const { getFirestore } = require('../firebase');
const { loadRefundDocs } = require('./refunds');
const { httpError } = require('./httpError');
const {
  shopOrderFilename,
  pipeShopOrderReceipt
} = require('../receiptService');

function variantFieldsFromProductVariant(variant) {
  if (!variant || typeof variant !== 'object') {
    return { variantLabel: null, variantValue: null };
  }
  const variantLabel = typeof variant.attributeLabel === 'string' && variant.attributeLabel.trim() !== ''
    ? variant.attributeLabel.trim()
    : null;
  const variantValue = typeof variant.value === 'string' && variant.value.trim() !== ''
    ? variant.value.trim()
    : null;
  return { variantLabel, variantValue };
}

function mergeVariantFieldsOntoLine(line, variantLabel, variantValue) {
  if (!line || typeof line !== 'object') {
    return line;
  }
  const hasStored = typeof line.variantLabel === 'string' && line.variantLabel.trim() !== ''
    && typeof line.variantValue === 'string' && line.variantValue.trim() !== '';
  if (hasStored) {
    return line;
  }
  if (!variantLabel && !variantValue) {
    return line;
  }
  return {
    ...line,
    variantLabel: line.variantLabel ?? variantLabel,
    variantValue: line.variantValue ?? variantValue
  };
}

async function enrichReceiptItems(db, items) {
  const lines = Array.isArray(items) ? items : [];
  const productIds = [...new Set(lines.map((line) => line && line.productId).filter(Boolean))];
  if (productIds.length === 0) {
    return lines;
  }
  const products = new Map();
  for (let index = 0; index < productIds.length; index += 1) {
    const productId = productIds[index];
    const snap = await db.collection('products').doc(productId).get();
    if (snap.exists) {
      products.set(productId, snap.data() || {});
    }
  }
  return lines.map((line) => {
    if (!line || typeof line !== 'object' || !line.variantId) {
      return line;
    }
    const product = products.get(line.productId);
    if (!product) {
      return line;
    }
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const variant = variants.find((row) => row && row.id === line.variantId);
    const { variantLabel, variantValue } = variantFieldsFromProductVariant(variant);
    return mergeVariantFieldsOntoLine(line, variantLabel, variantValue);
  });
}

async function loadCompletedOrderForReceipt(db, customerId, orderId) {
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
  const items = await enrichReceiptItems(db, data.items);
  return {
    orderData: { ...data, id: orderId, items },
    refunds,
    filename: shopOrderFilename(data.displayId)
  };
}

async function streamShopOrderReceipt(res, customerId, orderId) {
  const db = getFirestore();
  const { orderData, refunds, filename } = await loadCompletedOrderForReceipt(db, customerId, orderId);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument();
  doc.pipe(res);
  pipeShopOrderReceipt(doc, orderData, refunds);
  doc.end();
}

async function writeShopOrderReceiptToFile(filePath, customerId, orderId) {
  const db = getFirestore();
  const { orderData, refunds, filename } = await loadCompletedOrderForReceipt(db, customerId, orderId);
  const fs = require('fs');
  const doc = new PDFDocument();
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);
  pipeShopOrderReceipt(doc, orderData, refunds);
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return { filename, orderId };
}

module.exports = {
  streamShopOrderReceipt,
  writeShopOrderReceiptToFile,
  enrichReceiptItems,
  mergeVariantFieldsOntoLine,
  variantFieldsFromProductVariant
};
