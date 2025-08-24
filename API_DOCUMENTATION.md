# EPickup API Documentation

## Table of Contents
1. [Authentication](#authentication)
2. [Customer APIs](#customer-apis)
3. [Driver APIs](#driver-apis)
4. [Booking APIs](#booking-apis)
5. [Payment APIs](#payment-apis)
6. [Tracking APIs](#tracking-apis)
7. [File Upload APIs](#file-upload-apis)
8. [Notification APIs](#notification-apis)
9. [Support APIs](#support-apis)
10. [Real-time APIs](#real-time-apis)

## Authentication

### Send OTP
```http
POST /api/auth/send-otp
```

**Request Body:**
```json
{
  "phoneNumber": "+919876543210",
  "isSignup": false,
  "recaptchaToken": "optional_recaptcha_token"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "phoneNumber": "+919876543210",
    "isSignup": false,
    "expiresIn": 600
  }
}
```

### Verify OTP
```http
POST /api/auth/verify-otp
```

**Request Body:**
```json
{
  "phoneNumber": "+919876543210",
  "otp": "123456",
  "isSignup": false,
  "userType": "driver",
  "name": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "user_id",
      "name": "John Doe",
      "phone": "+919876543210",
      "userType": "driver",
      "isVerified": true
    },
    "accessToken": "firebase_custom_token",
    "refreshToken": null,
    "expiresIn": 3600,
    "isNewUser": false
  }
}
```

## Driver APIs

### Get Driver Profile
```http
GET /api/driver/profile
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Profile retrieved successfully",
  "data": {
    "profile": {
      "id": "driver_id",
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+919876543210",
      "profilePicture": "https://example.com/photo.jpg",
      "driver": {
        "vehicleDetails": {
          "type": "motorcycle",
          "model": "Honda Activa",
          "number": "KA01AB1234",
          "color": "Black"
        },
        "verificationStatus": "approved",
        "isOnline": true,
        "isAvailable": true,
        "rating": 4.5,
        "totalTrips": 150,
        "earnings": {
          "total": 25000,
          "thisMonth": 5000,
          "thisWeek": 1200
        }
      }
    }
  }
}
```

### Update Driver Profile
```http
PUT /api/driver/profile
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "profilePicture": "https://example.com/photo.jpg"
}
```

### Upload Driver Document
```http
POST /api/driver/documents
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "documentType": "drivingLicense",
  "documentUrl": "https://example.com/document.jpg",
  "documentNumber": "DL1234567890123"
}
```

### Get Document Status
```http
GET /api/driver/documents/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Document status retrieved successfully",
  "data": {
    "verificationStatus": "pending_verification",
    "documentStatus": {
      "total": 5,
      "uploaded": 5,
      "verified": 3,
      "rejected": 1,
      "pending": 1
    },
    "documents": [
      {
        "type": "drivingLicense",
        "name": "Driving License",
        "status": "verified",
        "url": "https://example.com/dl.jpg",
        "number": "DL1234567890123",
        "uploadedAt": "2024-01-15T10:30:00Z",
        "verifiedAt": "2024-01-16T14:20:00Z",
        "verifiedBy": "admin_user_id"
      }
    ],
    "isComplete": true,
    "isVerified": false,
    "canStartWorking": false
  }
}
```

### Request Document Verification
```http
POST /api/driver/documents/request-verification
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Document verification requested successfully",
  "data": {
    "verificationStatus": "pending_verification",
    "verificationRequestId": "request_id",
    "requestedAt": "2024-01-15T10:30:00Z",
    "estimatedReviewTime": "24-48 hours"
  }
}
```

### Get Verification History
```http
GET /api/driver/documents/verification-history?limit=10&offset=0
Authorization: Bearer <token>
```

### Driver Wallet Management

#### Get Wallet Balance
```http
GET /api/driver/wallet?limit=20&offset=0
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Wallet information retrieved successfully",
  "data": {
    "wallet": {
      "balance": 2500.50,
      "currency": "INR"
    },
    "transactions": [
      {
        "id": "transaction_id",
        "driverId": "driver_id",
        "type": "credit",
        "amount": 500,
        "previousBalance": 2000.50,
        "newBalance": 2500.50,
        "paymentMethod": "upi",
        "status": "completed",
        "createdAt": "2024-01-15T10:30:00Z"
      }
    ],
    "pagination": {
      "limit": 20,
      "offset": 0,
      "total": 15
    }
  }
}
```

#### Add Money to Wallet
```http
POST /api/driver/wallet/add-money
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "amount": 500,
  "paymentMethod": "upi",
  "upiId": "john@upi"
}
```

#### Withdraw from Wallet
```http
POST /api/driver/wallet/withdraw
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "amount": 1000,
  "bankDetails": {
    "accountNumber": "1234567890",
    "ifscCode": "SBIN0001234",
    "accountHolderName": "John Doe"
  }
}
```

### Driver Availability Management

#### Set Availability Slots
```http
PUT /api/driver/availability/slots
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "workingHours": {
    "startTime": "09:00",
    "endTime": "18:00"
  },
  "workingDays": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
  "availabilitySlots": [
    {
      "day": "monday",
      "slots": [
        {
          "startTime": "09:00",
          "endTime": "12:00",
          "isAvailable": true
        },
        {
          "startTime": "14:00",
          "endTime": "18:00",
          "isAvailable": true
        }
      ]
    }
  ],
  "maxBookingsPerDay": 10,
  "preferredAreas": [
    {
      "name": "Koramangala",
      "coordinates": {
        "latitude": 12.9349,
        "longitude": 77.6056
      },
      "radius": 5
    }
  ]
}
```

#### Get Availability Slots
```http
GET /api/driver/availability/slots
Authorization: Bearer <token>
```

#### Toggle Slot Availability
```http
POST /api/driver/availability/toggle-slot
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "day": "monday",
  "startTime": "09:00",
  "endTime": "12:00",
  "isAvailable": false
}
```

### Driver Earnings

#### Get Earnings
```http
GET /api/driver/earnings?period=month&startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Earnings retrieved successfully",
  "data": {
    "summary": {
      "total": 25000,
      "thisMonth": 5000,
      "thisWeek": 1200
    },
    "period": "month",
    "totalEarnings": 5000,
    "payments": [
      {
        "id": "payment_id",
        "bookingId": "booking_id",
        "amount": 150,
        "completedAt": "2024-01-15T10:30:00Z"
      }
    ],
    "paymentCount": 25
  }
}
```

### Driver Trips

#### Get Trip History
```http
GET /api/driver/trips?status=completed&limit=20&offset=0
Authorization: Bearer <token>
```

### Driver Status Management

#### Update Driver Status
```http
PUT /api/driver/status
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "isOnline": true,
  "isAvailable": true,
  "workingHours": {
    "startTime": "09:00",
    "endTime": "18:00"
  },
  "workingDays": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
}
```

#### Update Driver Location
```http
POST /api/driver/location
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "latitude": 12.9349,
  "longitude": 77.6056,
  "accuracy": 10
}
```

### Available Bookings

#### Get Available Bookings
```http
GET /api/driver/bookings?limit=20&offset=0&radius=5
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Available bookings retrieved successfully",
  "data": {
    "bookings": [
      {
        "id": "booking_id",
        "customerId": "customer_id",
        "pickup": {
          "name": "John Doe",
          "phone": "+919876543210",
          "address": "123 Main St, Koramangala",
          "coordinates": {
            "latitude": 12.9349,
            "longitude": 77.6056
          }
        },
        "dropoff": {
          "name": "Jane Smith",
          "phone": "+919876543211",
          "address": "456 Oak St, Indiranagar",
          "coordinates": {
            "latitude": 12.9789,
            "longitude": 77.5917
          }
        },
        "package": {
          "weight": 2.5,
          "description": "Documents"
        },
        "fare": {
          "total": 150,
          "currency": "INR"
        },
        "distanceFromDriver": 1.2
      }
    ],
    "pagination": {
      "limit": 20,
      "offset": 0,
      "total": 5
    },
    "driverLocation": {
      "latitude": 12.9349,
      "longitude": 77.6056
    },
    "searchRadius": 5
  }
}
```

#### Accept Booking
```http
POST /api/driver/bookings/:id/accept
Authorization: Bearer <token>
```

#### Reject Booking
```http
POST /api/driver/bookings/:id/reject
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "reason": "Too far from current location"
}
```

#### Update Booking Status
```http
PUT /api/driver/bookings/:id/status
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "status": "driver_arrived",
  "location": {
    "latitude": 12.9349,
    "longitude": 77.6056,
    "accuracy": 10
  },
  "notes": "Arrived at pickup location"
}
```

### Photo Verification

#### Upload Photo Verification
```http
POST /api/driver/bookings/:id/photo-verification
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "photoType": "pickup",
  "photoUrl": "https://example.com/photo.jpg",
  "photoMetadata": {
    "fileSize": 1024000,
    "dimensions": {
      "width": 1920,
      "height": 1080
    }
  },
  "location": {
    "latitude": 12.9349,
    "longitude": 77.6056,
    "accuracy": 10
  },
  "notes": "Package picked up successfully"
}
```

#### Get Photo Verifications
```http
GET /api/driver/bookings/:id/photo-verifications
Authorization: Bearer <token>
```

#### Update Photo Verification
```http
PUT /api/driver/bookings/:id/photo-verifications/:photoId
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "photoUrl": "https://example.com/new-photo.jpg",
  "notes": "Updated photo with better lighting"
}
```

### Real-time Tracking

#### Start Trip Tracking
```http
POST /api/driver/tracking/start
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "bookingId": "booking_id",
  "initialLocation": {
    "latitude": 12.9349,
    "longitude": 77.6056,
    "accuracy": 10
  }
}
```

#### Update Trip Tracking
```http
POST /api/driver/tracking/update
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "bookingId": "booking_id",
  "location": {
    "latitude": 12.9349,
    "longitude": 77.6056,
    "accuracy": 10
  },
  "status": "in_transit",
  "speed": 25.5,
  "heading": 180
}
```

#### Stop Trip Tracking
```http
POST /api/driver/tracking/stop
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "bookingId": "booking_id",
  "finalLocation": {
    "latitude": 12.9789,
    "longitude": 77.5917,
    "accuracy": 10
  }
}
```

## Error Responses

All API endpoints return consistent error responses:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": "Additional error details or validation errors"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Common Error Codes

- `UNAUTHORIZED` - Missing or invalid authentication token
- `FORBIDDEN` - Insufficient permissions
- `VALIDATION_ERROR` - Request validation failed
- `USER_NOT_FOUND` - User does not exist
- `BOOKING_NOT_FOUND` - Booking does not exist
- `INSUFFICIENT_BALANCE` - Wallet balance insufficient
- `DOCUMENT_NOT_FOUND` - Document does not exist
- `PHOTO_VERIFICATION_NOT_FOUND` - Photo verification does not exist
- `TRIP_TRACKING_NOT_FOUND` - Trip tracking does not exist
- `ACCESS_DENIED` - User cannot access this resource
- `BOOKING_NOT_AVAILABLE` - Booking is no longer available
- `DRIVER_NOT_AVAILABLE` - Driver is not available
- `INVALID_STATUS_FOR_PHOTO` - Cannot upload photo in current booking status
- `VERIFICATION_ALREADY_REQUESTED` - Verification already requested
- `INCOMPLETE_DOCUMENTS` - Not all required documents uploaded
- `PHOTO_NOT_REJECTED` - Can only update rejected photos
- `TRIP_NOT_ACTIVE` - Trip tracking is not active

## Rate Limiting

- Authentication endpoints: 5 requests per minute
- General API endpoints: 100 requests per minute
- File upload endpoints: 10 requests per minute
- Real-time tracking endpoints: 60 requests per minute

## WebSocket Events

### Driver Events

#### Connect
```javascript
socket.emit('driver:connect', {
  driverId: 'driver_id',
  token: 'firebase_custom_token'
});
```

#### Location Update
```javascript
socket.emit('driver:location_update', {
  driverId: 'driver_id',
  location: {
    latitude: 12.9349,
    longitude: 77.6056,
    accuracy: 10,
    speed: 25.5,
    heading: 180
  }
});
```

#### Status Update
```javascript
socket.emit('driver:status_update', {
  driverId: 'driver_id',
  status: 'online',
  isAvailable: true
});
```

#### Join Booking Room
```javascript
socket.emit('driver:join_booking', {
  driverId: 'driver_id',
  bookingId: 'booking_id'
});
```

#### Leave Booking Room
```javascript
socket.emit('driver:leave_booking', {
  driverId: 'driver_id',
  bookingId: 'booking_id'
});
```

### Driver Event Listeners

#### Booking Assignment
```javascript
socket.on('driver:booking_assigned', (data) => {
  console.log('New booking assigned:', data);
});
```

#### Booking Update
```javascript
socket.on('driver:booking_updated', (data) => {
  console.log('Booking updated:', data);
});
```

#### Customer Message
```javascript
socket.on('driver:customer_message', (data) => {
  console.log('Message from customer:', data);
});
```

#### Emergency Alert
```javascript
socket.on('driver:emergency_alert', (data) => {
  console.log('Emergency alert:', data);
});
```

## Testing

### Test Environment

- Base URL: `https://api.epickup.test`
- Test phone numbers: `+919876543210` to `+919876543219`
- Test OTP: `123456`

### Test Data

#### Test Driver
```json
{
  "phone": "+919876543210",
  "name": "Test Driver",
  "userType": "driver",
  "verificationStatus": "approved"
}
```

#### Test Booking
```json
{
  "id": "test_booking_id",
  "customerId": "test_customer_id",
  "pickup": {
    "name": "Test Customer",
    "phone": "+919876543211",
    "address": "Test Pickup Address",
    "coordinates": {
      "latitude": 12.9349,
      "longitude": 77.6056
    }
  },
  "dropoff": {
    "name": "Test Recipient",
    "phone": "+919876543212",
    "address": "Test Dropoff Address",
    "coordinates": {
      "latitude": 12.9789,
      "longitude": 77.5917
    }
  },
  "status": "pending"
}
```

## SDK Integration

### React Native Example

```javascript
import { EPickupDriverSDK } from '@epickup/driver-sdk';

const driverSDK = new EPickupDriverSDK({
  baseURL: 'https://api.epickup.com',
  apiKey: 'your_api_key'
});

// Initialize with Firebase token
await driverSDK.initialize(firebaseCustomToken);

// Get available bookings
const bookings = await driverSDK.getAvailableBookings({
  limit: 20,
  radius: 5
});

// Accept booking
await driverSDK.acceptBooking(bookingId);

// Start tracking
await driverSDK.startTripTracking(bookingId, initialLocation);

// Update location
await driverSDK.updateTripLocation(bookingId, location);

// Upload photo
await driverSDK.uploadPhotoVerification(bookingId, {
  photoType: 'pickup',
  photoUrl: 'https://example.com/photo.jpg'
});
```

### WebSocket Integration

```javascript
import { EPickupDriverWebSocket } from '@epickup/driver-websocket';

const ws = new EPickupDriverWebSocket({
  url: 'wss://api.epickup.com',
  driverId: 'driver_id',
  token: 'firebase_custom_token'
});

ws.on('booking_assigned', (booking) => {
  console.log('New booking:', booking);
});

ws.on('customer_message', (message) => {
  console.log('Customer message:', message);
});

ws.on('emergency_alert', (alert) => {
  console.log('Emergency alert:', alert);
});

// Send location update
ws.sendLocation({
  latitude: 12.9349,
  longitude: 77.6056,
  accuracy: 10
});
```
