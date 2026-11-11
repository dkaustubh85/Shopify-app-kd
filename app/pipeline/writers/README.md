# Shopify writers

The durable writer is implemented in app/services/jobs.server.ts using the GraphQL operations in graphql.server.ts. It selects batches of at most 250 rows, or stages JSONL through Shopify Bulk Operations above 5,000 eligible rows. Both paths consume the same immutable WriteBatch requests and per-row snapshots. Action plugins declare their mutation in pipeline/actions/index.ts. New source adapters and parsers do not need writer changes.
