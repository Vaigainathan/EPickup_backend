# EPickup Backend API - Product Specification Document

## Product Overview
EPickup is a comprehensive delivery service platform connecting customers with drivers for on-demand package delivery services. The backend API powers the entire ecosystem including customer mobile app, driver mobile app, and admin dashboard.

## Core Purpose
Provide a robust, scalable, and secure backend infrastructure for:
- Real-time package delivery booking and tracking
- Driver-customer matching and assignment
- Payment processing and wallet management
- Live location tracking and navigation
- Communication between all stakeholders

## Target Users
1. **Customers** - Users who need packages delivered
2. **Drivers** - Delivery personnel who fulfill orders
3. **Admins** - Platform operators managing the system

## Key Features

### 1. Authentication & Authorization
- **Phone-based authentication** using Firebase Auth
- **OTP verification** for secure login
- **JWT token management** for session handling
- **Role-based access control** (customer, driver, admin)
- **Refresh token mechanism** for seamless sessions

**Endpoints:**
- `POST /api/auth/phone` - Send OTP to phone number
- `POST /api/auth/verify-otp` - Verify OTP and login
- `POST /api/auth/firebase/verify-token` - Verify Firebase token
- `POST /api/auth/refresh-token` - Refresh expired tokens

### 2. Customer Management
- **Profile management** - Name, email, phone, address
- **Booking history** - View past and active bookings
- **Wallet management** - Digital wallet for payments
- **Preferences** - Saved addresses, payment methods

**Endpoints:**
- `GET /api/customer/profile` - Get customer profile
- `PUT /api/customer/profile` - Update customer profile
- `GET /api/customer/bookings` - Get customer's bookings
- `GET /api/wallet/balance` - Get wallet balance

### 3. Booking System
- **Create booking** - Customer creates delivery request
- **Real-time tracking** - Live driver location updates
- **Status management** - Pending, assigned, picked up, in transit, delivered
- **Fare calculation** - Dynamic pricing based on distance and demand
- **Driver assignment** - Manual acceptance by available drivers

**Workflow:**
1. Customer creates booking with pickup and dropoff locations
2. System broadcasts booking to nearby available drivers (within 10km)
3. Drivers receive notification with booking details
4. Driver manually accepts the booking
5. Customer is notified of driver assignment
6. Real-time tracking begins
7. Driver picks up package
8. Driver delivers package
9. Payment is processed
10. Both parties can rate each other

**Endpoints:**
- `POST /api/bookings` - Create new booking
- `GET /api/bookings/:id` - Get booking details
- `GET /api/bookings` - List bookings (filtered by status)
- `PUT /api/bookings/:id/status` - Update booking status
- `GET /api/bookings/:id/tracking` - Real-time tracking data

### 4. Driver Management
- **Profile & documents** - License, vehicle info, insurance
- **Verification workflow** - Admin approves driver documents
- **Availability management** - Online/offline status
- **Work slots system** - Manage working hours
- **Earnings dashboard** - Daily, weekly, monthly earnings
- **Location tracking** - Background location updates

**Endpoints:**
- `GET /api/driver/profile` - Get driver profile
- `PUT /api/driver/profile` - Update driver profile
- `POST /api/driver/documents` - Upload verification documents
- `PUT /api/driver/online-status` - Toggle online/offline
- `GET /api/driver/earnings` - Get earnings summary
- `POST /api/driver/bookings/:id/accept` - Accept booking
- `PUT /api/driver/location` - Update current location

### 5. Real-time Communication
- **Socket.IO** for bidirectional real-time events
- **Driver location broadcasts** - Live position updates
- **Booking notifications** - New booking alerts to drivers
- **Status updates** - Real-time booking status changes
- **Chat support** - In-app messaging (if implemented)

**Socket Events:**
- `connection` - Client connects to server
- `driver:go_online` - Driver goes online
- `driver:go_offline` - Driver goes offline
- `new_booking_available` - Broadcast new booking to drivers
- `booking:status_update` - Booking status changed
- `driver:location_update` - Driver location changed

### 6. Payment Processing
- **PhonePe Gateway integration**
- **Wallet system** - Prepaid wallet for customers and drivers
- **Transaction history** - Complete payment records
- **Refunds** - Automated refund processing
- **Payment verification** - Webhook handling for payment confirmation

**Endpoints:**
- `POST /api/payments/create` - Initiate payment
- `POST /api/payments/verify` - Verify payment status
- `POST /api/payments/phonepe/callback` - PhonePe webhook
- `POST /api/wallet/topup` - Add money to wallet
- `GET /api/wallet/transactions` - Transaction history

### 7. Location Services
- **Google Maps integration** - Geocoding, distance matrix
- **Service area validation** - Check if location is serviceable
- **Distance calculation** - Haversine formula for precise distances
- **Nearby driver search** - Find drivers within radius
- **Route optimization** - Best path calculation

**Endpoints:**
- `POST /api/google-maps/geocode` - Convert address to coordinates
- `POST /api/google-maps/distance` - Calculate distance between points
- `POST /api/service-area/validate-location` - Check if serviceable
- `GET /api/service-area/info` - Get service area details

### 8. Admin Dashboard APIs
- **Driver verification** - Approve/reject driver applications
- **Booking monitoring** - Real-time booking oversight
- **Analytics** - Platform statistics and metrics
- **User management** - Suspend/activate users
- **Support tickets** - Handle customer issues
- **Emergency alerts** - Handle SOS requests

**Endpoints:**
- `GET /api/admin/dashboard` - Dashboard statistics
- `GET /api/admin/drivers` - List all drivers
- `PUT /api/admin/drivers/:id/verify` - Verify driver
- `GET /api/admin/bookings` - All bookings with filters
- `GET /api/admin/analytics` - Platform analytics

