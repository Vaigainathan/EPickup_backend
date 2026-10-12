# MP-15 staging verification (manual)

Locked pair only (`marketplaceStagingActions.js`): customer `Ue51a7afbc981f1b92cf30be32ab`, shop `b7302f5d6343c1641d63811306eb`.

Base (dry run unless `--apply`):

```text
node scripts/support/test-marketplace-create.js --customer Ue51a7afbc981f1b92cf30be32ab --shop b7302f5d6343c1641d63811306eb
```

Full help path (replace `ORDER`, `TICKET`, `EVID`, `PRODUCT`):

1. Create: `--items PRODUCT:1 --apply` → note `orderId`
2. `--utr 310000000212 --order ORDER --apply`
3. `--confirm --order ORDER --apply`
4. `--mark-ready --order ORDER --apply`
5. `--sync-booking --order ORDER --booking-status delivered --apply`
6. `--handover --order ORDER --apply`
7. `--help-evidence path/to.jpg --order ORDER --apply` → `evidenceId`
8. `--help-submit --order ORDER --problem damaged --evidence-ids EVID --description "Damaged item" --apply`
9. `node scripts/support/resolve-help.js --ticket TICKET --status reviewing --operator vaig --apply`
10. `node scripts/support/resolve-help.js --ticket TICKET --status resolved --outcome refund --amount 100 --operator vaig --apply`
11. `--show --order ORDER`
12. `--help-cleanup --order ORDER --apply`
13. `--cleanup --order ORDER --apply`
14. `--set-stock 10 --product PRODUCT --apply` (Controller stock)
15. Restore Vaigzz `orderCount` on `shops/b7302f5d6343c1641d63811306eb` if sync incremented it

Deploy **firestore.rules** (marketplace_order tickets API-only for clients).
