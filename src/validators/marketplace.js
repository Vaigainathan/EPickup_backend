const UPI_LOCAL = /^[A-Za-z0-9._-]{2,256}$/;
const UPI_HANDLE = /^[A-Za-z]{2,64}$/;
const UPI_MAX_LENGTH = 320;

function isValidUtr(value) {
  return typeof value === 'string' && /^[0-9]{12}$/.test(value);
}

function isValidUpiId(value) {
  if (typeof value !== 'string' || value.length > UPI_MAX_LENGTH) {
    return false;
  }
  const at = value.indexOf('@');
  if (at < 0 || value.indexOf('@', at + 1) !== -1) {
    return false;
  }
  const local = value.slice(0, at);
  const handle = value.slice(at + 1);
  return UPI_LOCAL.test(local) && UPI_HANDLE.test(handle);
}

function toPaise(rupees) {
  const amount = Number(rupees);
  if (!Number.isFinite(amount)) {
    throw new TypeError('rupees must be a finite number');
  }
  return Math.round(amount * 100);
}

function fromPaise(paise) {
  const amount = Number(paise);
  if (!Number.isFinite(amount)) {
    throw new TypeError('paise must be a finite number');
  }
  return amount / 100;
}

function isPositiveIntQuantity(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

module.exports = {
  isValidUtr,
  isValidUpiId,
  toPaise,
  fromPaise,
  isPositiveIntQuantity
};
