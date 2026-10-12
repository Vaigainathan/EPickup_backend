const fs = require('fs');
const path = require('path');
const displayIdService = require('./displayIdService');

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

function pipeShopOrderReceipt(doc, orderData, refunds) {
  const currency = prepareReceiptDocument(doc);
  const data = orderData && typeof orderData === 'object' ? orderData : {};
  const displayLabel = displayIdService.formatDisplayId(data.displayId);
  const snapshot = data.shopSnapshot && typeof data.shopSnapshot === 'object' ? data.shopSnapshot : {};
  const payment = data.payment && typeof data.payment === 'object' ? data.payment : {};
  const delivery = data.delivery && typeof data.delivery === 'object' ? data.delivery : {};
  const address = data.deliveryAddress && typeof data.deliveryAddress === 'object' ? data.deliveryAddress : {};
  const shopName = typeof snapshot.name === 'string' && snapshot.name ? snapshot.name : 'Shop';

  let y = 50;
  doc.fontSize(18).text(`Shop Order Receipt — Shop order ${displayLabel}`, 50, y);
  y += 36;
  doc.fontSize(11);
  doc.text(`Order placed: ${formatIst(data.createdAt)}`, 50, y);
  y += 16;
  doc.text(`Delivered: ${formatIst(delivery.deliveredAt)}`, 50, y);
  y += 24;

  doc.fontSize(12).text('Sold by', 50, y);
  y += 16;
  doc.fontSize(11).text(shopName, 70, y);
  y += 14;
  if (typeof snapshot.address === 'string' && snapshot.address) {
    doc.text(snapshot.address, 70, y);
    y += 14;
  }
  if (snapshot.phone) {
    doc.text(`Phone: ${snapshot.phone}`, 70, y);
    y += 14;
  }
  y += 10;

  doc.fontSize(12).text('Delivered to', 50, y);
  y += 16;
  if (address.receiverName) {
    doc.fontSize(11).text(String(address.receiverName), 70, y);
    y += 14;
  }
  if (address.receiverPhone) {
    doc.text(String(address.receiverPhone), 70, y);
    y += 14;
  }
  if (address.text) {
    doc.text(String(address.text), 70, y);
    y += 14;
  }
  y += 10;

  doc.fontSize(12).text('Items', 50, y);
  y += 18;
  const items = Array.isArray(data.items) ? data.items : [];
  items.forEach((line) => {
    if (!line || typeof line !== 'object') {
      return;
    }
    const name = line.name || 'Item';
    const variant = line.variantName || line.variantId || '';
    const qty = line.qty != null ? line.qty : 1;
    const price = line.price != null ? line.price : 0;
    const lineTotal = Number(price) * Number(qty);
    doc.fontSize(11).text(
      `${name}${variant ? ` (${variant})` : ''} × ${qty} @ ${formatMoney(currency, price)} = ${formatMoney(currency, lineTotal)}`,
      70,
      y
    );
    y += 14;
  });
  y += 8;

  if (data.customerNote) {
    doc.fontSize(12).text('Instructions', 50, y);
    y += 16;
    doc.fontSize(11).text(String(data.customerNote), 70, y, { width: 480 });
    y += 28;
  }

  const paidAmount = payment.receivedAmount != null ? payment.receivedAmount : data.expectedAmount;
  doc.fontSize(12).text('Paid to shop via UPI', 50, y);
  y += 16;
  doc.fontSize(11).text(
    `Amount: ${paidAmount != null ? formatMoney(currency, paidAmount) : '—'}`,
    70,
    y
  );
  y += 14;
  const utrLast4 = last4(payment.officialUtr) || last4(payment.customerUtr);
  if (utrLast4) {
    doc.text(`UTR (last 4): ${utrLast4}`, 70, y);
    y += 14;
  }
  y += 8;

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
    y += 8;
  }

  const deliveryFare = typeof delivery.fare === 'number' ? delivery.fare : null;
  doc.fontSize(12).text('Delivery', 50, y);
  y += 16;
  doc.fontSize(11).text(
    deliveryFare != null
      ? `Delivery charge ${formatMoney(currency, deliveryFare)} — paid in cash to the delivery partner (ePickup delivery)`
      : 'Delivery charge — paid in cash to the delivery partner',
    70,
    y,
    { width: 480 }
  );
  y += 36;

  y = writeTaxDisclaimer(doc, y);
  doc.text(`Items are sold by ${shopName}.`, 50, y);
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
  pipeShopOrderReceipt,
  pipeParcelDeliveryReceipt,
  SUPPORT_CONTACT
};
