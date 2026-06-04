const REDACTED = '[REDACTED]';
const MAX_STRING_LENGTH = 180;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 10;

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|passcode|otp|token|secret|private|credential|session|signature|orderToken|paymentUrl|downloadURL|downloadUrl|signedUrl|photoUrl|fileUrl|razorpay|webhook|accessToken|refreshToken|idToken|apiKey|keySecret)/i;

const EMAIL_KEY_PATTERN = /(email)/i;
const PHONE_KEY_PATTERN = /(phone|mobile|contact)/i;

const looksSensitiveString = (value) => {
  if (typeof value !== 'string') return false;
  return (
    /^Bearer\s+/i.test(value) ||
    /^ExpoPushToken\[/i.test(value) ||
    /^rzp_/i.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /razorpay_signature/i.test(value) ||
    /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)
  );
};

const maskEmail = (value) => {
  if (typeof value !== 'string' || !value.includes('@')) return value ? '[MASKED_EMAIL]' : value;
  const [name, domain] = value.split('@');
  return `${name.slice(0, 2)}***@${domain}`;
};

const maskPhone = (value) => {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return '[MASKED_PHONE]';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
};

const truncate = (value) =>
  value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;

const sanitizeForLog = (value, key = '', depth = 0, seen = new WeakSet()) => {
  if (value === null || value === undefined) return value;

  if (SENSITIVE_KEY_PATTERN.test(String(key))) return REDACTED;

  if (typeof value === 'string') {
    if (EMAIL_KEY_PATTERN.test(String(key))) return maskEmail(value);
    if (PHONE_KEY_PATTERN.test(String(key))) return maskPhone(value);
    if (looksSensitiveString(value)) return REDACTED;
    return truncate(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[Function]';

  if (depth >= MAX_DEPTH) return '[Object]';

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, key, depth + 1, seen));
  }

  if (value instanceof Error) {
    return sanitizeErrorForLog(value);
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
      acc[entryKey] = sanitizeForLog(entryValue, entryKey, depth + 1, seen);
      return acc;
    }, {});
  }

  return String(value);
};

const sanitizeErrorForLog = (error) => {
  if (!error) return error;
  return {
    name: error.name || 'Error',
    message: sanitizeForLog(error.message || String(error)),
    code: sanitizeForLog(error.code),
    stack: typeof error.stack === 'string'
      ? error.stack.split('\n').slice(0, 5).join('\n')
      : undefined,
  };
};

const getSafeRequestContext = (req) => ({
  url: req.originalUrl || req.url,
  method: req.method,
  ip: req.ip,
  userAgent: req.get?.('User-Agent'),
  timestamp: new Date().toISOString(),
  userId: req.user?.uid || req.user?.userId || 'anonymous',
  userType: req.user?.userType || 'unknown',
  requestId: req.id || 'unknown',
  bodyKeys: req.method !== 'GET' && req.body ? Object.keys(req.body) : undefined,
  queryKeys: req.query ? Object.keys(req.query) : undefined,
  paramKeys: req.params ? Object.keys(req.params) : undefined,
  headers: {
    'content-type': req.get?.('Content-Type'),
    authorization: req.get?.('Authorization') ? REDACTED : undefined,
    'x-forwarded-for': req.get?.('X-Forwarded-For'),
    'x-real-ip': req.get?.('X-Real-IP'),
  },
});

module.exports = {
  REDACTED,
  sanitizeForLog,
  sanitizeErrorForLog,
  getSafeRequestContext,
  maskEmail,
  maskPhone,
};
