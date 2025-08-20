# 🚀 Quick Render Deployment Guide

## ⚡ **5-Minute Deployment**

Your EPickup backend is **100% ready** for Render deployment!

---

## 🎯 **Step 1: Create GitHub Repository**

1. Go to https://github.com/new
2. **Repository name:** `epickup-backend`
3. **Visibility:** Public or Private
4. Click **"Create repository"**

---

## 🎯 **Step 2: Push Code to GitHub**

Run this in your backend directory:

```bash
cd backend
git init
git add .
git commit -m "Initial commit for Render deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/epickup-backend.git
git push -u origin main
```

---

## 🎯 **Step 3: Deploy to Render**

1. **Visit:** https://render.com
2. **Sign up** with GitHub
3. **Click:** "New +" → "Web Service"
4. **Connect:** Your `epickup-backend` repository
5. **Configure:**
   - **Name:** `epickup-backend`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
6. **Click:** "Create Web Service"

---

## 🎯 **Step 4: Add Environment Variables**

In Render dashboard, add these variables:

### **Core (Required):**
```
NODE_ENV=production
PORT=10000
JWT_SECRET=your_jwt_secret_here
```

### **Firebase (Required):**
```
FIREBASE_PROJECT_ID=epickup-app
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@epickup-app.iam.gserviceaccount.com
```

### **Payment (Required):**
```
PHONEPE_MERCHANT_ID=PGTESTPAYUAT
PHONEPE_MERCHANT_KEY=099eb0cd-02cf-4e2a-8aca-3e6c6aff0399
PHONEPE_SALT_KEY=099eb0cd-02cf-4e2a-8aca-3e6c6aff0399
```

### **Google Maps (Required):**
```
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

### **CORS (Required):**
```
ALLOWED_ORIGINS=https://your-frontend-domain.com,http://localhost:3000
BACKEND_URL=https://your-app-name.onrender.com
```

---

## 🎯 **Step 5: Wait & Test**

1. **Wait** for build to complete (5-10 minutes)
2. **Test** your endpoints:
   - Health: `https://your-app.onrender.com/health`
   - API Docs: `https://your-app.onrender.com/api-docs`

---

## ✅ **Success!**

Your backend is now live at: `https://your-app-name.onrender.com`

---

## 📚 **Need Help?**

- **Detailed Guide:** See `RENDER_DEPLOYMENT_GUIDE.md`
- **Scripts:** Run `scripts/deploy-to-render.bat` (Windows) or `scripts/deploy-to-render.sh` (Mac/Linux)
- **Support:** https://render.com/docs

---

## 💰 **Costs**

- **Free Tier:** $0/month (750 hours, 512MB RAM)
- **Paid:** $7/month (1GB RAM, always on)

**Perfect for your EPickup backend! 🎉**
