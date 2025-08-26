# EPickup Database Schema Documentation

## Overview
This document describes all Firebase Firestore collections and their field structures for the EPickup delivery platform.

## Collections

### 1. Users Collection (`users`)
**Description**: User accounts (customers and drivers)

| Field | Type | Description |
|-------|------|-------------|
| `uid` | string | Unique user ID |
| `email` | string | User email address |
| `phoneNumber` | string | User phone number |
| `userType` | string | 'customer' or 'driver' |
| `profile` | map | User profile information |
| `createdAt` | timestamp | Account creation date |
| `updatedAt` | timestamp | Last update date |
| `isActive` | boolean | Account active status |
| `lastLoginAt` | timestamp | Last login timestamp |

### 2. Customers Collection (`customers`)
**Description**: Customer-specific data

| Field | Type | Description |
|-------|------|-------------|
| `uid` | string | User ID reference |
| `customerId` | string | Unique customer ID |
| `personalInfo` | map | Personal information |
| `addresses` | array | Saved addresses |
| `preferences` | map | Customer preferences |
| `rating` | number | Customer rating |
| `totalOrders` | number | Total orders placed |
| `createdAt` | timestamp | Account creation date |
| `updatedAt` | timestamp | Last update date |

### 3. Drivers Collection (`drivers`)
**Description**: Driver-specific data

| Field | Type | Description |
|-------|------|-------------|
| `uid` | string | User ID reference |
| `driverId` | string | Unique driver ID |
| `personalInfo` | map | Personal information |
| `vehicleInfo` | map | Vehicle details |
| `documents` | map | Driver documents |
| `location` | geopoint | Current location |
| `isOnline` | boolean | Online status |
| `isAvailable` | boolean | Availability status |
| `rating` | number | Driver rating |
| `totalDeliveries` | number | Total deliveries completed |
| `earnings` | map | Earnings information |
| `createdAt` | timestamp | Account creation date |
| `updatedAt` | timestamp | Last update date |

### 4. Bookings Collection (`bookings`)
**Description**: Delivery bookings

| Field | Type | Description |
|-------|------|-------------|
| `bookingId` | string | Unique booking ID |
| `customerId` | string | Customer ID |
| `driverId` | string | Driver ID (assigned) |
| `pickupLocation` | map | Pickup location details |
| `dropoffLocation` | map | Dropoff location details |
| `packageDetails` | map | Package information |
| `status` | string | Booking status |
| `fare` | map | Fare breakdown |
| `paymentStatus` | string | Payment status |
| `createdAt` | timestamp | Booking creation date |
| `updatedAt` | timestamp | Last update date |
| `scheduledAt` | timestamp | Scheduled pickup time |
| `completedAt` | timestamp | Completion time |

### 5. Orders Collection (`orders`)
**Description**: Order tracking and history

| Field | Type | Description |
|-------|------|-------------|
| `orderId` | string | Unique order ID |
| `bookingId` | string | Booking reference |
| `customerId` | string | Customer ID |
| `driverId` | string | Driver ID |
| `status` | string | Order status |
| `tracking` | array | Tracking history |
| `estimatedDelivery` | timestamp | Estimated delivery time |
| `actualDelivery` | timestamp | Actual delivery time |
| `createdAt` | timestamp | Order creation date |
| `updatedAt` | timestamp | Last update date |

### 6. Payments Collection (`payments`)
**Description**: Payment transactions

| Field | Type | Description |
|-------|------|-------------|
| `paymentId` | string | Unique payment ID |
| `orderId` | string | Order reference |
| `customerId` | string | Customer ID |
| `amount` | number | Payment amount |
| `currency` | string | Currency code |
| `method` | string | Payment method |
| `status` | string | Payment status |
| `gatewayResponse` | map | Payment gateway response |
| `createdAt` | timestamp | Payment creation date |
| `updatedAt` | timestamp | Last update date |

### 7. Notifications Collection (`notifications`)
**Description**: Push notifications and messages

| Field | Type | Description |
|-------|------|-------------|
| `notificationId` | string | Unique notification ID |
| `userId` | string | User ID |
| `type` | string | Notification type |
| `title` | string | Notification title |
| `body` | string | Notification body |
| `data` | map | Additional data |
| `isRead` | boolean | Read status |
| `sentAt` | timestamp | Sent timestamp |
| `readAt` | timestamp | Read timestamp |

### 8. App Settings Collection (`appSettings`)
**Description**: Application configuration and settings

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Setting key |
| `value` | any | Setting value |
| `description` | string | Setting description |
| `updatedAt` | timestamp | Last update date |
| `updatedBy` | string | Updated by user |

### 9. Rates Collection (`rates`)
**Description**: Pricing and fare calculation rules

| Field | Type | Description |
|-------|------|-------------|
| `rateId` | string | Unique rate ID |
| `baseFare` | number | Base fare amount |
| `perKmRate` | number | Rate per kilometer |
| `waitingCharge` | number | Waiting charge |
| `surgeMultiplier` | number | Surge pricing multiplier |
| `isActive` | boolean | Active status |
| `validFrom` | timestamp | Valid from date |
| `validTo` | timestamp | Valid to date |
| `createdAt` | timestamp | Creation date |
| `updatedAt` | timestamp | Last update date |

### 10. Support Collection (`support`)
**Description**: Customer support tickets

