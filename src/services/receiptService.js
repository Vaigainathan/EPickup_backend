const fs = require('fs');
const path = require('path');
const displayIdService = require('./displayIdService');
const { normalizePhoneNumber } = require('../utils/phoneUtils');

const IST = 'Asia/Kolkata';
const SUPPORT_CONTACT = process.env.EPICKUP_SUPPORT_CONTACT || 'Contact support via the ePickup app';
const NOTO_FONT_PATH = path.join(__dirname, '../../assets/fonts/NotoSans-Regular.ttf');
const RECEIPT_FONT_NAME = 'NotoSans';

function receiptCurrencySymbol() {
  return fs.existsSync(NOTO_FONT_PATH) ? '₹' : 'Rs.';
}

function prepareReceiptDocument(doc) {
  const currency = receiptCurrencySymbol();
  if (fs.existsSync(NOTO_FONT_PATH)) {
    doc.registerFont(RECEIPT_FONT_NAME, NOTO_FONT_PATH);
    doc.font(RECEIPT_FONT_NAME);
  }
  return currency;
}

function formatMoney(currency, amount) {
  if (amount == null || amount === '—') {
    return '—';
  }
  return `${currency}${amount}`;
}

function millisOf(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function formatIst(value) {
  const ms = millisOf(value);
  if (!Number.isFinite(ms)) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(ms));
}

function last4(value) {
  return typeof value === 'string' && value.length >= 4 ? value.slice(-4) : null;
}

function shopOrderFilename(displayId) {
  const num = displayIdService.formatDisplayId(displayId).replace('#', '');
  return `ePickup-Shop-order-${num}.pdf`;
}

function parcelFilename(displayId) {
  const raw = displayId != null ? String(displayId).padStart(5, '0') : '00000';
  return `ePickup-Parcel-${raw}.pdf`;
}

