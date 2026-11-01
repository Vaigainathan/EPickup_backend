# B-RELEASE-FIX-1 — Build review report

Branch: **batch-2**

## Commits

| Commit | Scope |
|--------|--------|
| `5df4946` | **Item 7** — `diagnose-push.js` + lib + tests (read-only) |
| *(this commit)* | Items **1–5**, **6** doc, **9** notes |

## Item 7 — Run now (owner)

```bash
node scripts/support/diagnose-push.js
```

- Staging guard: `FIREBASE_PROJECT_ID=epickup-app-staging`, staging service account, non-production backend URL.
- **No writes.** JSON report to stdout.
- **Item 8** (registration fixes): wait for this output.

## Item 1 — Driver active statuses + `photo_captured`

| Change | File |
|--------|------|
| `DRIVER_GET_ACTIVE_BOOKING_STATUSES` constant | [`src/constants/bookingStatuses.js`](src/constants/bookingStatuses.js) |
| GET active + offline guards + available list | [`src/routes/driver.js`](src/routes/driver.js) |
| WebSocket offline guard | [`src/services/websocketEventHandler.js`](src/services/websocketEventHandler.js) |
| Support script list | [`scripts/support/lib/releaseStuckDriverActions.js`](scripts/support/lib/releaseStuckDriverActions.js) |

**Compat:** Driver 82 sees active trip during `photo_captured`; JSON shape unchanged except optional `data.selfHealed`.

## Item 2 — Admin DELETE guard

Active = status **not** in `completed` | `cancelled` | `rejected` → **409 `BOOKING_ACTIVE`**.

**Compat:** Admin must cancel/intervene; finished deletes unchanged.

## Item 3 — Self-heal on GET active

[`src/services/driverOrphanReleaseService.js`](src/services/driverOrphanReleaseService.js) reuses release-stuck-driver plan/apply; **does not set `isOnline`**.

**Compat:** Additive `data.selfHealed: true` when heal runs.

## Item 4 — Push channels + shop burst (fail-open)

| Module | Role |
|--------|------|
| [`src/constants/pushChannels.js`](src/constants/pushChannels.js) | channelId + sound by role/template |
| [`src/services/shopRingBurstCooldown.js`](src/services/shopRingBurstCooldown.js) | In-memory 60s ring map; notifications query backup in try/catch |
| [`src/services/notificationService.js`](src/services/notificationService.js) | Template sends use delivery options |

**Fallback (old apps):** Unknown Android channelId → OS **default channel**; notification still shown. iOS ignores channelId. FCM fallback still uses `epickup_notifications`.

**Compat:** No API contract change; apps may create new channels to get correct sound/priority.

## Item 5 — Push delivery

| Behavior | Detail |
|----------|--------|
| Failed Expo tickets | Log **`userId`**, **`notificationType`**, error details |
| Receipts | [`expoPushReceiptQueue.js`](src/services/expoPushReceiptQueue.js) — **~15 min** after send (`RECEIPT_DELAY_MS`) |
| Token clear | **`expoPushToken` cleared only on `DeviceNotRegistered`** |
| InvalidCredentials | **Logged error; token not cleared** |
| Admin shop detail | **`pushRegistered`**, **`pushMissing`** booleans on [`adminShopService.getShopDetail`](src/services/admin/adminShopService.js) |

## Item 6 — Staging payment timer

Doc only: [`docs/B-RELEASE-FIX-1-staging-payment-timer.md`](docs/B-RELEASE-FIX-1-staging-payment-timer.md). Flip `newStatuses` on release day via `set-marketplace-enforcement.js` dry run first.

## Item 9 — Rate limits (no code change)

| Endpoint | Limiters | Window / max | Key |
|----------|----------|--------------|-----|
| `GET /api/shop/orders`, `GET /api/shop/orders/:id` | `generalLimiter` + `speedLimiter` (global) | 2000 / 15 min IP; slowdown after 2000 successes | IP |
| Customer marketplace list/detail | `listLimiter` / `detailLimiter` | 60 / 120 per min | **user uid** |
| Driver `GET /bookings/active` | global only | same | IP |

**15–20 s polling:** ~4 req/min per endpoint → **no 429** under current limits. No change proposed.

## Tests added/updated

- `tests/diagnosePush.test.js`
- `tests/pushChannels.test.js`
- `tests/releaseStuckDriver.test.js` (`photo_captured` in expected list)

## Item 8 — Deferred

Push registration path fixes after `diagnose-push.js` output (dual `originalFirebaseUID`, broken `/api/notifications/fcm/token`, etc.).
