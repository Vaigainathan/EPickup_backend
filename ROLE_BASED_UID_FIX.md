# 🔧 Role-Based UID & Custom Claims Fix

## ❌ THE PROBLEM

### Error in Frontend:
```
ERROR  ❌ Error submitting documents: [Error: No role-based UID found in custom claims. Please log in again.]
WARN  ⚠️ [CLAIMS] No custom claims found in token
```

### Root Cause:
The `/api/auth/firebase/verify-token` endpoint was NOT:
1. ✅ Creating role-based UIDs (like `driver_hash`, `customer_hash`)
2. ✅ Setting Firebase custom claims with the role-based UID
3. ✅ Storing the role-based user in Firestore

**Result:** Frontend couldn't find the role-based UID needed for document uploads and other operations.

---

## ✅ THE FIX

### Changes Made to `backend/src/routes/auth.js` (Line 260-329):

#### 1. **Create Role-Based User**
```javascript
const roleBasedAuthService = require('../services/roleBasedAuthService');
const roleBasedUser = await roleBasedAuthService.getOrCreateRoleSpecificUser(
  decodedToken,
  userType,
  { name: name || decodedToken.name || decodedToken.email || decodedToken.phone_number }
);

const roleBasedUID = roleBasedUser.id || roleBasedUser.uid;
```

**What it does:**
- Generates a deterministic role-based UID using SHA256 hash of `phone + userType`
- Creates/retrieves user document in Firestore with this UID
- Example: `+919148101698 + driver` → `d4a7f8b3c2e1...` (28 chars)

---

#### 2. **Set Firebase Custom Claims**
```javascript
await firebaseAuthService.setCustomClaims(decodedToken.uid, {
  roleBasedUID: roleBasedUID,
  userType: userType,
  role: userType,
  createdAt: Date.now()
});
```

**What it does:**
- Sets custom claims on the Firebase user token
- Frontend can now access `roleBasedUID` via `getIdTokenResult()`
- Claims persist across app sessions

---

#### 3. **Use Role-Based UID in Backend JWT**
```javascript
const backendToken = jwtService.generateAccessToken({
  userId: roleBasedUID, // ✅ NOW uses role-based UID
  userType: userType || 'admin',
  phone: decodedToken.phone_number,
  metadata: {
    email: decodedToken.email,
    name: name,
    originalUID: decodedToken.uid // Keep Firebase UID for reference
  }
});
```

**What changed:**
- Backend JWT now contains role-based UID instead of Firebase UID
- All backend operations use the role-based UID
- Original Firebase UID stored in metadata for reference

---

## 📊 AUTH FLOW (FIXED)

### Before (Broken):
```
User signs up with phone
    ↓
Firebase creates user (Firebase UID: abc123)
    ↓
Backend verifies token ❌ BUT STOPS HERE
    ↓
No role-based UID created
    ↓
No custom claims set
    ↓
Frontend: "No role-based UID found" ERROR
```

### After (Working):
```
User signs up with phone: +919148101698
    ↓
Firebase creates user (Firebase UID: uby...3H2)
    ↓
Backend verifies token ✅
    ↓
Backend generates role-based UID
   - SHA256(+919148101698 + driver) → d4a7f8b3c2e1...
    ↓
Backend creates Firestore user document
   - Document ID: d4a7f8b3c2e1...
   - Contains: driver data, wallet, etc.
    ↓
Backend sets Firebase custom claims
   - roleBasedUID: d4a7f8b3c2e1...
   - userType: driver
    ↓
Backend generates JWT with role-based UID ✅
    ↓
Frontend receives both:
   - Backend JWT (for API calls)
   - Firebase token (with custom claims)
    ↓
Frontend can now:
   - Upload documents ✅
   - Access role-based data ✅
   - Make authenticated requests ✅
```

---

## 🔑 ROLE-BASED UID SYSTEM

### Why Role-Based UIDs?
- **Same phone number** can be used for **multiple roles**
- Each role gets a **unique, deterministic UID**
- Prevents conflicts between customer/driver accounts

