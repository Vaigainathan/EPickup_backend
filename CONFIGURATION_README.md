# EPickup Backend Configuration System

This document describes the comprehensive configuration system implemented for the EPickup backend, providing real-time integration of environment variables and centralized configuration management.

## 🏗️ Architecture Overview

The configuration system is built around a centralized `EnvironmentConfig` class that:

- **Loads** environment variables from `.env` files and `process.env`
- **Validates** critical configuration values
- **Organizes** settings into logical categories
- **Provides** easy access methods for all services
- **Supports** hot reloading for development
- **Ensures** type safety and default values

## 📁 File Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── environment.js      # Main configuration class
│   │   └── index.js           # Configuration exports
│   └── services/              # Services using the config
├── scripts/
│   ├── validate-config.js     # Configuration validation
│   └── test-all-services.js   # Comprehensive service testing
├── .env                       # Environment variables
└── .env.example              # Template file
```

## 🔧 Configuration Categories

### 1. Server Configuration
- **Port**: Server listening port
- **Environment**: Development/Production mode
- **Debug**: Debug mode toggle
- **Mock Services**: Mock service toggle

### 2. Firebase Configuration
- **Project ID**: Firebase project identifier
- **Service Account**: Path to service account JSON
- **Functions Region**: Cloud Functions region
- **Functions Timeout**: Function execution timeout

### 3. JWT Configuration
- **Secret**: JWT signing secret
- **Expires In**: Token expiration time

### 4. Payment Gateway Configuration
- **PhonePe**: Indian payment gateway settings
- **Razorpay**: Alternative payment gateway

### 5. Google Maps Configuration
- **API Key**: Google Maps API key for location services

### 6. Notification Service Configuration
- **Push Notifications**: Enable/disable push notifications
- **FCM V1 API**: Use Firebase Cloud Messaging V1 API
- **Enhanced Notifications**: Advanced notification features
- **Frequency Limits**: Rate limiting for notifications

### 7. Redis Configuration
- **Connection URL**: Redis connection string
- **Host/Port**: Redis server details
- **Authentication**: Username/password
- **Database**: Redis database number

### 8. File Upload Configuration
- **Max File Size**: Maximum allowed file size
- **Upload Path**: Directory for file storage
- **Thumbnail Size**: Image thumbnail dimensions
- **Image Quality**: JPEG compression quality

### 9. Security Configuration
- **Bcrypt Salt Rounds**: Password hashing strength
- **Session Secret**: Session encryption key

### 10. Monitoring Configuration
- **Sentry**: Error tracking and monitoring
- **New Relic**: Performance monitoring

## 🚀 Quick Start

### 1. Environment Setup

Copy the example environment file and configure your values:

```bash
cp .env.example .env
```

Edit `.env` with your actual configuration values.

### 2. Validate Configuration

Run the configuration validation script:

```bash
npm run validate:config
```

This will:
- ✅ Validate all environment variables
- ✅ Check Firebase service account
- ✅ Verify Redis connectivity
- ✅ Test Google Maps API key
- ✅ Validate JWT configuration

### 3. Run Database Migration

Set up the database structure:

```bash
npm run migrate
```

This will:
- 🗄️ Create Firestore collections
- 📊 Configure database indexes
- 🌱 Seed initial data
- 🔍 Verify database connectivity

### 4. Test All Services

Run comprehensive service testing:

```bash
npm run test:all
```

This will test:
- 🔥 Firebase services
- 🗄️ Redis operations
- 🔐 JWT authentication
- 🔒 Password hashing
- 📱 Push notifications
- 💳 Payment services
- 📁 File uploads
- 🔄 Real-time communication
- 📍 Location tracking

### 5. Complete Backend Setup

Run the complete setup in one command:

```bash
npm run setup:backend
```

## 📖 Usage Examples

### Basic Configuration Access

```javascript
const { env } = require('./config');

// Get server port
const port = env.getServerPort();

// Check if running in development
if (env.isDevelopment()) {
  console.log('Development mode enabled');
}

// Get Firebase configuration
const firebaseConfig = env.get('firebase');
```

### Service-Specific Configuration

```javascript
// Redis configuration
if (env.isRedisEnabled()) {
  const redisUrl = env.getRedisUrl();
  // Initialize Redis connection
}

// Notification configuration
if (env.arePushNotificationsEnabled()) {
  const notificationConfig = env.getNotificationConfig();
  // Send push notification
}

// Payment configuration
const paymentConfig = env.getPaymentConfig();
if (paymentConfig.phonepe.merchantId) {
  // Initialize PhonePe payment
}
```

### Configuration Hot Reload

```javascript
// Reload configuration (useful for development)
env.reload();

// Check if configuration changed
const newConfig = env.getAll();
```

## 🔍 Configuration Validation

The system validates critical configurations:

### Required Fields
- `FIREBASE_PROJECT_ID`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CLIENT_EMAIL`
- `JWT_SECRET`
- `GOOGLE_MAPS_API_KEY`

