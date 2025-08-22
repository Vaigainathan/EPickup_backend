# EPickup Backend API Documentation

## Overview

This document provides comprehensive documentation for the EPickup backend API, including authentication, Google Maps integration, real-time features, and secure storage management.

## Base URL

- **Development**: `http://localhost:3000`
- **Staging**: `https://staging-api.epickup.com`
- **Production**: `https://api.epickup.com`

## Authentication

All authenticated endpoints require a valid JWT token in the Authorization header:

```
Authorization: Bearer <access_token>
```

### Authentication Flow

1. **Send OTP**: `POST /api/auth/send-verification-code`
2. **Verify OTP**: `POST /api/auth/verify-otp`
3. **Refresh Token**: `POST /api/auth/refresh`

## Google Maps API Integration

### Places Autocomplete

**Endpoint**: `GET /api/google-maps/places/autocomplete`

**Description**: Get place autocomplete suggestions

**Parameters**:
- `input` (required): Search query
- `sessionToken` (optional): Session token for billing
- `types` (optional): Place types filter
- `components` (optional): Component filtering
- `radius` (optional): Search radius in meters
- `location` (optional): Bias search to location
- `strictbounds` (optional): Strict bounds filtering

**Example Request**:
```bash
GET /api/google-maps/places/autocomplete?input=bangalore&types=geocode&radius=50000
```

**Example Response**:
```json
{
  "success": true,
  "data": {
    "predictions": [
      {
        "placeId": "ChIJbU60yXAWrjsR4E9-UejD3_g",
        "description": "Bangalore, Karnataka, India",
        "structuredFormatting": {
          "mainText": "Bangalore",
          "secondaryText": "Karnataka, India"
        },
        "types": ["locality", "political"]
      }
    ],
    "status": "OK"
  },
  "message": "Place autocomplete results retrieved successfully"
}
```

### Place Details

**Endpoint**: `GET /api/google-maps/places/details`

**Description**: Get detailed place information

**Parameters**:
- `placeId` (required): Google Place ID
- `fields` (optional): Fields to return
- `language` (optional): Language code
- `region` (optional): Region code

**Example Request**:
```bash
GET /api/google-maps/places/details?placeId=ChIJbU60yXAWrjsR4E9-UejD3_g&fields=formatted_address,geometry,name
```

### Directions

**Endpoint**: `GET /api/google-maps/directions`

**Description**: Get directions between two points

**Parameters**:
- `origin` (required): Origin coordinates or address
- `destination` (required): Destination coordinates or address
- `mode` (optional): Travel mode (driving, walking, bicycling, transit)
- `alternatives` (optional): Return alternative routes
- `avoid` (optional): Avoid specific features
- `units` (optional): Units (metric, imperial)
- `traffic_model` (optional): Traffic model
- `departure_time` (optional): Departure time
- `waypoints` (optional): Waypoints for route optimization

**Example Request**:
```bash
GET /api/google-maps/directions?origin=12.9716,77.5946&destination=13.0827,80.2707&mode=driving
```

### Geocoding

**Endpoint**: `GET /api/google-maps/geocode`

**Description**: Convert address to coordinates

**Parameters**:
- `address` (required): Address to geocode
- `components` (optional): Component filtering
- `bounds` (optional): Bounds for biasing
- `language` (optional): Language code
- `region` (optional): Region code

**Example Request**:
```bash
GET /api/google-maps/geocode?address=Bangalore,Karnataka,India
```

### Reverse Geocoding

**Endpoint**: `GET /api/google-maps/reverse-geocode`

**Description**: Convert coordinates to address

**Parameters**:
- `latlng` (required): Latitude,longitude
- `resultType` (optional): Result type filtering
- `locationType` (optional): Location type filtering
- `language` (optional): Language code

**Example Request**:
```bash
GET /api/google-maps/reverse-geocode?latlng=12.9716,77.5946
```

### Nearby Places

**Endpoint**: `GET /api/google-maps/nearby-places`

**Description**: Get places near a location

**Parameters**:
- `location` (required): Latitude,longitude
- `radius` (optional): Search radius in meters
- `type` (optional): Place type
- `keyword` (optional): Keyword search
- `minPrice` (optional): Minimum price level
- `maxPrice` (optional): Maximum price level
- `openNow` (optional): Only open places
- `rankBy` (optional): Ranking method
- `pageToken` (optional): Next page token

**Example Request**:
```bash
GET /api/google-maps/nearby-places?location=12.9716,77.5946&radius=1500&type=restaurant
```

### Distance Matrix

**Endpoint**: `GET /api/google-maps/distance-matrix`

**Description**: Calculate distances between multiple origins and destinations

**Parameters**:
- `origins` (required): Origin coordinates (pipe-separated)
- `destinations` (required): Destination coordinates (pipe-separated)
- `mode` (optional): Travel mode
- `avoid` (optional): Avoid features
- `units` (optional): Units
- `traffic_model` (optional): Traffic model
- `departure_time` (optional): Departure time

**Example Request**:
```bash
GET /api/google-maps/distance-matrix?origins=12.9716,77.5946&destinations=13.0827,80.2707&mode=driving
```

### Elevation

**Endpoint**: `GET /api/google-maps/elevation`

**Description**: Get elevation data for coordinates

**Parameters**:
- `locations` (optional): Coordinates (pipe-separated)
- `path` (optional): Path coordinates
- `samples` (optional): Number of samples for path

**Example Request**:
```bash
GET /api/google-maps/elevation?locations=12.9716,77.5946
```