### Example:
```
Phone: +919148101698
Role: driver  → UID: d4a7f8b3c2e1a9f6b4c8e7d2a5b9c3f1
Role: customer → UID: e8b2c5d9a3f7b1c4e6a9d8f2b7c3e5a1

Both can coexist without conflicts!
```

### Firestore Structure:
```
users/
  ├── d4a7f8b3c2e1... (driver account)
  │   ├── phone: "+919148101698"
  │   ├── userType: "driver"
  │   ├── driver: { ... }
  │   └── ...
  │
  └── e8b2c5d9a3f7... (customer account)
      ├── phone: "+919148101698"
      ├── userType: "customer"
      ├── customer: { ... }
      └── ...
```

---

## 🚀 DEPLOYMENT CHECKLIST

### 1. **Commit Changes**
```bash
cd backend
git add src/routes/auth.js
git commit -m "fix: implement role-based UID and custom claims in auth flow"
```

### 2. **Push to Repo**
```bash
git push origin audit/admin-auth-fix
```

### 3. **Verify Deployment on Render**
Check logs for:
```
✅ [FIREBASE_AUTH] Role-based user created/retrieved: {...}
✅ [FIREBASE_AUTH] Custom claims set successfully
```

### 4. **Test on Frontend**
- Delete existing user: `npm run delete-test-users`
- Signup with test phone: `+919148101698`
- Upload documents ✅
- Check logs: No more "No role-based UID found" error

---

## 📝 RELATED FILES

### Backend:
- ✅ `backend/src/routes/auth.js` - Auth endpoint (MODIFIED)
- `backend/src/services/roleBasedAuthService.js` - Role-based UID generation
- `backend/src/services/firebaseAuthService.js` - Custom claims setter
- `backend/src/services/jwtService.js` - Backend JWT generation

### Frontend:
- `driver-app/services/customClaimsService.ts` - Reads custom claims
- `driver-app/contexts/AuthContext.tsx` - Auth state management

---

## 🎯 EXPECTED BEHAVIOR AFTER FIX

### On Signup:
1. ✅ User receives Firebase token
2. ✅ Backend creates role-based UID
3. ✅ Backend sets custom claims
4. ✅ Frontend receives both tokens
5. ✅ Frontend can access `roleBasedUID` from custom claims

### On Document Upload:
1. ✅ Frontend reads `roleBasedUID` from custom claims
2. ✅ Frontend uploads documents to Firestore using `roleBasedUID`
3. ✅ No more "No role-based UID found" error

### On API Calls:
1. ✅ Frontend sends backend JWT (contains role-based UID)
2. ✅ Backend validates JWT
3. ✅ Backend operations use role-based UID
4. ✅ All data correctly associated with role-based user

---

## 🔍 DEBUGGING

### Check Custom Claims (Frontend):
```typescript
const idTokenResult = await user.getIdTokenResult();
console.log('Custom claims:', idTokenResult.claims);
// Should show: { roleBasedUID: "d4a7f8b3...", userType: "driver", ... }
```

### Check Backend Logs:
```
✅ [FIREBASE_AUTH] Firebase token verified
✅ [FIREBASE_AUTH] Role-based user created/retrieved: { roleBasedUID: "..." }
✅ [FIREBASE_AUTH] Custom claims set successfully
✅ [FIREBASE_AUTH] Backend JWT token generated
```

### Check Firestore:
```
users/d4a7f8b3c2e1.../
  - originalFirebaseUID: "uby...3H2"
  - phone: "+919148101698"
  - userType: "driver"
  - driver: { documents: {...}, wallet: {...} }
```

---

## ✅ SUMMARY

**Problem:** No role-based UIDs, no custom claims = Frontend errors

**Solution:** 
1. Generate role-based UID from phone + userType
2. Create/retrieve user in Firestore with this UID
3. Set Firebase custom claims with role-based UID
4. Use role-based UID in backend JWT

**Result:** 
- ✅ Frontend can access role-based UID
- ✅ Document uploads work
- ✅ API calls authenticated properly
- ✅ Same phone can have multiple roles

---

**Deploy this fix and test your driver app! 🎉**

