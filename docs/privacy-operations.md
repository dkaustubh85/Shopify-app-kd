# Privacy operations: required before public launch

The authenticated /webhooks/privacy endpoint verifies Shopify signatures through the SDK. Invalid signatures are rejected before any database change. SHOP_REDACT deletes shop sessions, jobs and write batches, uploads and source bytes/rows, templates, cache, guide state, and settings. Event deduplication retains only a hashed event identifier and timestamp.

Customer data/access and redaction events are recorded as Job type privacy, status awaiting_review, with a 30-day due date. They are not inventory jobs and the worker does not execute them. A successful webhook response means receipt, not fulfilment.

kaustubh is the responsible operator and has accepted daily manual queue review at dkaustubh85@gmail.com. Review the queue daily and act before its due date; the procedure below does not depend on unconfigured email alerts.

For each customer request: verify the authenticated shop and request identity; review merchant-supplied workbooks, source rows, staff metadata, logs and backups for relevant data; securely provide any access response to the merchant or remove the applicable data. Do not destroy unrelated inventory audit records without assessment. Record completion and erase the request's personal payload when no longer needed. Apply the configured backup-retention policy and prevent redacted data being restored into service.

The app does not query Shopify Customers or Orders APIs, but arbitrary spreadsheet columns can contain personal data. Never falsely respond that no data exists without reviewing uploads. Do not log raw webhook payloads or tokens.

Operator and support contact are confirmed. The public notice is maintained in public/privacy.html. Provider retention and restore procedures are documented below.

Reference: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance

## Assigned operation — November 11, 2026

Owner kaustubh explicitly accepted daily queue review and fulfilment at dkaustubh85@gmail.com. The daily manual review is the launch procedure; automatic email alerts are not configured. Do not claim Settings sends alerts.

Each day open the StockSheet web service in Render, choose Shell, and run `node scripts/privacy-queue.mjs`. This reads the private database through the service's existing DATABASE_URL, prints pending IDs/shop/topic/due dates but not customer payloads, and does not mutate data. Keep the database's external network allowlist closed. The hosted MCP query tool cannot reach this private database.

For each listed job, use the authorized Render shell/database connection to inspect its request payload privately. Work with the authenticated merchant to inspect original workbooks (all sheets), parsed rows and relevant support data. Do not declare that no data exists based only on the lack of Customers API scopes. Fulfil access/deletion before dueAt. Once fulfilled, replace the job payload with topic, receivedAt, dueAt, completedAt and a minimal non-personal resolution summary; set status to completed in a transaction. Never mark complete before actually fulfilling the request. Do not paste customer payloads into public issues or logs.

Retain a restricted deletion ledger outside any database being restored, containing only the identifiers needed to reapply deletions and completion dates. Keep it until the recoverable backup window has elapsed, then remove unnecessary identifiers. Restore into an isolated database, reconcile the ledger and all shop/customer redactions since the restore point, verify deletions and only then reconnect web and worker. Do not create or download long-lived database exports without an explicit retention schedule.

Render paid database PITR: three days on Hobby, seven on Pro+; generated logical backups expire after seven days. Standard service log retention: seven days Hobby, fourteen Pro, thirty Scale/Enterprise. Public notice describes those provider limits without claiming an unverified workspace plan. Sources: https://render.com/docs/postgresql-backups and https://render.com/docs/logging. Current published notice source: public/privacy.html.