| Field | Type | Description |
|-------|------|-------------|
| `ticketId` | string | Unique ticket ID |
| `customerId` | string | Customer ID |
| `subject` | string | Ticket subject |
| `description` | string | Ticket description |
| `status` | string | Ticket status |
| `priority` | string | Priority level |
| `assignedTo` | string | Assigned to user |
| `createdAt` | timestamp | Creation date |
| `updatedAt` | timestamp | Last update date |
| `resolvedAt` | timestamp | Resolution date |

## Wallet System Collections

### 11. Driver Wallets Collection (`driverWallets`)
**Description**: Driver wallet balances and information

| Field | Type | Description |
|-------|------|-------------|
| `driverId` | string | Driver ID |
| `initialCredit` | number | Initial credit amount |
| `commissionUsed` | number | Total commission used |
| `recharges` | number | Total recharges |
| `currentBalance` | number | Current wallet balance |
| `status` | string | 'active', 'inactive', 'suspended' |
| `lastRechargeDate` | timestamp | Last recharge date |
| `lastCommissionDeduction` | timestamp | Last commission deduction |
| `createdAt` | timestamp | Creation date |
| `updatedAt` | timestamp | Last update date |

### 12. Commission Transactions Collection (`commissionTransactions`)
**Description**: Commission deduction transactions

| Field | Type | Description |
|-------|------|-------------|
| `driverId` | string | Driver ID |
| `tripId` | string | Trip ID |
| `distanceKm` | number | Distance in kilometers |
| `commissionAmount` | number | Commission amount |
| `walletBalanceBefore` | number | Wallet balance before deduction |
| `walletBalanceAfter` | number | Wallet balance after deduction |
| `pickupLocation` | map | Pickup location details |
| `dropoffLocation` | map | Dropoff location details |
| `tripFare` | number | Trip fare amount |
| `status` | string | 'pending', 'completed', 'failed', 'refunded' |
| `notes` | string | Additional notes |
| `createdAt` | timestamp | Creation date |
| `updatedAt` | timestamp | Last update date |

### 13. Recharge Transactions Collection (`rechargeTransactions`)
**Description**: Wallet recharge transactions

| Field | Type | Description |
|-------|------|-------------|
| `driverId` | string | Driver ID |
| `amount` | number | Recharge amount |
| `paymentMethod` | string | 'upi', 'card', 'netbanking', 'cash' |
| `paymentGateway` | string | 'razorpay', 'paytm', 'phonepe', 'cash' |
| `transactionId` | string | Unique transaction ID |
| `gatewayTransactionId` | string | Gateway transaction ID |
| `status` | string | 'pending', 'completed', 'failed', 'cancelled' |
| `walletBalanceBefore` | number | Wallet balance before recharge |
| `walletBalanceAfter` | number | Wallet balance after recharge |
| `failureReason` | string | Failure reason if failed |
| `receiptUrl` | string | Receipt URL |
| `notes` | string | Additional notes |
| `createdAt` | timestamp | Creation date |
| `updatedAt` | timestamp | Last update date |

## Indexes

### Recommended Indexes for Performance

#### Single Field Indexes (Auto-created by Firestore)
- All string fields
- All number fields
- All timestamp fields

#### Composite Indexes (Manual creation required)

1. **Users Collection**
   - `userType` + `isActive`

2. **Drivers Collection**
   - `isOnline` + `isAvailable`

3. **Bookings Collection**
   - `status` + `createdAt`

4. **Orders Collection**
   - `customerId` + `status`

5. **Payments Collection**
   - `customerId` + `status`

6. **Notifications Collection**
   - `userId` + `isRead`

7. **Driver Wallets Collection**
   - `driverId` (single field)

8. **Commission Transactions Collection**
   - `driverId` + `createdAt`
   - `tripId` (single field)

9. **Recharge Transactions Collection**
   - `driverId` + `createdAt`
   - `transactionId` (single field)
   - `status` + `createdAt`

## Security Rules

### Basic Security Rules Template
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Drivers can read/write their own data
    match /drivers/{driverId} {
      allow read, write: if request.auth != null && request.auth.uid == driverId;
    }
    
    // Customers can read/write their own data
    match /customers/{customerId} {
      allow read, write: if request.auth != null && request.auth.uid == customerId;
    }
    
    // Wallet system - drivers can access their own wallet
    match /driverWallets/{driverId} {
      allow read, write: if request.auth != null && request.auth.uid == driverId;
    }
    
    // Commission transactions - drivers can read their own
    match /commissionTransactions/{docId} {
      allow read: if request.auth != null && resource.data.driverId == request.auth.uid;
    }
    
    // Recharge transactions - drivers can read their own
    match /rechargeTransactions/{docId} {
      allow read: if request.auth != null && resource.data.driverId == request.auth.uid;
    }
  }
}
```

## Migration Commands

### Run Database Migration
```bash
npm run migrate
```

### Run Enhanced Migration
```bash
npm run migrate:enhanced
```

### Run Wallet System Migration
```bash
npm run migrate:wallet
```

## Notes

1. **Firestore Collections**: Collections are created automatically when the first document is added
2. **Data Types**: Firestore supports string, number, boolean, timestamp, geopoint, array, and map types
3. **Indexes**: Single-field indexes are created automatically, composite indexes must be created manually
4. **Security**: Implement proper security rules before going to production
5. **Backup**: Set up automated backups for production data
6. **Monitoring**: Use Firebase Console to monitor usage and performance
