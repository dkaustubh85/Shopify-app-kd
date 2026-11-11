# Privacy operations: required before public launch

The authenticated /webhooks/privacy endpoint verifies Shopify signatures through the SDK. Invalid signatures are rejected before any database change. SHOP_REDACT deletes shop sessions, jobs and write batches, uploads and source bytes/rows, templates, cache, guide state, and settings. Event deduplication retains only a hashed event identifier and timestamp.

Customer data/access and redaction events are recorded as Job type privacy, status awaiting_review, with a 30-day due date. They are not inventory jobs and the worker does not execute them. A successful webhook response means receipt, not fulfilment.

Before launch assign a responsible operator and connect operational alerts for pending privacy jobs. Review this queue daily and act before its due date. Do not publish until that process and a valid support contact exist.

For each customer request: verify the authenticated shop and request identity; review merchant-supplied workbooks, source rows, staff metadata, logs and backups for relevant data; securely provide any access response to the merchant or remove the applicable data. Do not destroy unrelated inventory audit records without assessment. Record completion and erase the request's personal payload when no longer needed. Apply the configured backup-retention policy and prevent redacted data being restored into service.

The app does not query Shopify Customers or Orders APIs, but arbitrary spreadsheet columns can contain personal data. Never falsely respond that no data exists without reviewing uploads. Do not log raw webhook payloads or tokens.

Retention periods, the legal business identity, support email, backup policy, and the published privacy notice still require owner input. This file describes operations, not a completed legal policy.

Reference: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
