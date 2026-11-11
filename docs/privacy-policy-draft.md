# StockSheet privacy notice - owner review draft

Not yet published. Confirm the operator identity, backup retention and privacy-request ownership before making this the public policy.

StockSheet helps merchants update Shopify inventory using spreadsheets. Contact: dkaustubh85@gmail.com.

Data used: shop domain and settings; Shopify authorization credentials; product and variant identifiers, prices and inventory quantities; original uploaded spreadsheets and parsed rows; update/undo audit records; staff identifiers and guide progress; privacy request details supplied by Shopify.

Purpose: authenticate the store, match spreadsheet rows, preview and apply requested updates, support safe quantity undo, export inventory, recover uploaded files from History, and handle support/privacy requests. Only the first worksheet is processed for updates, but the original uploaded file is retained intact for downloads. Merchants should upload inventory data only, without customer personal information.

Infrastructure: Shopify provides authentication and APIs. Production hosting is planned on Render with PostgreSQL. No production customer uploads have been sent to Higgsfield; explainer-video assets should use demo data only.

Retention: active upload originals and audit records remain available while the app is installed unless removed through a handled privacy request. Authenticated Shopify shop-redaction events remove the shop's active database records and original files. Backups, request-completion records and operational logs need a documented retention period and restoration process before launch.

Requests: merchants can contact the support email for access/deletion questions. Shopify customer privacy events are recorded with a 30-day due date and require operator review of merchant-supplied files. The operator must fulfil requests and remove unnecessary request payloads; acknowledgement of the webhook does not mean the request is completed.

Owner release checklist: identify the legal operator; assign request handling and alerting; confirm backup/log retention and restore suppression; review applicable legal requirements; publish the completed notice at a stable HTTPS URL and include it in the Shopify listing.
