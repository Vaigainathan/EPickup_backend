# Railway Environment Variables Configuration

This document lists all environment variables required for deploying the backend to Railway.

## 🔴 **REQUIRED - Critical Variables**

### Server Configuration
```bash
PORT=3000
NODE_ENV=production
```

### Firebase Configuration (REQUIRED)
```bash
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nyour-private-key-here\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-client-id
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_CLIENT_X509_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40your-project-id.iam.gserviceaccount.com
```

**Note:** For Railway, when setting `FIREBASE_PRIVATE_KEY`, you need to:
- Replace actual newlines with `\n` (backslash + n)
- Keep the quotes around the entire value
- Or use Railway's multiline secret feature

### JWT Secret (REQUIRED)
```bash
JWT_SECRET=your-super-secure-jwt-secret-key-here-minimum-32-characters
```

### Google Maps API (REQUIRED)
```bash
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
```

### PhonePe Payment Gateway (REQUIRED for wallet top-up)
```bash
# PhonePe SDK Credentials (OAuth-based SDK flow)
PHONEPE_CLIENT_ID=M23TOSHOITZU8_2512281840
PHONEPE_CLIENT_SECRET=NjFlZDgxYmEtNTQxZC00NzFhLTg0ZTctOGY1NjFjZTJhNTc5
PHONEPE_CLIENT_VERSION=1
PHONEPE_BASE_URL=https://api-preprod.phonepe.com/apis/pg-sandbox
PHONEPE_TEST_MODE=true
```

**Note:** 
- SDK flow uses OAuth authentication (Client ID/Secret) - no Merchant ID/Salt Key needed
- When you get production credentials, update:
  - `PHONEPE_BASE_URL` to `https://api.phonepe.com/apis/pg-sandbox` (or production URL)
  - `PHONEPE_TEST_MODE=false`
  - Update `PHONEPE_CLIENT_ID` and `PHONEPE_CLIENT_SECRET` with production values
- Legacy Pay Page flow (for booking payments) still uses Merchant ID/Salt Key if needed:
  - `PHONEPE_MERCHANT_ID` (optional, only if using Pay Page flow)
  - `PHONEPE_SALT_KEY` (optional, only if using Pay Page flow)
  - `PHONEPE_SALT_INDEX` (optional, only if using Pay Page flow)

### Application URLs (REQUIRED for callbacks)
```bash
BACKEND_URL=https://your-railway-app-name.up.railway.app
FRONTEND_URL=https://epickup-app.web.app
DRIVER_APP_URL=https://epickup-driver.web.app
ADMIN_DASHBOARD_URL=https://epickup-admin.web.app
CUSTOMER_APP_URL=https://epickup-app.web.app
```

**Important:** Update `PHONEPE_CALLBACK_URL` and `PHONEPE_REDIRECT_URL` to use your Railway backend URL:
```bash
PHONEPE_CALLBACK_URL=https://your-railway-app-name.up.railway.app/api/payments/phonepe/callback
PHONEPE_REDIRECT_URL=https://epickup-app.web.app/payment/callback
```

---

## 🟡 **OPTIONAL - Recommended Variables**

### Firebase Additional Settings
```bash
FIREBASE_FUNCTIONS_REGION=us-central1
FIREBASE_FUNCTIONS_TIMEOUT=540
FCM_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
```

### Notification Configuration
```bash
PUSH_NOTIFICATION_ENABLED=true
FCM_ENABLED=true
FCM_USE_V1_API=true
FCM_RETRY_ATTEMPTS=3
FCM_BATCH_SIZE=500
FCM_PRIORITY=high
ENHANCED_NOTIFICATIONS_ENABLED=true
```

### Email Configuration (if using email features)
```bash
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM_ADDRESS=noreply@epickup.com
```

### Storage Configuration (if using file uploads)
```bash
STORAGE_BUCKET=your-project-id.firebasestorage.app
STORAGE_REGION=us-central1
MAX_FILE_SIZE=5242880
ALLOWED_FILE_TYPES=image/jpeg,image/png,image/webp
```

### Security Configuration
```bash
BCRYPT_SALT_ROUNDS=12
SESSION_SECRET=your-session-secret-key
PASSWORD_MIN_LENGTH=8
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION=15
```

### Rate Limiting
```bash
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=2000
```

### Logging
```bash
LOG_LEVEL=info
DEBUG=false
```

### Monitoring (Optional)
```bash
SENTRY_DSN=your-sentry-dsn
NEW_RELIC_LICENSE_KEY=your-new-relic-key
```

### reCAPTCHA (if using)
```bash
RECAPTCHA_ENABLED=true
RECAPTCHA_SITE_KEY=your-site-key
RECAPTCHA_SECRET_KEY=your-secret-key
```

---

## 📋 **Quick Setup Checklist for Railway**

1. ✅ Set all **REQUIRED** variables above
2. ✅ Update `BACKEND_URL` to your Railway app URL
3. ✅ Update `PHONEPE_CALLBACK_URL` to use Railway URL
4. ✅ Ensure `FIREBASE_PRIVATE_KEY` is properly formatted (with `\n` for newlines)
5. ✅ Generate a strong `JWT_SECRET` (minimum 32 characters)
6. ✅ Set `NODE_ENV=production`
7. ✅ Configure `PORT` (Railway usually sets this automatically, but you can override)

---

## 🔐 **Security Notes**

1. **Never commit** `.env` files to version control
2. **Use Railway's secret management** for sensitive values
3. **Rotate secrets regularly**, especially `JWT_SECRET`
4. **Use different credentials** for production vs development
5. **Enable Railway's environment protection** if available

---

## 🧪 **Testing the Configuration**

After setting up environment variables, check the server logs on Railway. The backend will validate configuration on startup and show:
- ✅ Green checkmarks for configured variables
- ❌ Red X marks for missing required variables

If you see validation errors, the server will not start until all required variables are set.

---

## 📝 **Notes**

- Railway automatically provides a `PORT` environment variable, but you can override it
- Railway provides a `RAILWAY_ENVIRONMENT` variable automatically
- For multiline values like `FIREBASE_PRIVATE_KEY`, use Railway's secret management UI or ensure newlines are escaped as `\n`
- PhonePe callback URL must be publicly accessible (Railway provides this automatically)

