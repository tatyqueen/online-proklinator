# Telegram Stars checkout

## Update: personal archive and bot (2026-11-17.2)

The lower navigation now has «Покупки». Its authenticated `/api/account` summary and cursor-paginated `/api/orders` history are always scoped to the validated Telegram ID. Paid documents open in the archive; a deep link contains only an order ID and never bypasses authentication.

New checkout requests require three active acknowledgements: service rules, data notice, and entertainment-only nature. The server validates the current notice versions and records them with the owner, order and timestamp in `order_consents`. These are acknowledgements of `notice.html`, **not a claim of complete legal compliance or a finalized offer/privacy policy**. Existing invoices from the previous release are not falsely recorded as accepted retroactively.

Apply `migrations/0002_purchases_bot.sql` before deploying this release. Receipt and command messages use `bot_outbox`; see `BOT.md` for delivery limitations and support operations. Tests now cover 26 cases, including acknowledgements, bot ownership checks, receipt retries and pagination.

The storefront is GitHub Pages. `worker.js` runs as `proklinator-api` with the existing encrypted `BOT_TOKEN` secret and D1 `DB` binding. Never place BOT_TOKEN in GitHub, browser code, URLs opened in a browser, logs, or chat.

## Trust boundaries

- Authenticate each private request with `Authorization: tma <Telegram.WebApp.initData>`. HMAC-SHA256, maximum age one hour, future tolerance 30 seconds, duplicate parameter rejection. `initDataUnsafe` never authorizes server operations.
- The server catalog is authoritative: poison 19, ex 39, court 69, wifi 19, excel 29 XTR. Other prototype services remain unavailable for sale.
- Create a pending D1 order before requesting `createInvoiceLink`. Exactly one price, XTR, empty provider token, opaque random payload. One user/key identifies one immutable purchase intent. Limit ten new orders per user per hour.
- The webhook header secret is a domain-separated HMAC of BOT_TOKEN and the fixed webhook URL (see `webhookSecret`). It is never returned to the browser or stored in public code. Rotating BOT_TOKEN requires registering the newly derived webhook secret again.
- Pre-checkout verifies user, currency, amount, pending status and 15-minute expiry. A database compare-and-set reserves each invoice for one pre-checkout query. Repeated delivery of that query is accepted; a different query cannot reuse it.
- Successful payment validates user, payload, currency, amount and pre-checkout reservation. Atomic D1 writes and unique payload/charge indexes prevent duplicate fulfilment. Late success is accepted even after invoice expiry. Storage failures return 503 for Telegram retry. Bad payment events are recorded for investigation without granting access.
- Paid results live in D1 and are returned only to their authenticated owner after successful_payment. Client invoice callbacks only start a server check. Refund updates revoke future retrieval; previously downloaded files cannot be recalled.
- Exact CORS origin is `https://tatyqueen.github.io`; CORS cannot distinguish repositories on the same origin and is not authentication. Requests without Origin still require initData. No cookies or wildcard origin.
- Names and reasons are bound SQL parameters and escaped before rendering. Checkout stores only the pseudonym/situation, reason, user ID and payment/receipt metadata required for fulfilment. Do not submit other people's private information.

## Routes

| Route | Purpose |
|---|---|
| GET / | Version and liveness; never proof of a real payment |
| GET /api/catalog | Public server prices |
| POST /api/checkout | Authenticated intent; requires Idempotency-Key |
| GET /api/orders | Owner's latest 50 purchases, without result bodies |
| GET /api/orders/:orderId | Owner's status and paid result |
| POST /telegram/webhook | Secret-authenticated Telegram updates |

## Operations

Run `node --test tests/*.test.js` with Node 24. Tests use SQLite and a fake Telegram transport, not real Stars. GitHub Actions runs the same checks.

Apply `migrations/0001_stars.sql` to proklinator-db once (idempotent; no existing rows are deleted). Keep DB and BOT_TOKEN attached when publishing. Register the exact URL `https://proklinator-api.tanushaaim.workers.dev/telegram/webhook` using Telegram `setWebhook` with the derived secret, `allowed_updates: ["message", "pre_checkout_query"]` and `drop_pending_updates: false`. Verify `getWebhookInfo`, then set `app_config.checkout_enabled` to `1`. A temporary protected provisioning build may perform these steps; the final production worker has no provisioning endpoint.

Disable new purchases with:

```sql
UPDATE app_config SET value='0' WHERE key='checkout_enabled';
```

This does not block previously issued invoices or incoming receipts. For a full pause, pre-checkout must also be disabled deliberately; continue accepting success/refund updates to preserve accounting.

The bot handles `/start`, `/help`, and `/paysupport`. A support command stores a ticket in D1 and acknowledges it. The owner must regularly check Cloudflare → D1 → proklinator-db → Console:

```sql
SELECT update_id, telegram_user_id, message, status, created_at
FROM support_requests WHERE status='open' ORDER BY created_at;
SELECT update_id, kind, outcome, created_at
FROM payment_events WHERE outcome IN ('rejected','conflict') ORDER BY created_at DESC;
SELECT id, service_id, amount, status, created_at, paid_at
FROM payments ORDER BY id DESC LIMIT 20;
```

No automated refund is initiated. An operator must review the request and use Telegram `refundStarPayment` with the original user and charge ID, keeping BOT_TOKEN private.

## Real acceptance test — performed by the owner

1. Open the app through @portalvdarkside_bot, select one 19-Star service, use fictional test text, and confirm the Telegram invoice yourself.
2. Confirm that the app displays the result after the server receives the payment. Closing the invoice alone is insufficient.
3. In D1 verify one `paid` row, amount 19, a non-empty Telegram charge ID and paid_at. Do not share the full charge ID publicly.
4. Close/reopen the app → «Мои покупки» → reopen the same result, without paying again.
5. Check that cancellation does not produce a paid result and there are no rejected/conflicting payment events.

Real payment success must not be claimed until these checks have actually been observed.

Sources: [Mini App validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app), [Telegram Bot API](https://core.telegram.org/bots/api#createinvoicelink), [Stars payments](https://core.telegram.org/bots/payments-stars), [D1 transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
