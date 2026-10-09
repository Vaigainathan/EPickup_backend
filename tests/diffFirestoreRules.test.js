const { marketplaceRulesDiff } = require('../scripts/firestoreRulesSource');

const OUTSIDE = 'service cloud.firestore {\n  match /databases/{database}/documents {\n    match /users/{userId} {\n      allow read: if false;\n    }\n\n    ';
const AFTER = '// Default rule - deny all other access\n    match /{document=**} {\n      allow read, write: if false;\n    }\n  }\n}\n';
const OLD_BLOCK = `// Marketplace orders — shop/customer/admin reads.
    match /marketplaceOrders/{orderId} {
      allow read: if isAuthenticated() && (
        isOwner(resource.data.shopId) ||
        isOwner(resource.data.customerId) ||
        isAdmin()
      );
    }

    `;
const NEW_BLOCK = `// Marketplace orders — admin reads the order and refunds.
    match /marketplaceOrders/{orderId} {
      allow read: if isAuthenticated() && isAdmin();
      match /signal/{docId} {
        allow read: if isAuthenticated() && isOwner(resource.data.customerId);
      }
    }

    `;

describe('marketplaceRulesDiff', () => {
  test('a marketplaceOrders-only change is allowed', () => {
    const deployed = `${OUTSIDE}${OLD_BLOCK}${AFTER}`;
    const local = `${OUTSIDE}${NEW_BLOCK}${AFTER}`;
    expect(marketplaceRulesDiff(deployed, local)).toEqual({ ok: true, blockChanged: true });
  });

  test('an identical file is allowed', () => {
    const local = `${OUTSIDE}${NEW_BLOCK}${AFTER}`;
    expect(marketplaceRulesDiff(local, local)).toEqual({ ok: true, blockChanged: false });
  });

  test('a change outside marketplaceOrders is refused', () => {
    const deployed = `${OUTSIDE}${OLD_BLOCK}${AFTER}`;
    const local = `${OUTSIDE.replace('allow read: if false;', 'allow read: if true;')}${NEW_BLOCK}${AFTER}`;
    const verdict = marketplaceRulesDiff(deployed, local);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/outside marketplaceOrders/);
  });
});
