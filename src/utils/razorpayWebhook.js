/**
 * Razorpay webhook URLs configured in the Razorpay dashboard (staging backend base URL + path):
 * - POST /api/payments/razorpay/webhook
 * - POST /api/driver/webhooks/razorpay-payment
 *
 * Both must receive the same raw-body HMAC verification (RAZORPAY_WEBHOOK_SECRET).
 */
const RAZORPAY_WEBHOOK_HTTP_PATHS = Object.freeze([
  '/api/payments/razorpay/webhook',
  '/api/driver/webhooks/razorpay-payment'
]);

function normalizePathname(urlOrPath) {
  const raw = (urlOrPath || '').split('?')[0];
  if (!raw) return '';
  return raw.endsWith('/') && raw.length > 1 ? raw.slice(0, -1) : raw;
}

function isRazorpayWebhookHttpPath(urlOrPath) {
  return RAZORPAY_WEBHOOK_HTTP_PATHS.includes(normalizePathname(urlOrPath));
}

function captureRawBodyForRazorpayWebhook(req, res, buf) {
  if (buf.length > 1024 * 1024) {
    throw new Error('Payload too large');
  }
  const path = normalizePathname(req.originalUrl || req.url);
  if (isRazorpayWebhookHttpPath(path)) {
    req.rawBody = buf;
  }
}

async function handleRazorpayWebhookHttpRequest(req, res, razorpayService) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('❌ [RAZORPAY_WEBHOOK] RAZORPAY_WEBHOOK_SECRET is not configured');
    return res.status(500).json({
      success: false,
      message: 'Webhook secret not configured',
      error: {
        code: 'WEBHOOK_SECRET_MISSING',
        message: 'RAZORPAY_WEBHOOK_SECRET must be set'
      },
      timestamp: new Date().toISOString()
    });
  }

  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.rawBody;

  if (!rawBody || !signature || !razorpayService.verifyWebhookSignature(rawBody, signature)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid webhook signature',
      error: {
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Webhook signature verification failed'
      },
      timestamp: new Date().toISOString()
    });
  }

  const result = await razorpayService.handlePaymentCallback(req.body, signature);

  if (result.success) {
    return res.status(200).json({
      success: true,
      message: result.message || 'Webhook processed successfully',
      timestamp: new Date().toISOString()
    });
  }

  return res.status(400).json({
    success: false,
    message: 'Webhook processing failed',
    error: result.error,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  RAZORPAY_WEBHOOK_HTTP_PATHS,
  isRazorpayWebhookHttpPath,
  captureRawBodyForRazorpayWebhook,
  handleRazorpayWebhookHttpRequest
};
