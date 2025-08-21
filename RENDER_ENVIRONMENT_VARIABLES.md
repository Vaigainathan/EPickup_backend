# 🔧 Render Environment Variables Setup Guide

## 📋 **Required Environment Variables for EPickup Backend**

### **🎯 How to Add in Render Dashboard:**

1. Go to your Render dashboard
2. Click on your `epickup-backend` service
3. Go to **"Environment"** tab
4. Click **"Add Environment Variable"**
5. Add each variable below

---

## 🔐 **Core Configuration (Required)**

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `PORT` | `10000` | Server port (Render will override) |
| `JWT_SECRET` | `your_jwt_secret_here` | JWT signing secret |
| `SESSION_SECRET` | `your_session_secret_here` | Session encryption secret |

---

## 🔥 **Firebase Configuration (Required)**

| Variable | Value | Description |
|----------|-------|-------------|
| `FIREBASE_PROJECT_ID` | `epickup-app` | Your Firebase project ID |
| `FIREBASE_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n` | Service account private key |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-xxxxx@epickup-app.iam.gserviceaccount.com` | Service account email |
| `FIREBASE_PRIVATE_KEY_ID` | `your_private_key_id` | Private key identifier |
| `FIREBASE_CLIENT_ID` | `your_client_id` | Client identifier |
| `FIREBASE_AUTH_URI` | `https://accounts.google.com/o/oauth2/auth` | OAuth auth URI |
| `FIREBASE_TOKEN_URI` | `https://oauth2.googleapis.com/token` | OAuth token URI |
| `FIREBASE_AUTH_PROVIDER_X509_CERT_URL` | `https://www.googleapis.com/oauth2/v1/certs` | Certificates URL |
| `FIREBASE_CLIENT_X509_CERT_URL` | `https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40epickup-app.iam.gserviceaccount.com` | Client certificate URL |

---

## 💳 **Payment Gateway (Required)**

| Variable | Value | Description |
|----------|-------|-------------|
| `PHONEPE_MERCHANT_ID` | `PGTESTPAYUAT` | PhonePe merchant ID |
| `PHONEPE_MERCHANT_KEY` | `099eb0cd-02cf-4e2a-8aca-3e6c6aff0399` | PhonePe merchant key |
| `PHONEPE_SALT_KEY` | `099eb0cd-02cf-4e2a-8aca-3e6c6aff0399` | PhonePe salt key |
| `PHONEPE_REDIRECT_URL` | `https://webhook.site/redirect-url` | Payment redirect URL |
| `PHONEPE_CALLBACK_URL` | `https://webhook.site/callback-url` | Payment callback URL |

---

## 🗺️ **Google Services (Required)**

| Variable | Value | Description |
|----------|-------|-------------|
| `GOOGLE_MAPS_API_KEY` | `your_google_maps_api_key` | Google Maps API key |

---

## 🌐 **CORS & Origins (Required)**

| Variable | Value | Description |
|----------|-------|-------------|
| `ALLOWED_ORIGINS` | `https://your-frontend-domain.com,http://localhost:3000` | Allowed CORS origins |
| `BACKEND_URL` | `https://your-app-name.onrender.com` | Your Render app URL |

---

## 🔧 **Optional Configuration**

| Variable | Value | Description |
|----------|-------|-------------|
| `SENTRY_DSN` | `your_sentry_dsn` | Sentry error tracking (optional) |
| `DEBUG` | `false` | Debug mode (set to false in production) |
| `REDIS_URL` | `your_redis_url` | Redis connection URL (optional) |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | `` | Redis password (leave empty if none) |
| `REDIS_DB` | `0` | Redis database number |

---

## 📝 **Step-by-Step Setup**

### **Step 1: Get Firebase Service Account**

1. Go to Firebase Console → Project Settings
2. Go to **"Service Accounts"** tab
3. Click **"Generate new private key"**
4. Download the JSON file
5. Copy values from the JSON file

### **Step 2: Add to Render Dashboard**

1. **Go to Render Dashboard**
2. **Click your service** → **"Environment"** tab
3. **Add each variable** from the tables above
4. **Click "Save Changes"**

### **Step 3: Verify Setup**

After adding variables, test your endpoints:

```bash
# Test health endpoint
curl https://your-app.onrender.com/health

# Test root endpoint  
curl https://your-app.onrender.com/

# Test API docs
curl https://your-app.onrender.com/api-docs
```

---

## 🔍 **Troubleshooting**

### **❌ Common Issues:**

1. **Firebase Error:**
   - Check all Firebase environment variables are set
   - Ensure private key includes `\n` for line breaks
   - Verify project ID matches your Firebase project

2. **CORS Error:**
   - Update `ALLOWED_ORIGINS` with your frontend domain
   - Include `http://localhost:3000` for local development

3. **Payment Error:**
   - Verify PhonePe credentials are correct
   - Check redirect and callback URLs

4. **Port Error:**
   - Render automatically sets PORT, don't override it
   - Your app should use `process.env.PORT`

---

## ✅ **Verification Checklist**

- [ ] All core variables set
- [ ] Firebase variables configured
- [ ] Payment gateway variables set
- [ ] Google Maps API key added
- [ ] CORS origins configured
- [ ] Backend URL set correctly
- [ ] Health endpoint responding
- [ ] Root endpoint working
- [ ] API docs accessible

---

## 🎯 **Quick Copy-Paste Template**

For easy setup, copy these variables to Render:

```
NODE_ENV=production
PORT=10000
JWT_SECRET=your_jwt_secret_here
SESSION_SECRET=your_session_secret_here
FIREBASE_PROJECT_ID=epickup-app
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@epickup-app.iam.gserviceaccount.com
PHONEPE_MERCHANT_ID=PGTESTPAYUAT
PHONEPE_MERCHANT_KEY=099eb0cd-02cf-4e2a-8aca-3e6c6aff0399
PHONEPE_SALT_KEY=099eb0cd-02cf-4e2a-8aca-3e6c6aff0399
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
ALLOWED_ORIGINS=https://your-frontend-domain.com,http://localhost:3000
BACKEND_URL=https://your-app-name.onrender.com
DEBUG=false
```

**Replace the placeholder values with your actual credentials! 🔐**
