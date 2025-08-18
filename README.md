# 🚀 EPickup Backend API Server

A robust, scalable backend API server for the EPickup delivery service platform, built with Node.js, Express, and Firebase.

## ✨ Features

- 🔐 **Authentication & Authorization** - Firebase Phone Auth + JWT
- 📱 **Real-time Communication** - Socket.IO for live updates
- 🗺️ **Location Services** - Google Maps integration
- 💳 **Payment Processing** - Razorpay & PhonePe integration
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
- **🚀 Render** (Recommended) - [Quick Deploy Guide](QUICK_DEPLOY.md)
- **🚂 Railway** - [Full Deployment Guide](DEPLOYMENT_GUIDE.md#railway-deployment)
- **☁️ DigitalOcean** - [Full Deployment Guide](DEPLOYMENT_GUIDE.md#digitalocean-app-platform)
- **🔧 Heroku** - [Full Deployment Guide](DEPLOYMENT_GUIDE.md#heroku-alternative)

### **Post-Deployment Verification**
```bash
export API_BASE_URL=https://your-app.onrender.com
npm run verify:deployment
```

## 📚 Documentation

- **🚀 [Quick Deploy Guide](QUICK_DEPLOY.md)** - Get deployed in 5 minutes
- **📖 [Full Deployment Guide](DEPLOYMENT_GUIDE.md)** - Complete deployment instructions
- **📋 [Deployment Summary](DEPLOYMENT_SUMMARY.md)** - Overview of all options
- **🔧 [Configuration Guide](CONFIGURATION_README.md)** - Environment setup
- **🔔 [Notification Service](NOTIFICATION_SERVICE_README.md)** - Push notification setup
- **💳 [Payment Service](PAYMENT_SERVICE_README.md)** - Payment gateway integration
- **🗺️ [Real-time Tracking](REAL_TIME_TRACKING_README.md)** - Location services
- **🚗 [Driver Matching](DRIVER_MATCHING_README.md)** - Driver assignment logic

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
├── uploads/             # File upload storage
└── tests/               # Test files
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
```

### **Optional Variables**
```bash
REDIS_URL=your-redis-url
RAZORPAY_KEY_ID=your-razorpay-key
RAZORPAY_KEY_SECRET=your-razorpay-secret
SENTRY_DSN=your-sentry-dsn
```

See [`.env.production.template`](.env.production.template) for complete list.

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

### **Test Specific Services**
```bash
npm run test:auth              # Authentication tests
npm run test:booking           # Booking system tests
npm run test:payment           # Payment service tests
npm run test:notification      # Notification tests
npm run test:driver-matching   # Driver matching tests
npm run test:tracking          # Tracking service tests
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

1. **Quick Start:** [QUICK_DEPLOY.md](QUICK_DEPLOY.md) - 5-minute deployment
2. **Full Guide:** [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Complete instructions
3. **Platform Comparison:** [DEPLOYMENT_SUMMARY.md](DEPLOYMENT_SUMMARY.md) - Choose your platform

**Your EPickup backend is production-ready! 🚀**