### Optional but Recommended
- `REDIS_URL` (if Redis is enabled)
- `SENTRY_DSN` (for production monitoring)
- Payment gateway credentials

### Validation Errors
If validation fails, the system will:
1. Display specific error messages
2. Exit with error code 1
3. Prevent server startup with invalid configuration

## 🧪 Testing

### Individual Service Tests

```bash
# Test specific services
npm run test:firebase
npm run test:redis
npm run test:payment
npm run test:notification
```

### Configuration Testing

```bash
# Test configuration loading
npm run validate:config

# Test configuration hot reload
npm run test:config-reload
```

### Integration Testing

```bash
# Test all services together
npm run test:all

# Test with mock services
MOCK_SERVICES=true npm run test:all
```

## 🔧 Development Features

### Hot Reloading
Configuration can be reloaded without restarting the server:

```javascript
// In development mode
if (env.isDevelopment()) {
  // Watch for .env changes
  fs.watch('.env', () => {
    env.reload();
    console.log('Configuration reloaded');
  });
}
```

### Debug Mode
Enable debug mode for detailed logging:

```bash
DEBUG=true npm run dev
```

### Mock Services
Use mock services for development:

```bash
MOCK_SERVICES=true npm run dev
```

## 🚨 Troubleshooting

### Common Issues

1. **Configuration Validation Failed**
   - Check `.env` file exists
   - Verify required fields are set
   - Ensure no placeholder values remain

2. **Firebase Initialization Failed**
   - Verify service account JSON exists
   - Check file path in `FCM_SERVICE_ACCOUNT_PATH`
   - Ensure Firebase project ID is correct

3. **Redis Connection Failed**
   - Check Redis server is running
   - Verify connection URL format
   - Check authentication credentials

4. **Google Maps API Error**
   - Verify API key is valid
   - Check API key has required permissions
   - Ensure billing is enabled

### Debug Commands

```bash
# Show current configuration
node -e "console.log(require('./src/config').env.export())"

# Test specific service
node scripts/test-firebase.js

# Validate environment file
node scripts/validate-config.js
```

## 📚 API Reference

### EnvironmentConfig Class

#### Methods

- `get(category)`: Get configuration by category
- `getAll()`: Get all configuration
- `isDevelopment()`: Check if running in development
- `isProduction()`: Check if running in production
- `isDebugEnabled()`: Check if debug mode is enabled
- `isRedisEnabled()`: Check if Redis is enabled
- `arePushNotificationsEnabled()`: Check if push notifications are enabled
- `isFCMV1Enabled()`: Check if FCM V1 API is enabled
- `reload()`: Reload configuration from environment
- `export()`: Export configuration as JSON string

#### Configuration Categories

- `server`: Server configuration
- `firebase`: Firebase configuration
- `jwt`: JWT configuration
- `payment`: Payment gateway configuration
- `googleMaps`: Google Maps configuration
- `notifications`: Notification service configuration
- `redis`: Redis configuration
- `database`: Database configuration
- `cors`: CORS configuration
- `urls`: URL configuration
- `fileUpload`: File upload configuration
- `rateLimit`: Rate limiting configuration
- `logging`: Logging configuration
- `security`: Security configuration
- `monitoring`: Monitoring configuration
- `development`: Development configuration

## 🔐 Security Considerations

1. **Environment Variables**: Never commit `.env` files to version control
2. **Service Account**: Keep Firebase service account JSON secure
3. **API Keys**: Rotate API keys regularly
4. **Secrets**: Use strong, unique secrets for JWT and sessions
5. **Access Control**: Limit access to configuration files

## 📈 Performance Optimization

1. **Configuration Caching**: Configuration is loaded once and cached
2. **Lazy Loading**: Services are initialized only when needed
3. **Connection Pooling**: Redis connections are pooled and reused
4. **Error Handling**: Graceful fallbacks for optional services

## 🚀 Production Deployment

### Environment Variables
Set production environment variables securely:

```bash
# Use environment variable management
export NODE_ENV=production
export FIREBASE_PROJECT_ID=your-project-id
export JWT_SECRET=your-secure-secret
export REDIS_URL=your-redis-url
```

### Configuration Validation
Always validate configuration before deployment:

```bash
npm run validate:config
```

### Service Testing
Test all services in production environment:

```bash
npm run test:all
```

## 📞 Support

For configuration issues:

1. Check the validation output
2. Review environment variable documentation
3. Test individual services
4. Check service-specific logs
5. Verify external service connectivity

## 🔄 Updates and Maintenance

### Adding New Configuration
1. Add to `.env.example`
2. Update `EnvironmentConfig.loadEnvironment()`
3. Add validation in `validateConfiguration()`
4. Update documentation
5. Add tests

### Configuration Migration
When updating configuration structure:
1. Maintain backward compatibility
2. Provide migration scripts
3. Update documentation
4. Test thoroughly

---

**Next Steps**: After completing configuration setup, proceed to:
1. [API Development](../README.md#api-development)
2. [Service Implementation](../README.md#services)
3. [Testing and Deployment](../README.md#testing--deployment)
