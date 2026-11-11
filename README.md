# StockSheet

An embedded Shopify app for bulk inventory changes from Excel or CSV. Migrated from Shopify's Remix template to React Router 7.18.5 and Shopify's React Router SDK 4.0.2, using TypeScript, Polaris React, App Bridge, Prisma, and SheetJS. Admin GraphQL API is pinned to 2026-10.

## Run locally

Requires Node 24+, npm, a Shopify developer account, and a development store. No paid services are required.

```powershell
cd C:\Users\15197\shopify\stocksheet
npm ci
Copy-Item .env.example .env
npm run setup
npm run dev -- --store kaustubhs-test-shop.myshopify.com
```

Sign in through Shopify's browser page, install the app, and open the preview URL printed by the CLI. Never put your Shopify password in this repository or chat. The linked app configuration contains its public client ID, not its secret. Shopify CLI supplies API credentials and the tunnel URL during development. On Windows, stop the dev server before regenerating Prisma: its running query-engine DLL cannot be replaced. The first authenticated installation starts a Shopify Bulk Operations inventory sync; the dashboard polls it and exposes a retry button.

For a persistent worker during development, configure WORKER_SECRET in .env, set WORKER_URL to the running app's /worker endpoint, and run npm run worker in another terminal. The upload/history screens also drain queued jobs while open. A server worker is necessary to continue work when all browser tabs are closed.

## Environment

| Variable           | Purpose                                                                         |
| ------------------ | ------------------------------------------------------------------------------- |
| SHOPIFY_API_KEY    | App client ID; supplied by Shopify CLI in development                           |
| SHOPIFY_API_SECRET | App secret; supply through hosting secrets in production                        |
| SHOPIFY_APP_URL    | Public HTTPS web-server URL; tunnel supplied by CLI in development              |
| SCOPES             | read_products,write_products,read_inventory,write_inventory,read_locations      |
| DATABASE_URL       | SQLite file URL locally, PostgreSQL connection URL in production                |
| DATABASE_PROVIDER  | sqlite (default) or postgresql                                                  |
| WORKER_SECRET      | Long random bearer secret for POST /worker                                      |
| WORKER_URL         | Queue runner target; defaults to http://127.0.0.1:3000/worker                   |
| E2E_SHOP           | Live test store; restricted to the authorized kaustubhs-test-shop.myshopify.com |
| E2E_HTTP_URL       | Optional local app origin for the complete HTTP-route end-to-end test           |
| SMOKE_URL          | Local app origin for authenticated HTTP page smoke checks                       |

Session tokens are stored only in Shopify's Prisma Session model. Access tokens are never returned to the browser. Keep .env, database files, and .shopify state private; they are excluded from Git and Docker build context.

## Merchant workflow

1. Drop an XLSX, XLS, or CSV file, up to 10 MB / 100,000 rows. Only the first worksheet is processed. Original file bytes are retained in the database so you can download the same file again from History. Do not upload customer personal information.
2. Check automatically detected columns or select a saved mapping. Save a named template for repeat uploads. SKU and barcode must be text in Excel to preserve leading zeros.
3. Choose sold out, exact quantity, adjustment, or base-price update and an active Shopify location.
4. Review matched, unmatched, unchanged, and error rows. Filter and paginate the preview. Download unmatched/error source rows as CSV.
5. Confirm the affected variant count. More than 80% of tracked store variants becoming sold out requires an extra acknowledgement.
6. Follow progress and inspect per-row results in history. Select Download original sheet to retrieve the exact uploaded file. Older uploads offer a rebuilt Excel workbook. Undo restores successful quantity snapshots only; it skips stock changed by later activity.

The dashboard shows recent uploads, cached variant count, cumulative applied rows, and variants with at least one cached location at/below the low-stock threshold. Export downloads an Excel sheet using standard or saved-template column names. Notification email is stored for future notification support; this release does not send emails.

## Routes and structure

- /app: dashboard, upload drop zone, cache sync, sample workbook.
- /app/upload: single-page upload, map, action, preview, apply, done flow.
- /app/templates: rename/delete/default mappings.
- /app/history and /app/history/:id: audit trail, staff identity, row results, undo.
- /app/export and /app/download: template-aware Excel export and CSV/sample downloads.
- /app/settings: default location/matching/threshold/email.
- /worker: bearer-protected queue endpoint; /health: database readiness.

app/pipeline/sources, parsers, matchers, and actions contain source processing and preview logic. app/services/jobs.server.ts implements durable GraphQL/bulk writers using immutable WriteBatch requests. VariantCache supports indexed identifiers and per-location cached quantities. Authenticated webhooks update inventory/tracking and enqueue paginated product refreshes. Create/update/delete product events are supported in addition to the requested webhooks.

## Safety and recovery

No inventory mutation occurs during upload or preview. Ambiguous identifiers and duplicate targets are skipped. All tenant-owned objects are looked up by shop. Audit entries use the session staff name when available and the authenticated staff ID for offline-token sessions. Snapshots and immutable request variables are committed before writes. Set, sold-out, adjustment, and undo mutations use changeFromQuantity to reject stale values and persisted Shopify idempotency keys. Jobs claim leases and resume saved batches; each shop runs one inventory job at a time.

