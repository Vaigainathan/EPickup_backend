# Marketplace build rules

Read this file before editing marketplace order, payment, refund, or stock code.

1. Re-read the order (and any product or refund docs you will change) inside the transaction. Do not trust a snapshot taken before `runTransaction`.
2. Do not put `FieldValue.serverTimestamp()` inside an array element. Array elements use plain values or `Timestamp.now()`. Document fields may use `serverTimestamp()`.
3. Compare a simulated clock only when the caller passed one in. Do not write that clock back as the stored time.
4. Create refunds only through `createRefund`. Treat an order as having an open refund when `hasOpenRefund` is true.
5. An order that is still active keeps `payment.status` `confirmed`. `createRefund` sets `payment.status` to `refund_pending` only when the resulting order status is `cancelled`.
6. A cancel that closes the order writes `cancellation.reason`, `cancellation.cancelledAt`, `cancellation.cancelledBy`, and `closedReason` as the same reason string. Shop `cancelOrder` is the exception: `cancellation.reason` and `closedReason` are `shop_cancelled`, and the shop's text is `cancellation.shopReason`.
7. When money has arrived, store `payment.receivedAmount` and `payment.receivedAmountPaise`.
8. Every new fact about an order is an event with an actor. Unknown event types throw before a write.
9. Push data carries ids only: `type`, `orderId`, `displayId`, `shopName`, `action`. Do not put amounts, UTR, UPI, notes, or evidence in the data payload.
10. Customer responses omit review internals, notes, evidence, and storage paths. Shop responses never add UPI, notes, evidence, or a new OTP field. Do not widen `presentOrder` past the fields a step explicitly adds.
11. Clients never write `marketplaceOrders`. Firestore rules stay server-only for those writes.
12. Staging scripts call `assertStagingEnv`, dry-run by default, and write only with `--apply`. `--show` is read-only and never prints UPI, a full UTR, notes, or evidence paths.
13. Do not query `collectionGroup('refunds')`. Read `marketplaceOrders/{orderId}/refunds`.
