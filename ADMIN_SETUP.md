# Admin User Setup Guide

This guide explains how to properly set up admin users using Firebase Authentication instead of hardcoded credentials.

## 🔧 Setup Process

### 1. Create Admin User in Firebase Auth

Use the provided script to create admin users with proper custom claims:

```bash
cd backend
node scripts/setup-admin-user.js admin@yourdomain.com SecurePassword123! super_admin
```

**Parameters:**
- `email`: Admin user email address
- `password`: Secure password (minimum 8 characters)
- `role`: Admin role (default: `super_admin`)

### 2. What the Script Does

1. **Creates Firebase Auth User**: Creates a new user in Firebase Authentication
2. **Sets Custom Claims**: Assigns admin privileges via custom claims:
   ```javascript
   {
     userType: 'admin',
     role: 'super_admin',
     permissions: ['all'],
     adminLevel: 'super_admin'
   }
   ```
3. **Verifies Setup**: Confirms the user has proper admin privileges

### 3. Environment Variables Required

Only `JWT_SECRET` is required (no more hardcoded admin credentials):

```bash
export JWT_SECRET="your-256-bit-secret-key"
```

### 4. How Authentication Works

1. **Frontend**: User logs in with email/password via Firebase Auth
2. **Firebase**: Returns Firebase ID token with custom claims
3. **Backend**: Verifies Firebase ID token and checks admin custom claims
4. **Response**: Backend generates JWT token for API access

## 🔐 Security Benefits

### ✅ **Improved Security**
- No hardcoded credentials in source code
- Firebase handles password security (hashing, salting, etc.)
- Custom claims provide fine-grained access control
- Firebase ID tokens are cryptographically signed

### ✅ **Scalability**
- Multiple admin users can be created easily
- Different admin roles and permissions
- Centralized user management via Firebase Console

### ✅ **Production Ready**
- No environment variables for sensitive credentials
- Firebase handles authentication infrastructure
- Automatic token refresh and validation

## 🚀 Usage Examples

### Create Super Admin
```bash
node scripts/setup-admin-user.js admin@company.com MySecurePass123! super_admin
```

### Create Regular Admin
```bash
node scripts/setup-admin-user.js manager@company.com AnotherSecurePass123! admin
```

### Verify Admin User
```bash
# Check Firebase Console > Authentication > Users
# Look for custom claims: { userType: 'admin', role: 'super_admin' }
```

## 🔍 Troubleshooting

### User Can't Login
1. Check if user exists in Firebase Console
2. Verify custom claims are set correctly
3. Check Firebase project configuration

### Permission Denied
1. Ensure custom claims include `userType: 'admin'`
2. Verify role is `super_admin` or `admin`
3. Check Firestore rules allow admin access

### Backend Errors
1. Verify `JWT_SECRET` environment variable is set
2. Check Firebase Admin SDK configuration
3. Ensure Firebase project has Authentication enabled

## 📝 Notes

- Admin users are created in Firebase Authentication, not in your database
- Custom claims are automatically included in Firebase ID tokens
- The backend verifies these claims before granting access
- No need to store admin credentials in environment variables
- Firebase handles all password security best practices

## 🎯 Next Steps

1. Run the setup script to create your first admin user
2. Test login through the admin dashboard
3. Create additional admin users as needed
4. Remove any hardcoded credentials from your codebase
5. Deploy with only `JWT_SECRET` environment variable