Batches contain at most 250 variants. Above 5,000 eligible rows the writer stages JSONL and uses Shopify Bulk Operations. Results are correlated by __lineNumber, never output order. Throttling uses exponential backoff. An uncertain request older than 23 hours cannot retry automatically because Shopify's idempotency window is 24 hours. Failed/canceled bulk operations require reconciliation before retry; partial data must not be blindly replayed. Inspect the Job and WriteBatch records and compare live inventory before manually resolving an uncertain job. Do not reset its idempotency key.

Price updates record snapshots and check the current price before writing. Shopify does not offer an atomic expected-price comparison for this mutation, so a concurrent external price change can race the write. Automatic price undo is disabled. Inventory undo uses atomic quantity comparison and protects later orders/updates.

## Tests

```powershell
npm test
npm run typecheck
npm run build
npm run shopify -- app config validate --json
```

The native Node test suite uses isolated temporary SQLite databases and a mocked Shopify API. It covers CSV/XLS/XLSX, identifiers/leading zeros, matching ambiguity, all action previews, the 80% safeguard, apply/undo, lost-response retries, leases, tenant isolation, partial failures, 250-item batching, 5,001-row bulk import/result ordering, throttling, and streamed cache parsing. Test fixtures never reuse the development database.

After installing/opening the app in the authorized development store:

```powershell
npm run test:dev-store
$env:E2E_HTTP_URL = 'http://localhost:60841' # use the actual port printed by app dev
npm run test:dev-store
$env:SMOKE_URL = $env:E2E_HTTP_URL
npm run test:http
```

The live test verifies Shopify identifies the store as a development store, creates its own draft product, parses XLSX, previews, applies 7 to 0, undoes 0 to 7, verifies live stock, then deletes the fixture product. HTTP mode exercises the real multipart upload and route actions. Smoke tests validate authenticated SSR for all seven pages, Excel downloads, and worker rejection. The HTTP helper reads linked app credentials from Shopify CLI into process memory solely to sign a short-lived local test token; it never prints or persists them. The browser harness (node --env-file=.env scripts/browser-smoke.mjs) also verifies guide navigation, sample downloads, file upload, original-file downloads and all seven routes in Chrome. It simulates the Shopify host bridge; actual embedded-shell and full keyboard/accessibility QA remain manual.

npm run seed creates an isolated demo.stocksheet.local shop with sample templates, variants, and upload history. It never touches Shopify or mixes fixtures into the real store.

## Docker and deployment

Docker is prepared but was unavailable on the development machine, so image build/runtime have not been verified. Render hosting has now been selected. render.yaml and docs/render-deployment.md prepare web, worker and PostgreSQL resources; deployment has not occurred.

For a single-host SQLite installation, set production secrets in .env, update application_url and redirect_urls in shopify.app.toml, then:

```sh
docker compose up --build -d
```

Compose runs the web app and polling worker and persists SQLite on a named volume. Use HTTPS at your hosting reverse proxy; back up the volume. Do not horizontally scale SQLite web instances across hosts.

PostgreSQL has a separate portable schema and generated initial migration under prisma/postgresql. Set DATABASE_PROVIDER=postgresql and DATABASE_URL to your managed PostgreSQL connection. Build with docker build --build-arg DATABASE_PROVIDER=postgresql -t stocksheet . and provide those same variables at runtime. Adapt Compose to remove its SQLite DATABASE_URL override. PostgreSQL SQL was generated/validated, but a live PostgreSQL server was not available for integration testing. npm run setup selects the configured provider and applies its migrations. Do not apply SQLite migration files to PostgreSQL.

Shopify app deploy publishes configuration/extensions; it does not host this Node application. First deploy the container to your selected host, set secrets/HTTPS URL, and start the worker. Then run npm run deploy for Shopify configuration. Shopify may require IP/ASN allowlisting for public-app bulk operations; check the current developer-dashboard requirements before rollout.

## Release status and limits

The local app builds, migrates, and passes unit/database tests, authenticated SSR checks, and both live dev-store service and HTTP apply/undo tests. Full embedded-shell/keyboard QA, Docker execution, PostgreSQL execution, privacy-request fulfilment operations, and production hosting remain unverified/unconfigured. This is a development-store build, not an App Store submission.

The user approved migration from Remix 2 to the supported React Router 7 stack. The runtime audit now reports zero high, critical or moderate findings and three low entries from one deepmerge advisory propagated through Polaris React tokens. Polaris React remains for the existing UI; web-component migration is a future cleanup. Build-only dependencies still have advisories and are excluded from production. Review docs/security-audit.json and docs/verification.md before release.

Official references: https://github.com/Shopify/shopify-app-template-remix, https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/inventorySetQuantities, https://shopify.dev/docs/apps/build/apis/graphql-admin/implementing-idempotency, https://shopify.dev/docs/apps/build/apis/graphql-admin/bulk-operations/imports, https://shopify.dev/docs/api/shopify-cli/app/app-deploy.

## First-time help and launch assets

A six-step Getting started guide opens for each new Shopify staff user, persists progress per user and store, and can be reopened from every page. Sample, export and history downloads use authenticated fetch rather than navigating outside the embedded app.

The App Store icon is public/brand/stocksheet-icon.png (1200px PNG). See docs/branding.md, docs/video-storyboard.md and docs/render-deployment.md. Launch pricing is free; billing is not implemented. Public listing submission and video generation remain pending.
