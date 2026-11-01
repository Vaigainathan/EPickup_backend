# B-RELEASE-FIX-1 — Staging payment timer (no code change)

## What runs in the backend process

[`marketplacePaymentTimeoutJob`](../../src/services/marketplacePaymentTimeoutJob.js) is started from [`server.js`](../../src/server.js) on boot (`node-cron`, **every minute**).

Mode is controlled by Firestore **`appSettings/marketplace.MARKETPLACE_ENFORCEMENT.newStatuses`** (cached ~60s via [`orderStateMachine.getMarketplaceEnforcement`](../../src/services/marketplace/orderStateMachine.js)).

Default in repo [`marketplaceDefaults.js`](../../src/config/marketplaceDefaults.js): **`newStatuses: false`**.

## Legacy mode (`newStatuses: false`)

- Expires orders where `payment.status` is **`pending`** or **`initiated`** and `createdAt` is older than **`PAYMENT_TIMEOUT_MS`** on `appSettings/marketplace` (default **900000 ms = 15 minutes** if the settings doc exists).
- If `PAYMENT_TIMEOUT_MS` is missing/invalid, the job **skips** each tick (warn log).
- **`customer_claimed` / UTR-submitted orders are not expired** by this legacy query.

## New mode (`newStatuses: true`) — required for UTR flows to terminate

While `orderStatus === awaiting_payment` and the payment window is open:

| Elapsed (from `window.start`) | Action |
|-------------------------------|--------|
| 3 min, no `customerUtr` | Customer UTR nudge |
| 5 / 10 min | Shop **`PAYMENT_REMINDER`** (`reminder_sent` event) |
| `window.end` | If UTR present → `payment_review`; else → `payment_unconfirmed` / `expired` |

Additional lanes (same cron): short **balance** `dueBy`, **`paidCheck`** escalation (24h default), **`payment_unconfirmed`** auto-close (24h default), open **payment_review** escalation (24h default).

## Release day on staging (operator checklist)

1. **Dry run** enforcement (no writes until `--apply` if your script supports it):

   ```bash
   node scripts/support/set-marketplace-enforcement.js
   ```

   Review planned diff for `MARKETPLACE_ENFORCEMENT.newStatuses`.

2. **Apply** on staging only when ready:

   ```bash
   node scripts/support/set-marketplace-enforcement.js --apply
   ```

   (Use the exact flags documented in that script.)

3. Confirm **`appSettings/marketplace`** has valid **`PAYMENT_TIMEOUT_MS`** if any legacy `pending`/`initiated` orders still exist.

4. Ensure marketplace orders created on staging include **`window.start` / `window.end`** (normal create flow).

5. Optional manual tick (does **not** replace server cron):

   ```bash
   node scripts/support/run-mp17-jobs.js --slow-tick --now <ISO>
   ```

## Production

**No default flip in this release.** Production keeps `newStatuses: false` until product explicitly changes Firestore settings using the same dry-run → apply process.