function writeTaxDisclaimer(doc, y) {
  doc.fontSize(10).text('This is not a tax invoice.', 50, y);
  return y + 16;
}

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatReceiptPhone(phone) {
  if (phone == null || phone === '') {
    return null;
  }
  const normalized = normalizePhoneNumber(String(phone));
  if (!normalized) {
    const trimmed = String(phone).trim();
    return trimmed || null;
  }
  const digits = normalized.slice(3);
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function formatLineOptionLabel(line) {
  const row = line && typeof line === 'object' ? line : {};
  const label = typeof row.variantLabel === 'string' ? row.variantLabel.trim() : '';
  const value = typeof row.variantValue === 'string' ? row.variantValue.trim() : '';
  if (label && value) {
    return `${label}: ${value}`;
  }
  if (typeof row.optionLabel === 'string' && row.optionLabel.trim()) {
    const option = row.optionLabel.trim();
    return UUID_LIKE.test(option) ? '' : option;
  }
  if (typeof row.variantName === 'string' && row.variantName.trim()) {
    const name = row.variantName.trim();
    return UUID_LIKE.test(name) ? '' : name;
  }
  if (value) {
    return value;
  }
  if (label) {
    return label;
  }
  return '';
}

function shopOrderLineTotal(line) {
  const qty = line && line.qty != null ? Number(line.qty) : 1;
  const price = line && line.price != null ? Number(line.price) : 0;
  return price * qty;
}

function shopOrderItemsTotal(data) {
  const order = data && typeof data === 'object' ? data : {};
  if (order.itemsTotal != null && Number.isFinite(Number(order.itemsTotal))) {
    return Number(order.itemsTotal);
  }
  const items = Array.isArray(order.items) ? order.items : [];
  return items.reduce((sum, line) => sum + shopOrderLineTotal(line), 0);
}

function appendWrappedText(doc, text, x, y, width, fontSize) {
  if (!text) {
    return y;
  }
  doc.fontSize(fontSize).text(String(text), x, y, { width });
  return y + doc.heightOfString(String(text), { width }) + 4;
}

const SHOP_RECEIPT_TABLE = {
  item: 50,
  option: 195,
  qty: 300,
  unit: 345,
  total: 420
};

function drawShopReceiptItemsTable(doc, currency, items, startY) {
  const headerY = startY;
  doc.fontSize(10).fillColor('#333333');
  doc.text('Item', SHOP_RECEIPT_TABLE.item, headerY, { width: 135 });
  doc.text('Option', SHOP_RECEIPT_TABLE.option, headerY, { width: 95 });
  doc.text('Qty', SHOP_RECEIPT_TABLE.qty, headerY, { width: 35 });
  doc.text('Unit price', SHOP_RECEIPT_TABLE.unit, headerY, { width: 65 });
  doc.text('Line total', SHOP_RECEIPT_TABLE.total, headerY, { width: 80 });
  doc.fillColor('#000000');
  let y = headerY + 16;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#cccccc').stroke();
  doc.strokeColor('#000000');
  y += 8;

  (Array.isArray(items) ? items : []).forEach((line) => {
    if (!line || typeof line !== 'object') {
      return;
    }
    const rowTop = y;
    const name = line.name || 'Item';
    const option = formatLineOptionLabel(line);
    const qty = line.qty != null ? line.qty : 1;
    const price = line.price != null ? line.price : 0;
    const lineTotal = shopOrderLineTotal(line);
    doc.fontSize(10);
    doc.text(name, SHOP_RECEIPT_TABLE.item, rowTop, { width: 135 });
    doc.text(option || '—', SHOP_RECEIPT_TABLE.option, rowTop, { width: 95 });
    doc.text(String(qty), SHOP_RECEIPT_TABLE.qty, rowTop, { width: 35 });
    doc.text(formatMoney(currency, price), SHOP_RECEIPT_TABLE.unit, rowTop, { width: 65 });
    doc.text(formatMoney(currency, lineTotal), SHOP_RECEIPT_TABLE.total, rowTop, { width: 80 });
    const rowHeight = Math.max(
      doc.heightOfString(name, { width: 135 }),
      doc.heightOfString(option || '—', { width: 95 }),
      12
    );
    y = rowTop + rowHeight + 8;
  });
  return y + 4;
}

function pipeShopOrderReceipt(doc, orderData, refunds) {
  const currency = prepareReceiptDocument(doc);
  const data = orderData && typeof orderData === 'object' ? orderData : {};
  const displayLabel = displayIdService.formatDisplayId(data.displayId);
  const snapshot = data.shopSnapshot && typeof data.shopSnapshot === 'object' ? data.shopSnapshot : {};
  const payment = data.payment && typeof data.payment === 'object' ? data.payment : {};
  const delivery = data.delivery && typeof data.delivery === 'object' ? data.delivery : {};
  const address = data.deliveryAddress && typeof data.deliveryAddress === 'object' ? data.deliveryAddress : {};
  const shopName = typeof snapshot.name === 'string' && snapshot.name ? snapshot.name : 'Shop';
  const shopPhone = formatReceiptPhone(snapshot.phone);

  let y = 50;
  doc.fontSize(16).text('ePickup', 50, y);
  y += 22;
  doc.fontSize(13).text('Shop order receipt', 50, y);
  y += 28;
  doc.fontSize(11);
  doc.text(`Shop order ${displayLabel}`, 50, y);
  y += 16;
  doc.text(`Order placed: ${formatIst(data.createdAt)}`, 50, y);
  y += 14;
  doc.text(`Delivered: ${formatIst(delivery.deliveredAt)}`, 50, y);
  y += 22;

  const columnTop = y;
  const leftX = 50;
  const rightX = 310;
  const colWidth = 230;
  doc.fontSize(12).text('Sold by', leftX, columnTop);
  doc.text('Delivered to', rightX, columnTop);
  let leftY = columnTop + 16;
  let rightY = columnTop + 16;
  doc.fontSize(11);
  leftY = appendWrappedText(doc, shopName, leftX, leftY, colWidth, 11);
  if (typeof snapshot.address === 'string' && snapshot.address) {
    leftY = appendWrappedText(doc, snapshot.address, leftX, leftY, colWidth, 11);
  }
  if (shopPhone) {
    leftY = appendWrappedText(doc, shopPhone, leftX, leftY, colWidth, 11);
  }
  if (address.receiverName) {
    rightY = appendWrappedText(doc, String(address.receiverName), rightX, rightY, colWidth, 11);
  }
  const receiverPhone = formatReceiptPhone(address.receiverPhone);
  if (receiverPhone) {
    rightY = appendWrappedText(doc, receiverPhone, rightX, rightY, colWidth, 11);
  }
  if (address.text) {
    rightY = appendWrappedText(doc, String(address.text), rightX, rightY, colWidth, 11);
  }
  y = Math.max(leftY, rightY) + 14;

  doc.fontSize(12).text('Items', 50, y);
  y += 18;
  const items = Array.isArray(data.items) ? data.items : [];
  y = drawShopReceiptItemsTable(doc, currency, items, y);

  if (data.customerNote) {
    doc.fontSize(12).text('Instructions', 50, y);
    y += 16;
    doc.fontSize(11).text(String(data.customerNote), 50, y, { width: 495 });
    y += doc.heightOfString(String(data.customerNote), { width: 495 }) + 12;
  }

  const itemsTotal = shopOrderItemsTotal(data);
  const paidAmount = payment.receivedAmount != null ? payment.receivedAmount : data.expectedAmount;
  const utrLast4 = last4(payment.officialUtr) || last4(payment.customerUtr);

  doc.fontSize(12).text('Totals', 50, y);
  y += 16;
  doc.fontSize(11);
  doc.text(`Items total: ${formatMoney(currency, itemsTotal)}`, 70, y);
  y += 14;
  const paidText = paidAmount != null ? formatMoney(currency, paidAmount) : '—';
  doc.text(`Paid to shop via UPI: ${paidText}${utrLast4 ? ` (UTR …${utrLast4})` : ''}`, 70, y, { width: 460 });
  y += doc.heightOfString(`Paid to shop via UPI: ${paidText}`, { width: 460 }) + 8;

  const refundRows = Array.isArray(refunds) ? refunds : [];
  if (refundRows.length > 0) {
    doc.fontSize(12).text('Refunds', 50, y);
    y += 16;
    refundRows.forEach((refund) => {
      const row = refund && typeof refund === 'object' ? refund : {};
      doc.fontSize(11).text(
        `${row.amount != null ? formatMoney(currency, row.amount) : '—'} — ${row.status || 'unknown'}`,
        70,
        y
      );
      y += 14;
    });
    y += 4;
  }

  const deliveryFare = typeof delivery.fare === 'number' ? delivery.fare : null;
  const deliveryLine = deliveryFare != null
    ? `Delivery charge: ${formatMoney(currency, deliveryFare)} — paid in cash to the delivery partner (ePickup delivery)`
    : 'Delivery charge — paid in cash to the delivery partner';
  doc.fontSize(11).text(deliveryLine, 70, y, { width: 460 });
  y += doc.heightOfString(deliveryLine, { width: 460 }) + 24;

  y = writeTaxDisclaimer(doc, y);
  doc.fontSize(10).text(`Items are sold by ${shopName}.`, 50, y);
  y += 14;
  doc.text(SUPPORT_CONTACT, 50, y);
}

function pipeParcelDeliveryReceipt(doc, invoiceData, displayId) {
  const currency = prepareReceiptDocument(doc);
  const parcelLabel = displayId != null
    ? `Parcel ${displayIdService.formatDisplayId(displayId)}`
    : 'Parcel';
  const data = invoiceData && typeof invoiceData === 'object' ? invoiceData : {};

  let y = 50;
  doc.fontSize(18).text(`Parcel Delivery Receipt — ${parcelLabel}`, 50, y);
  y += 32;
  doc.fontSize(11);
  doc.text(`Booking date: ${data.bookingDate ? new Date(data.bookingDate).toLocaleDateString('en-IN') : '—'}`, 50, y);
  y += 14;
  doc.text(`Delivered: ${data.completedDate ? new Date(data.completedDate).toLocaleDateString('en-IN') : '—'}`, 50, y);
  y += 24;

  doc.fontSize(12).text('Customer', 50, y);
  y += 16;
  doc.text(`Name: ${data.customer?.name || 'Customer'}`, 70, y);
  y += 14;
  doc.text(`Phone: ${data.customer?.phone || ''}`, 70, y);
  y += 14;
  doc.text(`Email: ${data.customer?.email || ''}`, 70, y);
  y += 20;

  if (data.driver) {
    doc.fontSize(12).text('Delivery partner', 50, y);
    y += 16;
    doc.text(`Name: ${data.driver.name}`, 70, y);
    y += 14;
    doc.text(`Phone: ${data.driver.phone}`, 70, y);
    y += 14;
    doc.text(`Vehicle: ${data.driver.vehicleNumber}`, 70, y);
    y += 20;
  }

  doc.fontSize(12).text('Pickup', 50, y);
  y += 16;
  doc.text(`Address: ${data.pickup?.address || ''}`, 70, y);
  y += 14;
  doc.text(`Sender: ${data.pickup?.name || ''}`, 70, y);
  y += 20;

  doc.fontSize(12).text('Drop', 50, y);
  y += 16;
  doc.text(`Address: ${data.dropoff?.address || ''}`, 70, y);
  y += 14;
  doc.text(`Contact: ${data.dropoff?.name || ''} (${data.dropoff?.phone || ''})`, 70, y);
  y += 20;

  doc.fontSize(12).text('Package', 50, y);
  y += 16;
  doc.text(`Weight: ${data.package?.weight || 0} kg`, 70, y);
  y += 14;
  doc.text(`Description: ${data.package?.description || ''}`, 70, y);
  y += 20;

  doc.fontSize(12).text('Fare', 50, y);
  y += 16;
  doc.text(`Base fare: ${formatMoney(currency, data.fare?.baseFare ?? 0)}`, 70, y);
  y += 14;
  doc.text(`Distance fare: ${formatMoney(currency, data.fare?.distanceFare ?? 0)}`, 70, y);
  y += 14;
  doc.fontSize(13).text(`Total: ${formatMoney(currency, data.fare?.totalFare ?? 0)}`, 70, y);
  y += 24;

  doc.fontSize(12).text('Payment', 50, y);
  y += 16;
  doc.text(`Method: ${data.paymentMethod || 'cash'}`, 70, y);
  y += 14;
  doc.text(`Status: ${data.paymentStatus || 'completed'}`, 70, y);
  y += 28;

  y = writeTaxDisclaimer(doc, y);
  doc.text('Thank you for using ePickup!', 50, y);
}

module.exports = {
  formatIst,
  last4,
  shopOrderFilename,
  parcelFilename,
  prepareReceiptDocument,
  receiptCurrencySymbol,
  formatMoney,
  formatReceiptPhone,
  formatLineOptionLabel,
  shopOrderLineTotal,
  shopOrderItemsTotal,
  pipeShopOrderReceipt,
  pipeParcelDeliveryReceipt,
  SUPPORT_CONTACT,
  UUID_LIKE
};
