# 🚀 EPickup Backend API Server

A robust, scalable backend API server for the EPickup delivery service platform, built with Node.js, Express, and Firebase.

## ✨ Features

- 🔐 **Authentication & Authorization** - Firebase Phone Auth + JWT
- 📱 **Real-time Communication** - Socket.IO for live updates
- 🗺️ **Location Services** - Google Maps integration
- 💳 **Payment Processing** - PhonePe integration
- 📊 **Real-time Tracking** - Live driver location updates
- 🔔 **Push Notifications** - FCM integration
- 📁 **File Upload** - Document & image handling
- 🚗 **Driver Matching** - Intelligent driver assignment
- 📈 **Booking Management** - Complete order lifecycle
- 🛡️ **Security** - Rate limiting, CORS, Helmet, validation

## 🚀 Quick Start

### **1. Install Dependencies**
```bash
npm install
```

### **2. Environment Setup**
```bash
# Copy production template
cp .env.production.template .env.production

# Edit with your actual values
# Use your favorite editor to fill in the real values
```

### **3. Run Development Server**
```bash
npm run dev
```

### **4. Test Services**
```bash
npm run test:all
```

## 🌐 Deployment

### **Quick Deploy (5 minutes)**
```bash
# On Windows:
npm run deploy:prepare:win

# On Mac/Linux:
npm run deploy:prepare
```

