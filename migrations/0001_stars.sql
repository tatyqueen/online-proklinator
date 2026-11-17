CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, telegram_user_id TEXT NOT NULL, service_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', invoice_payload TEXT NOT NULL, telegram_payment_charge_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, paid_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS payments_payload_unique ON payments(invoice_payload);
CREATE UNIQUE INDEX IF NOT EXISTS payments_charge_unique ON payments(telegram_payment_charge_id) WHERE telegram_payment_charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_user_created ON payments(telegram_user_id,created_at);
CREATE TABLE IF NOT EXISTS order_details (invoice_payload TEXT PRIMARY KEY REFERENCES payments(invoice_payload), telegram_user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_json TEXT NOT NULL, result_json TEXT NOT NULL, invoice_url TEXT, expires_at INTEGER NOT NULL, precheckout_id TEXT, UNIQUE(telegram_user_id,idempotency_key));
CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_events (update_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, outcome TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS support_requests (update_id INTEGER PRIMARY KEY, telegram_user_id TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
