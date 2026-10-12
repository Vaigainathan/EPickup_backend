# Phase 6 production runbook (marketplace migrations + cutovers)

One-time data steps and env cutovers for production (`epickup-app`). Staging rehearsal uses the same commands with staging `.env` (no `--confirm-production`).

**Guards:** Migration scripts refuse the wrong Firebase project. Production writes require `FIREBASE_PROJECT_ID=epickup-app`, production service account credentials, and `--confirm-production`.

**Deploy Firebase config:** Always use [`scripts/deploy-firebase-config.js`](../scripts/deploy-firebase-config.js) or [`scripts/deploy-firebase-indexes.js`](../scripts/deploy-firebase-indexes.js) with `--project` (never bare `firebase deploy`).

---

## Staging vs production cutover

| | Staging | Production |
|---|---------|------------|
| Pool / parcel filter | Often already ON for testing | Start with `FEATURE_ORDER_NUMBER_POOL=false` and `FEATURE_PARCEL_SOURCE_FILTER=false` |
| M3 | Run with pool on or off (low traffic) | **Pool OFF → M3 `--apply` → turn pool ON within minutes → M3 dry-run again** |
| O15 | Review duplicate report every M3 dry-run | Any duplicate after pool ON → **stop** and investigate |

---

## Ordered checklist

### 0. Pre-deploy

- [ ] Backend release (MP-18+) deployed with switches **off**: `FEATURE_ORDER_NUMBER_POOL=false`, `FEATURE_PARCEL_SOURCE_FILTER=false`, `MARKETPLACE_ENFORCEMENT.newStatuses=false`, `utrBlocksReject=false`.
- [ ] Shop App (S1–S13) and Customer App builds ready; Noto font shipped for PDF receipts on the server image.

### 1. M6 — Indexes and rules

```bash
node scripts/deploy-firebase-config.js --project epickup-app-staging
# Review Firestore rules diff; then:
node scripts/deploy-firebase-config.js --project epickup-app-staging --apply --accept-diff
```

Production:

```bash
node scripts/deploy-firebase-config.js --project epickup-app
node scripts/deploy-firebase-config.js --project epickup-app --confirm-production --apply --accept-diff
```

- [ ] Wait until new composite indexes show **Enabled** in Firebase console.

### 2. M4 — Seed `appSettings/marketplace`

```bash
node scripts/seed-marketplace-settings.js
node scripts/seed-marketplace-settings.js --apply
# Production: add --confirm-production --apply
```

- [ ] Dry-run shows only missing keys; `PAYMENT_TIMEOUT_MS` remains **held** (not written).

### 3. M2 — Backfill `bookings.sourceType`

```bash
node scripts/backfill-booking-sourcetype.js
node scripts/backfill-booking-sourcetype.js --apply
```

- [ ] `missing: 0` after apply (or resume with `--start-after <id> --limit <n>`).
- [ ] No unexpected `other` sourceType values.

### 4. M3 — Register legacy display IDs (pool **off** on production)

```bash
node scripts/register-order-numbers.js
node scripts/register-order-numbers.js --apply
```

- [ ] `duplicateGroups: 0` and `conflicts: []` (O15). If not, **do not** enable the pool.
- [ ] After `--apply`, `legacyRegisteredOnCounter` is set on `system_counters/order_number_pool`.
- [ ] Resume: `--start-after <docId>` or `--phase marketplaceOrders --start-after <orderId>`.

### 5. SEC-7 — Order signal backfill

```bash
node scripts/support/backfill-order-signals.js
node scripts/support/backfill-order-signals.js --apply
```

Production all customers:

```bash
node scripts/support/backfill-order-signals.js --all-customers --confirm-production --apply
```

### 6. M-B90 — Handover OTP to `private/handover`

```bash
node scripts/migrate-handover-otp.js
node scripts/migrate-handover-otp.js --apply
```

- [ ] Note dry-run `wouldCopy` / `legacyOnDoc`.
- [ ] After shop handover smoke tests: `node scripts/migrate-handover-otp.js --apply --strip-legacy` (optional second pass).

### 7. M9 — Verified shop UPI names

Per shop (manual):

```bash
node scripts/support/verify-shop-upi.js --shop <id> --name "<as in UPI app>" --apply
node scripts/support/approve-shop.js --shop <id> --apply
```

- [ ] Every production shop that should take orders has verified UPI name.

### 8. C-B — Order number pool (production window)

**Low-traffic window.**

1. Confirm `FEATURE_ORDER_NUMBER_POOL=false`.
2. `node scripts/register-order-numbers.js --apply --confirm-production` (if not done).
3. Set `FEATURE_ORDER_NUMBER_POOL=true` on Railway **within minutes**.
4. Immediately: `node scripts/register-order-numbers.js --confirm-production` (dry-run).
5. [ ] `duplicateGroups: 0` — if any duplicate, **stop** and report.

Staging: pool may already be on; still run M3 dry-run after rehearsal apply.

### 9. C-A — Parcel source filter

Only after M2 verified and parcel booking indexes enabled:

1. Set `FEATURE_PARCEL_SOURCE_FILTER=true`.
2. [ ] `GET /api/customer/bookings`, `/pending-booking`, `/active-booking` return only `sourceType == 'parcel'`.
3. [ ] Marketplace-linked bookings still reachable via marketplace APIs.

### 10. Enforcement switches (last)

1. `MARKETPLACE_ENFORCEMENT.newStatuses=true`
2. `MARKETPLACE_ENFORCEMENT.utrBlocksReject=true` when ready
3. [ ] Shop App testers → broader rollout per blueprint §19.

---

## Staging rehearsal (dry-runs first)

Run from repo root with staging `.env`:

```bash
node scripts/deploy-firebase-config.js --project epickup-app-staging
node scripts/seed-marketplace-settings.js
node scripts/backfill-booking-sourcetype.js
node scripts/register-order-numbers.js
node scripts/support/backfill-order-signals.js
node scripts/migrate-handover-otp.js
```

Then apply each step you are comfortable with (`--apply` only on staging). Re-run `register-order-numbers.js` dry after apply. Smoke: support scripts, `run-mp17-jobs.js`, parcel + marketplace flows.

---

## Verification quick reference

| Step | Pass condition |
|------|----------------|
| M2 | `missing: 0` |
| M3 | `toCreate: 0` on re-run dry; no O15 duplicates |
| M-B90 | `wouldCopy: 0` after apply; handover API works |
| Pool monitor | `(totalAllocated + legacyRegistered) / 90000` below alert threshold |
| C-A | Parcel lists exclude `sourceType: marketplace` |

---

## Rollback notes

- M2/M3/M4/M-B90 only add or move fields; revert code/env flags without deleting data if needed.
- Wrong `orderNumbers` registry doc: delete specific `orderNumbers/{n}` only after support review; re-run M3.
- Pool OFF stops new pool allocations; legacy `displayIdService` path remains when `FEATURE_ORDER_NUMBER_POOL=false`.
