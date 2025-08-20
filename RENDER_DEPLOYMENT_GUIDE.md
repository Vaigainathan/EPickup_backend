# 🚀 EPickup Backend - Render.com Deployment Guide

## 📋 **Pre-Deployment Checklist**

### ✅ **Backend Status: READY FOR DEPLOYMENT**
- ✅ All services tested (40/41 tests passed)
- ✅ Environment variables configured
- ✅ Health checks implemented
- ✅ Error handling optimized
- ✅ Firebase initialization fixed
- ✅ No blocking operations

---

## 🎯 **Step-by-Step Render Deployment**

### **Step 1: Prepare GitHub Repository**

1. **Create a new GitHub repository:**
   ```bash
   # Go to GitHub.com and create a new repository named "epickup-backend"
   ```

2. **Initialize Git and push to GitHub:**
   ```bash
   cd backend
   git init
   git add .
   git commit -m "Initial commit for Render deployment"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/epickup-backend.git
   git push -u origin main
   ```

### **Step 2: Sign Up for Render.com**

1. **Visit:** https://render.com
2. **Sign up** with your GitHub account
3. **Verify your email**

### **Step 3: Create New Web Service**

1. **Click "New +" → "Web Service"**
2. **Connect your GitHub repository:**
   - Select your `epickup-backend` repository
   - Choose the `main` branch

### **Step 4: Configure Service Settings**

#### **Basic Settings:**
- **Name:** `epickup-backend`
- **Environment:** `Node`
- **Region:** Choose closest to your users (e.g., `Oregon (US West)` for US)
- **Branch:** `main`
- **Root Directory:** Leave empty (backend is in root)

#### **Build & Deploy Settings:**
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Auto-Deploy:** ✅ Enabled

### **Step 5: Environment Variables**

Add these environment variables in Render dashboard:

#### **Core Configuration:**
```
NODE_ENV=production
PORT=10000
DEBUG=false
```

#### **Firebase Configuration:**
```
FIREBASE_PROJECT_ID=epickup-app
FIREBASE_PRIVATE_KEY_ID=your_private_key_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@epickup-app.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your_client_id
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_CLIENT_X509_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40epickup-app.iam.gserviceaccount.com
```

#### **JWT & Security:**
```
JWT_SECRET=your_jwt_secret_key_here
SESSION_SECRET=your_session_secret_here
```

#### **Payment Gateways:**
```
PHONEPE_MERCHANT_ID=PGTESTPAYUAT
PHONEPE_MERCHANT_KEY=099eb0cd-02cf-4e2a-8aca-3e6c6aff0399
PHONEPE_SALT_KEY=099eb0cd-02cf-4e2a-8aca-3e6c6aff0399
PHONEPE_REDIRECT_URL=https://webhook.site/redirect-url
PHONEPE_CALLBACK_URL=https://webhook.site/callback-url
```

#### **Google Services:**
```
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

#### **Redis Configuration:**
```
REDIS_URL=your_redis_url_or_leave_empty_for_local
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

#### **CORS & Origins:**
```
ALLOWED_ORIGINS=https://your-frontend-domain.com,http://localhost:3000
BACKEND_URL=https://your-render-app-name.onrender.com
```

#### **Optional Services:**
```
SENTRY_DSN=your_sentry_dsn_or_leave_empty
```

### **Step 6: Deploy**

1. **Click "Create Web Service"**
2. **Wait for build to complete** (5-10 minutes)
3. **Check deployment logs** for any errors

### **Step 7: Verify Deployment**

1. **Test Health Endpoint:**
   ```
   https://your-app-name.onrender.com/health
   ```

2. **Test API Documentation:**
   ```
   https://your-app-name.onrender.com/api-docs
   ```

3. **Test Metrics:**
   ```
   https://your-app-name.onrender.com/metrics
   ```

---

## 🔧 **Post-Deployment Configuration**

### **Step 8: Set Up Custom Domain (Optional)**

1. **In Render Dashboard:**
   - Go to your service
   - Click "Settings" → "Custom Domains"
   - Add your domain (e.g., `api.epickup.com`)

2. **Update DNS:**
   - Add CNAME record pointing to your Render URL
   - Wait for DNS propagation (up to 48 hours)

### **Step 9: Update Client Apps**

Update your frontend apps to use the new backend URL:

```javascript
// In your React Native apps
const API_BASE_URL = 'https://your-app-name.onrender.com';
```

### **Step 10: Monitor & Scale**

1. **Monitor Logs:**
   - Check Render dashboard for logs
   - Set up alerts for errors

2. **Scale if needed:**
   - Upgrade to paid plan for more resources
   - Enable auto-scaling

---

## 📊 **Expected Costs**

### **Free Tier:**
- **Cost:** $0/month
- **Limits:** 750 hours/month, 512MB RAM
- **Suitable for:** Development/testing

### **Paid Plans:**
- **Starter:** $7/month (1GB RAM, always on)
- **Standard:** $25/month (2GB RAM, auto-scaling)
- **Professional:** $50/month (4GB RAM, dedicated IP)

---

## 🚨 **Troubleshooting**

### **Common Issues:**

1. **Build Fails:**
   - Check `package.json` has correct scripts
   - Verify all dependencies are in `dependencies` (not `devDependencies`)

2. **Environment Variables:**
   - Double-check all variables are set correctly
   - Ensure no extra spaces or quotes

3. **Firebase Issues:**
   - Verify service account JSON is properly formatted
   - Check Firebase project permissions

4. **Port Issues:**
   - Render uses `PORT` environment variable
   - Ensure your app listens on `process.env.PORT`

### **Support:**
- **Render Docs:** https://render.com/docs
- **Community:** https://community.render.com

---

## ✅ **Deployment Checklist**

- [ ] GitHub repository created
- [ ] Code pushed to GitHub
- [ ] Render account created
- [ ] Web service created
- [ ] Environment variables configured
- [ ] Build successful
- [ ] Health endpoint responding
- [ ] API endpoints tested
- [ ] Custom domain configured (optional)
- [ ] Client apps updated
- [ ] Monitoring set up

---

## 🎉 **Success!**

Your EPickup backend is now live on Render.com! 

**Next Steps:**
1. Test all API endpoints
2. Update your mobile apps
3. Set up monitoring
4. Configure custom domain
5. Scale as needed

**Your backend URL:** `https://your-app-name.onrender.com`