### 9. Notifications
- **Firebase Cloud Messaging (FCM)** - Push notifications
- **Token management** - Store and update FCM tokens
- **Batch notifications** - Send to multiple users
- **Notification types:**
  - Booking created
  - Driver assigned
  - Driver arrived at pickup
  - Package picked up
  - Package delivered
  - Payment received

**Endpoints:**
- `POST /api/notifications/send` - Send notification
- `POST /api/fcm-tokens/register` - Register FCM token
- `DELETE /api/fcm-tokens/:token` - Remove token

### 10. Health & Monitoring
- **Health checks** - Server status monitoring
- **Performance metrics** - Response times, memory usage
- **Error tracking** - Sentry integration
- **Logging** - Winston logger with file rotation
- **Alerts** - System alerts for critical issues

**Endpoints:**
- `GET /health` - Basic health check
- `GET /api/health/detailed` - Detailed system health

## Technical Stack

### Backend
- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Real-time:** Socket.IO
- **Language:** JavaScript

### Database
- **Primary:** Firebase Firestore (NoSQL)
- **Real-time DB:** Firebase Realtime Database
- **Session Store:** Firestore Session Service

### Authentication
- **Provider:** Firebase Authentication
- **Method:** Phone number + OTP
- **Tokens:** JWT + Firebase tokens

### External Services
- **Maps:** Google Maps Platform API
- **Payments:** PhonePe Payment Gateway
- **Notifications:** Firebase Cloud Messaging
- **Storage:** Firebase Storage
- **Monitoring:** Sentry, Winston Logger

### Deployment
- **Hosting:** Railway (https://epickupbackend-production.up.railway.app)
- **Environment:** Production
- **Port:** 3000
- **Auto-deploy:** GitHub integration

## Security Features
- **Rate limiting** - Prevent API abuse
- **Input sanitization** - XSS protection
- **CORS** - Controlled cross-origin requests
- **Helmet.js** - Security headers
- **JWT validation** - Token verification
- **Role-based access** - Authorization checks
- **Data encryption** - Sensitive data protection

## Business Logic

### Fare Calculation
- Base fare + (distance × per km rate) + (time × per minute rate)
- Surge pricing during high demand
- Service fees and taxes included

### Driver Matching
- Find drivers within 10km radius
- Filter by online and available status
- Sort by distance from pickup location
- Broadcast to all eligible drivers
- First to accept gets the booking

### Work Slots System
- Drivers can set working hours
- Auto-availability based on work slots
- Prevents booking assignments outside working hours

### Wallet System
- Prepaid balance for customers
- Earnings wallet for drivers
- Auto-deduction on booking completion
- Refund to wallet on cancellation

## Performance Requirements
- API response time: < 200ms (average)
- WebSocket latency: < 100ms
- Database queries: < 100ms
- Payment processing: < 3 seconds
- Support 500+ concurrent connections

## Data Models

### User (Customer/Driver)
```javascript
{
  uid: string,
  userType: "customer" | "driver",
  name: string,
  phone: string,
  email: string,
  profileImage: string,
  createdAt: timestamp,
  lastActive: timestamp
}
```

### Booking
```javascript
{
  id: string,
  customerId: string,
  driverId: string | null,
  status: "pending" | "assigned" | "picked_up" | "in_transit" | "delivered" | "cancelled",
  pickup: {
    address: string,
    coordinates: { latitude: number, longitude: number }
  },
  dropoff: {
    address: string,
    coordinates: { latitude: number, longitude: number }
  },
  package: {
    weight: number,
    description: string
  },
  fare: number,
  distance: number,
  estimatedDuration: number,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Driver Profile
```javascript
{
  isOnline: boolean,
  isAvailable: boolean,
  currentLocation: {
    latitude: number,
    longitude: number,
    timestamp: timestamp
  },
  vehicle: {
    type: string,
    model: string,
    number: string
  },
  documents: {
    license: { url: string, verified: boolean },
    insurance: { url: string, verified: boolean },
    rc: { url: string, verified: boolean }
  },
  earnings: {
    daily: number,
    weekly: number,
    monthly: number
  }
}
```

## Test Scenarios

### Critical User Journeys

1. **Customer Booking Flow:**
   - Customer logs in
   - Creates new booking
   - Receives driver assignment
   - Tracks delivery in real-time
   - Makes payment
   - Rates driver

2. **Driver Acceptance Flow:**
   - Driver logs in
   - Goes online
   - Receives booking notification
   - Accepts booking
   - Picks up package
   - Delivers package
   - Receives payment

3. **Admin Management Flow:**
   - Admin logs in
   - Reviews driver application
   - Verifies documents
   - Approves driver
   - Monitors active bookings

### Edge Cases to Test
- Multiple drivers accepting same booking
- Customer cancels after driver assigned
- Driver goes offline during delivery
- Payment failure handling
- Network connectivity issues
- Location permission denied
- Service area boundary cases
- High concurrent booking creation

## Success Criteria
- ✅ All endpoints return correct status codes
- ✅ Authentication works with test phone numbers
- ✅ Booking creation succeeds
- ✅ Driver receives real-time notifications
- ✅ Location updates work correctly
- ✅ Payment processing completes successfully
- ✅ No critical errors in logs
- ✅ Response times meet requirements
- ✅ Socket.IO connections stable

## Environment Configuration
- Production: Railway (https://epickupbackend-production.up.railway.app)
- Local: http://localhost:3000
- Test phone numbers: +919999999999, +918888888888
- Firebase project: epickup-production
- Payment mode: Test mode (for development)