### **Deployment Options**
- **🚀 Render** (Recommended) - [Quick Deploy Guide](DEPLOYMENT_GUIDE.md)
- **🚂 Railway** - [Full Deployment Guide](DEPLOYMENT_GUIDE.md#railway-deployment)
- **☁️ DigitalOcean** - [Full Deployment Guide](DEPLOYMENT_GUIDE.md#digitalocean-app-platform)

### **Post-Deployment Verification**
```bash
export API_BASE_URL=https://your-app.onrender.com
npm run verify:deployment
```

## 📚 Documentation

- **📖 [Full Deployment Guide](DEPLOYMENT_GUIDE.md)** - Complete deployment instructions
- **🔧 [Configuration Guide](DEPLOYMENT_GUIDE.md)** - Environment setup

## 🏗️ Project Structure

```
backend/
├── src/
│   ├── config/          # Environment configuration
│   ├── middleware/      # Express middleware
│   ├── routes/          # API route handlers
│   ├── services/        # Business logic services
│   └── server.js        # Main server file
├── scripts/             # Utility and deployment scripts
└── .env files          # Environment configuration
```

## 🔧 Available Scripts

### **Development**
```bash
npm run dev              # Start development server with nodemon
npm run start            # Start production server
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint issues
npm run format           # Format code with Prettier
```

### **Testing**
```bash
npm run test             # Run Jest tests
npm run test:all         # Run all service tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Generate coverage report
```

### **Deployment**
```bash
npm run deploy:prepare       # Prepare deployment (Linux/Mac)
npm run deploy:prepare:win   # Prepare deployment (Windows)
npm run verify:deployment     # Verify deployment
npm run validate:config       # Validate environment configuration
```

### **Database**
```bash
npm run migrate              # Run database migrations
npm run seed                 # Seed database with sample data
npm run create-indexes       # Create Firestore indexes
npm run deploy:firestore-indexes -- --project epickup-app-staging
                             # Preview indexes. Add --apply to deploy indexes only.
node scripts/deploy-firebase-config.js --project epickup-app-staging
                             # Print the rules, storage, and indexes commands. Add --apply to run them.
npm run deploy:firestore-rules
npm run deploy:storage-rules # Both print the config-script command and exit 1.
```

## 🌍 Environment Variables

### **Required Variables**
```bash
NODE_ENV=production
PORT=10000
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-client-email
JWT_SECRET=your-jwt-secret
GOOGLE_MAPS_API_KEY=your-maps-key

# PhonePe Payment Gateway
PHONEPE_MERCHANT_ID=your-merchant-id
PHONEPE_SALT_KEY=your-salt-key
PHONEPE_SALT_INDEX=1
PHONEPE_BASE_URL=https://api.phonepe.com/apis/pg
PHONEPE_REDIRECT_URL=https://your-domain.com/payment/callback
PHONEPE_CALLBACK_URL=https://your-domain.com/api/payments/phonepe/callback

# Application URLs
BACKEND_URL=https://your-backend-domain.com
FRONTEND_URL=https://your-frontend-domain.com
CUSTOMER_APP_URL=https://your-customer-app-domain.com
DRIVER_APP_URL=https://your-driver-app-domain.com
ADMIN_DASHBOARD_URL=https://your-admin-dashboard-domain.com
```

### **Optional Variables**
```bash
REDIS_URL=your-redis-url
SENTRY_DSN=your-sentry-dsn
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
```

See [`.env.production`](.env.production) for complete list.

## 🔌 API Endpoints

### **Public Endpoints**
- `GET /health` - Health check
- `GET /metrics` - System metrics
- `GET /api-docs` - API documentation

### **Authentication**
- `POST /api/auth/phone` - Phone number authentication
- `POST /api/auth/verify-otp` - OTP verification
- `POST /api/auth/refresh` - Refresh JWT token

### **Customer APIs**
- `GET /api/customer/profile` - Get customer profile
- `PUT /api/customer/profile` - Update customer profile
- `POST /api/customer/addresses` - Add delivery address

### **Driver APIs**
- `GET /api/driver/profile` - Get driver profile
- `PUT /api/driver/profile` - Update driver profile
- `POST /api/driver/location` - Update driver location

### **Booking APIs**
- `POST /api/bookings` - Create new booking
- `GET /api/bookings/:id` - Get booking details
- `PUT /api/bookings/:id/status` - Update booking status

### **Payment APIs**
- `POST /api/payments/create` - Create payment intent
- `POST /api/payments/verify` - Verify payment
- `GET /api/payments/history` - Payment history

### **Tracking APIs**
- `GET /api/tracking/:bookingId` - Get real-time tracking
- `POST /api/tracking/update` - Update tracking status

## 🧪 Testing

### **Run All Tests**
```bash
npm run test:all
```

### **Test Configuration**
```bash
npm run validate:config        # Validate environment setup
```

## 📊 Monitoring & Health Checks

### **Health Endpoint**
```bash
GET /health
```
Returns system status, uptime, memory usage, and service health.

### **Metrics Endpoint**
```bash
GET /metrics
```
Returns performance metrics, CPU usage, and connection counts.

### **Built-in Monitoring**
- ✅ **Winston Logging** - Structured logging with rotation
- ✅ **Sentry Integration** - Error tracking and monitoring
- ✅ **Rate Limiting** - API protection
- ✅ **Performance Metrics** - Response time monitoring

## 🔒 Security Features

- **Helmet.js** - Security headers
- **CORS Protection** - Cross-origin request handling
- **Rate Limiting** - API abuse prevention
- **Input Validation** - Request sanitization
- **JWT Authentication** - Secure token-based auth
- **Firebase Security** - Database security rules

## 🚀 Performance Features

- **Compression** - Response compression
- **Redis Caching** - Optional caching layer
- **Connection Pooling** - Database connection optimization
- **Async Operations** - Non-blocking I/O
- **Load Balancing Ready** - Horizontal scaling support

## 🔄 Scaling Strategy

### **Phase 1: Render (Recommended)**
- Free tier for MVP
- Easy scaling to paid plans
- Built-in monitoring and SSL

### **Phase 2: DigitalOcean**
- Enterprise-grade infrastructure
- Advanced monitoring and scaling
- Global presence

### **Phase 3: Kubernetes**
- Container orchestration
- Auto-scaling and load balancing
- Multi-region deployment

## 🆘 Troubleshooting

### **Common Issues**
1. **Environment Variables** - Run `npm run validate:config`
2. **Firebase Connection** - Check service account credentials
3. **Redis Connection** - Verify Redis URL and credentials
4. **Port Conflicts** - Ensure PORT environment variable is set

### **Debug Commands**
```bash
npm run validate:config        # Check configuration
npm run test:all               # Test all services
npm run verify:deployment      # Verify deployment
```

### **Logs**
- Check console output for errors
- Use Winston logging for detailed logs
- Monitor Sentry for error tracking

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **📖 [Documentation](DEPLOYMENT_GUIDE.md)** - Complete deployment guide
- **🐛 [Issues](https://github.com/epickup/backend/issues)** - Report bugs
- **💬 [Discussions](https://github.com/epickup/backend/discussions)** - Ask questions

---

## 🎯 **Ready to Deploy?**

1. **Quick Start:** [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Complete instructions
2. **Platform Comparison:** [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Choose your platform

**Your EPickup backend is production-ready! 🚀**