## Real-time Communication (Socket.IO)

### Connection

Connect to the Socket.IO server:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-token'
  }
});
```

### Authentication

**Event**: `authenticate`

**Data**:
```json
{
  "token": "your-jwt-token"
}
```

### Tracking Subscription

**Event**: `subscribe_tracking`

**Data**:
```json
{
  "tripId": "booking-id",
  "userId": "user-id",
  "userType": "customer"
}
```

### Location Updates

**Event**: `location_update`

**Data**:
```json
{
  "tripId": "booking-id",
  "location": {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "accuracy": 10,
    "timestamp": 1640995200000
  }
}
```

### Chat Messages

**Event**: `chat_message`

**Data**:
```json
{
  "tripId": "booking-id",
  "message": "Hello driver!",
  "senderId": "user-id",
  "senderType": "customer"
}
```

### Trip Status Updates

**Event**: `trip_status_update`

**Data**:
```json
{
  "tripId": "booking-id",
  "status": "driver_arriving",
  "additionalData": {
    "estimatedArrival": 5
  }
}
```

## Secure Storage Integration

### Frontend Secure Storage

The frontend uses Expo SecureStore for sensitive data:

```typescript
import { secureStorage } from '@/services/secureStorage';

// Store authentication tokens
await secureStorage.setAuthTokens({
  accessToken: 'token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 3600000
});

// Get authentication tokens
const tokens = await secureStorage.getAuthTokens();

// Store user profile
await secureStorage.setUserProfile({
  id: 'user-id',
  name: 'John Doe',
  email: 'john@example.com'
});

// Store saved addresses
await secureStorage.setSavedAddresses([
  {
    id: '1',
    name: 'Home',
    address: '123 Main St',
    type: 'home',
    isDefault: true
  }
]);
```

### Backend Environment Variables

The backend securely manages API keys through environment variables:

```env
# Google Maps API Key
GOOGLE_MAPS_API_KEY=your-google-maps-api-key

# Firebase Configuration
FIREBASE_API_KEY=your-firebase-api-key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=123456789
FIREBASE_APP_ID=1:123456789:web:abcdef123456

# JWT Configuration
JWT_SECRET=your-jwt-secret-key
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Payment Configuration
PHONEPE_MERCHANT_ID=your-phonepe-merchant-id
PHONEPE_MERCHANT_KEY=your-phonepe-merchant-key
PHONEPE_ENVIRONMENT=UAT
```

## Error Handling

### Standard Error Response Format

```json
{
  "success": false,
  "message": "Error description",
  "error": {
    "code": "ERROR_CODE",
    "message": "Detailed error message",
    "details": {}
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Common Error Codes

- `MISSING_INPUT`: Required input parameter missing
- `INVALID_TOKEN`: Invalid or expired authentication token
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `GOOGLE_MAPS_ERROR`: Google Maps API error
- `INTERNAL_ERROR`: Internal server error
- `VALIDATION_ERROR`: Input validation failed

## Rate Limiting

- **General API**: 100 requests per minute per IP
- **Authentication**: 5 requests per minute per IP
- **Google Maps API**: 1000 requests per day per API key

## Health Check

**Endpoint**: `GET /health`

**Description**: Check server health and service status

**Example Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "environment": "development",
  "version": "1.0.0",
  "memory": {
    "used": 128,
    "total": 512,
    "external": 64
  },
  "services": {
    "firebase": true,
    "redis": true,
    "socket": true
  }
}
```

## API Documentation

**Endpoint**: `GET /api-docs`

**Description**: Get complete API documentation

## Testing Endpoints

Available in development mode only:

- `GET /api/test/customer`: Test customer endpoint
- `GET /api/test/driver`: Test driver endpoint
- `GET /api/test/booking`: Test booking endpoint

## Security Best Practices

1. **API Keys**: Never expose API keys in frontend code
2. **Authentication**: Use JWT tokens with proper expiration
3. **HTTPS**: Always use HTTPS in production
4. **Rate Limiting**: Implement rate limiting to prevent abuse
5. **Input Validation**: Validate all input parameters
6. **Error Handling**: Don't expose sensitive information in errors
7. **Secure Storage**: Use Expo SecureStore for sensitive data
8. **Environment Variables**: Store secrets in environment variables

## Integration Examples

### Frontend Integration

```typescript
// Google Maps API
import { googleMapsApi } from '@/services/googleMapsApi';

// Search places
const places = await googleMapsApi.searchPlaces('bangalore');

// Get directions
const route = await googleMapsApi.calculateRoute(
  { latitude: 12.9716, longitude: 77.5946 },
  { latitude: 13.0827, longitude: 80.2707 }
);

// Secure storage
import { secureStorage } from '@/services/secureStorage';
await secureStorage.setAuthTokens(tokens);

// Real-time communication
import { websocketService } from '@/services/websocketService';
await websocketService.connect();
await websocketService.subscribeToBooking('booking-id');
```

### Backend Integration

```javascript
// Google Maps API routes
const googleMapsRoutes = require('./routes/googleMaps');
app.use('/api/google-maps', googleMapsRoutes);

// Socket.IO integration
const { initializeSocketIO } = require('./services/socket');
initializeSocketIO(server);

// Environment configuration
const { getEnvironmentConfig } = require('./config/environment');
const config = getEnvironmentConfig();
```

## Support

For API support and questions:

- **Email**: api-support@epickup.com
- **Documentation**: https://docs.epickup.com/api
- **Status Page**: https://status.epickup.com
