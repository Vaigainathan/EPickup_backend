# MP-16 staging verification (manual)

Locked pair: customer `Ue51a7afbc981f1b92cf30be32ab`, shop `b7302f5d6343c1641d63811306eb`.

Replace `PRODUCT` with a live product id at the staging shop.

## (a) Completed order → receipt PDF → cleanup

```text
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --items PRODUCT:1 --apply
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --utr 310000000213 --order ORDER --apply
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --confirm --order ORDER --apply
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --mark-ready --order ORDER --apply
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --sync-booking --order ORDER --booking-status delivered --apply
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --handover --order ORDER --apply
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --receipt tmp\receipt-shop.pdf --order ORDER
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --payment-details --order ORDER
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --cleanup --order ORDER --apply
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --set-stock 10 --product PRODUCT --apply
```

Restore Vaigzz `orderCount` on `shops/b7302f5d6343c1641d63811306eb` if sync incremented it.

## (b) Restrict → create blocked → unrestrict (snapshot restore)

```text
node scripts/support/restrict-customer.js --customer Ue51a7afbc981f1b92cf30be32ab --reason test --operator vaig --apply
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --items PRODUCT:1 --apply
REM expect create failure / ACCOUNT_RESTRICTED from API
node scripts/support/unrestrict-customer.js --customer Ue51a7afbc981f1b92cf30be32ab --apply
```

Snapshot doc: Firestore `users/{customerId}/private/marketplaceRestrictionSnapshot` (same as restrict/unrestrict API).

## (c) Cancel after UTR → resolve-paid-check → cleanup

```text
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --items PRODUCT:1 --apply
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --utr 310000000214 --order ORDER --apply
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --cancel --order ORDER --apply
node scripts/support/resolve-paid-check.js --order ORDER --outcome received --operator vaig
node scripts/support/resolve-paid-check.js --order ORDER --outcome received --operator vaig --apply
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --show --order ORDER
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb --cleanup --order ORDER --apply
```

`suspend-shop.js` is dry-run by default; do not run `--apply` on Vaigzz unless intentionally testing shop deactivation (`--undo --apply` reactivates).
