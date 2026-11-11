# Render deployment preparation

The user selected a public Shopify App Store launch, free initially, and Render hosting. Nothing has been deployed or billed.

The Blueprint defines a Docker web service, a worker, and private PostgreSQL. Review the current cost in Render before creating these paid resources. The worker uses Render private networking and a generated shared secret. The web service runs migrations before starting; /health checks database readiness. DATABASE_PROVIDER selects the PostgreSQL client at Docker build time as well as runtime.

1. Connect Render and put this project in a repository you control. The current Git origin is Shopify's upstream template; do not push app code there. Keep secrets, SQLite databases and .shopify excluded.
2. Create a Blueprint from render.yaml. This file assumes the stocksheet directory is the repository root. If your repository contains that folder, adjust Docker context and paths accordingly.
3. Supply SHOPIFY_API_KEY and SHOPIFY_API_SECRET through Render's secret settings. Set SHOPIFY_APP_URL to the actual HTTPS service URL, then redeploy. Do not put credentials in YAML or Git.
4. Verify PostgreSQL migrations, /health, worker execution, signed webhooks, embedded authentication, and a complete dev-store upload/apply/undo against the deployed service.
5. Set application_url and auth.redirect_urls to the production origin in shopify.app.toml. Keep the development preview separate. Run Shopify configuration validation before deploying configuration.
6. Complete the release blockers in verification.md and app-store-review.md, set the listing to free, upload the icon and real screenshots, and submit for Shopify review. Configuration deployment alone does not publish an approved public listing.

Docker and live PostgreSQL have not been executed on this machine. Backups, restore testing, privacy retention, support identity and production monitoring must be configured before release.

References: https://render.com/docs/blueprint-spec and https://render.com/docs/docker
