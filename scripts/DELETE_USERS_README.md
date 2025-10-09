# 🗑️ Delete Test Users Script

Quick script to delete test users from Firebase Auth and Firestore for repeated testing.

## 🚀 Usage

### Option 1: Using npm script (Recommended)
```bash
cd backend
npm run delete-test-users
```

### Option 2: Direct node command
```bash
cd backend
node scripts/delete-test-users.js
```

## 📱 Test Phone Numbers

The script automatically deletes these phone numbers:
- `+919148101698`
- `+919686218054`

## ✏️ Add More Numbers

Edit `backend/scripts/delete-test-users.js` and add phone numbers to the array:

```javascript
const TEST_PHONE_NUMBERS = [
  '+919148101698',
  '+919686218054',
  '+911234567890'  // Add your number here
];
```

## 🔧 Requirements

**Environment Variables** (in `.env` file):
- `FIREBASE_PROJECT_ID`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CLIENT_EMAIL`

**OR**

**Service Account File:**
- `backend/firebase-service-account.json`

## 📊 What it Does

1. ✅ Deletes users from Firebase Auth (by phone number)
2. ✅ Deletes user documents from Firestore `users` collection
3. ✅ Shows detailed summary of deletions

## 🎯 Use Cases

- Testing signup flows repeatedly
- Resetting test accounts
- Cleaning up after development/testing
- QA testing with fresh accounts

## ⚠️ Warning

**DO NOT run this in production!**

This script is for development/testing only. Always use test phone numbers.

## 📝 Example Output

```
═══════════════════════════════════════════════════════════
🗑️  DELETE TEST USERS FROM FIREBASE
═══════════════════════════════════════════════════════════

📱 Test phone numbers to delete: 2
   - +919148101698
   - +919686218054

✅ Firebase Admin SDK initialized

─────────────────────────────────────────────────────────
🔍 Searching for user with phone: +919148101698
✅ Found user: AFk3h07WZWd4d8iG0zbGX4VDx2y2
   - Phone: +919148101698
   - Created: 2025-01-09T10:00:00.000Z
✅ Successfully deleted user: AFk3h07WZWd4d8iG0zbGX4VDx2y2
🔍 Searching Firestore for user with phone: +919148101698
   - Deleting document: driver_abc123 (type: driver)
✅ Deleted 1 document(s) from Firestore

═══════════════════════════════════════════════════════════
📊 DELETION SUMMARY
═══════════════════════════════════════════════════════════

✅ Successfully deleted: 2 user(s)
ℹ️  Not found: 0 user(s)
❌ Errors: 0 user(s)

🎉 Cleanup complete! You can now test signup flows again.
```

## 🔗 Related Scripts

- `npm run setup-admin-user` - Create admin user
- `npm run verify:deployment` - Verify backend setup
- `npm run validate:config` - Validate environment variables

