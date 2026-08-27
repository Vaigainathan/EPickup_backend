const crypto = require('crypto');

const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function getKey() {
  const hex = process.env.BANK_ENCRYPTION_KEY;
  if (!hex || typeof hex !== 'string') {
    throw new Error('BANK_ENCRYPTION_KEY is not configured');
  }

  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error('BANK_ENCRYPTION_KEY must be a 32-byte hex key (64 hex chars)');
  }

  return key;
}

function encryptAccountNumber(plainText) {
  if (!plainText || typeof plainText !== 'string') {
    throw new Error('Account number is required');
  }

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptAccountNumber(payload) {
  const key = getKey();
  const buffer = Buffer.from(payload, 'base64');
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = buffer.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = {
  encryptAccountNumber,
  decryptAccountNumber
};
