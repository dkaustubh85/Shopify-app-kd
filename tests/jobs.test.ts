import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { Admin } from "../app/services/graphql.server.ts";

const directory = mkdtempSync(join(tmpdir(), "stocksheet-jobs-"));
process.env.DATABASE_URL =
  "file:" + join(directory, "test.db").replaceAll("\\", "/");
process.env.NODE_ENV = "test";
writeFileSync(join(directory, "test.db"), "");
execFileSync(
  process.execPath,
  [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
  { env: process.env, stdio: "pipe" },
);
const { default: db } = await import("../app/db.server.ts");
const { enqueueUpload, runJob, retryJob } =
  await import("../app/services/jobs.server.ts");
const SHOP = "tests.myshopify.com",
  OTHER = "other.myshopify.com",
  LOCATION = "loc";
type MutationCall = { query: string; variables: any };
function mockInventory(initial: Record<string, number>) {
  const stock = new Map(Object.entries(initial)),
    requests: MutationCall[] = [],
    seen = new Map<string, unknown>();
  let timeoutAfterSuccess = false;
  const admin: Admin = {
    graphql: async (query, options) => {
      const variables = options?.variables as any;
      if (query.includes("query LiveStock"))
        return Response.json({
          data: {
            nodes: variables.ids.map((id: string) => ({
              id,
              tracked: true,
              inventoryLevel: stock.has(id)
                ? {
                    quantities: [
                      { name: "available", quantity: stock.get(id) },
                    ],
                  }
                : null,
            })),
          },
        });
      if (
        query.includes("mutation SetInventory") ||
        query.includes("mutation AdjustInventory")
      ) {
        requests.push({ query, variables: structuredClone(variables) });
        const batch = await db.writeBatch.findUnique({
          where: { id: variables.idempotencyKey },
        });
        assert.ok(
          batch?.firstSentAt,
          "immutable request and send time persisted before write",
        );
        assert.deepEqual(batch.variables, variables);
        if (seen.has(variables.idempotencyKey))
          return Response.json({ data: seen.get(variables.idempotencyKey) });
        const changes = variables.input.quantities || variables.input.changes;
        const stale = changes.some(
          (change: any) =>
            stock.get(change.inventoryItemId) !== change.changeFromQuantity,
        );
        const field = query.includes("mutation AdjustInventory")
          ? "inventoryAdjustQuantities"
          : "inventorySetQuantities";
        const data = {
          [field]: {
            userErrors: stale
              ? [
                  {
                    message: "Stock changed",
                    code: "CHANGE_FROM_QUANTITY_STALE",
                  },
                ]
              : [],
          },
        };
        if (!stale)
          for (const change of changes)
            stock.set(
              change.inventoryItemId,
              change.quantity ??
                stock.get(change.inventoryItemId)! + change.delta,
            );
        seen.set(variables.idempotencyKey, data);
        if (timeoutAfterSuccess) {
          timeoutAfterSuccess = false;
          throw new Error("Socket closed after successful mutation");
        }
        return Response.json({ data });
      }
      throw new Error("Unexpected mocked GraphQL: " + query);
    },
  };
  return {
    admin,
    stock,
    requests,
    timeoutNext() {
      timeoutAfterSuccess = true;
    },
  };
}
async function fixture(
  options: {
    count?: number;
    affected?: number;
    action?: string;
    from?: number;
    to?: number;
    shop?: string;
  } = {},
) {
  const {
    count = 2,
    affected = 1,
    action = "soldOut",
    from = 10,
    to = 0,
    shop = SHOP,
  } = options;
  await db.shop.upsert({
    where: { id: shop },
    create: { id: shop, syncStatus: "ready" },
    update: {},
  });
  await db.variantCache.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      shopId: shop,
      variantId: "v" + i,
      productId: "p" + i,
      inventoryItemId: "i" + i,
      productTitle: "Product " + i,
      variantTitle: "Default",
      handle: "product-" + i,
      options: [],
      sku: "sku" + i,
      barcode: "",
      tracked: true,
      price: "12.00",
      quantities: { [LOCATION]: from },
    })),
  });
  return db.upload.create({
    data: {
      shopId: shop,
      fileName: "weekly.csv",
      action,
      locationId: LOCATION,
      staffName: "Test staff",
      mapping: { sku: "SKU" },
      status: "preview",
      totals: { rows: affected, changing: affected },
      rows: {
        create: Array.from({ length: affected }, (_, i) => ({
          rowIndex: i + 2,
          source: { SKU: "sku" + i },
          matchKey: "sku" + i,
          variantId: "v" + i,
          productId: "p" + i,
          inventoryItemId: "i" + i,
          previousQty: from,
          newQty: to,
          previousPrice: "12.00",
          status: "matched",
        })),
      },
    },
    include: { rows: true },
  });
}
beforeEach(async () => {
  await db.job.deleteMany();
  await db.upload.deleteMany();
  await db.variantCache.deleteMany();
  await db.shop.deleteMany();
});
after(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

test("real job persists snapshots, applies changes, rejects duplicate apply and completes undo", async () => {
  const upload = await fixture(),
    mock = mockInventory({ i0: 10, i1: 10 });
  const job = await enqueueUpload(SHOP, upload.id, "apply", false, true);
  await assert.rejects(
    enqueueUpload(SHOP, upload.id, "apply", false, true),
    /already queued/,
  );
  assert.equal(mock.requests.length, 0);
  await runJob(SHOP, mock.admin, job.id);
  assert.equal(mock.stock.get("i0"), 0);
  assert.equal(
    (await db.upload.findUniqueOrThrow({ where: { id: upload.id } })).status,
    "completed",
  );
  let row = await db.uploadRow.findUniqueOrThrow({
    where: { id: upload.rows[0].id },
  });
  assert.equal(row.applied, true);
  assert.equal(row.previousQty, 10);
  const undo = await enqueueUpload(SHOP, upload.id, "undo", false, true);
  await runJob(SHOP, mock.admin, undo.id);
  row = await db.uploadRow.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(mock.stock.get("i0"), 10);
  assert.equal(row.undone, true);
  assert.equal(
    (await db.upload.findUniqueOrThrow({ where: { id: upload.id } })).status,
    "undone",
  );
  await assert.rejects(
    enqueueUpload(SHOP, upload.id, "undo", false, true),
    /cannot be undone/,
  );
});
test("tenant isolation protects enqueue, execution and retry", async () => {
  const upload = await fixture(),
    mock = mockInventory({ i0: 10 });
  await assert.rejects(
    enqueueUpload(OTHER, upload.id, "apply", true, true),
    /not found/,
  );
  const job = await enqueueUpload(SHOP, upload.id, "apply", true, true);
  assert.equal(await runJob(OTHER, mock.admin, job.id), null);
  assert.equal(mock.requests.length, 0);
  await db.job.update({ where: { id: job.id }, data: { status: "retryable" } });
  await assert.rejects(retryJob(OTHER, job.id), /No paused job/);
});
test("stale preview records row error and never sends a mutation", async () => {
  const upload = await fixture(),
    mock = mockInventory({ i0: 8 });
  const job = await enqueueUpload(SHOP, upload.id, "apply", false, true);
  await runJob(SHOP, mock.admin, job.id);
  const row = await db.uploadRow.findUniqueOrThrow({
    where: { id: upload.rows[0].id },
  });
  assert.equal(row.status, "error");
  assert.match(row.errorMessage!, /Stock changed after preview/);
  assert.equal(mock.requests.length, 0);
  assert.equal(mock.stock.get("i0"), 8);
});
test("undo conflict preserves newer inventory changes", async () => {
  const upload = await fixture(),
    mock = mockInventory({ i0: 10 });
  const job = await enqueueUpload(SHOP, upload.id, "apply", false, true);
  await runJob(SHOP, mock.admin, job.id);
  mock.stock.set("i0", 4);
  const undo = await enqueueUpload(SHOP, upload.id, "undo", false, true);
  await runJob(SHOP, mock.admin, undo.id);
  const row = await db.uploadRow.findUniqueOrThrow({
    where: { id: upload.rows[0].id },
  });
  assert.equal(row.status, "undo_conflict");
  assert.equal(row.undone, false);
  assert.equal(mock.stock.get("i0"), 4);
  assert.equal(mock.requests.length, 1);
});
test("lost response after adjust success resumes identical request without double adjustment", async () => {
  const upload = await fixture({ action: "adjust", from: 10, to: 7 }),
    mock = mockInventory({ i0: 10 });
  const job = await enqueueUpload(SHOP, upload.id, "apply", false, true);
  mock.timeoutNext();
  await runJob(SHOP, mock.admin, job.id);
  assert.equal(mock.stock.get("i0"), 7);
  assert.equal(
    (await db.job.findUniqueOrThrow({ where: { id: job.id } })).status,
    "retryable",
  );
  assert.equal(
    (await db.uploadRow.findUniqueOrThrow({ where: { id: upload.rows[0].id } }))
      .applied,
    false,
  );
  await retryJob(SHOP, job.id);
  await runJob(SHOP, mock.admin, job.id);
  assert.equal(mock.stock.get("i0"), 7);
  assert.equal(mock.requests.length, 2);
  assert.deepEqual(mock.requests[0], mock.requests[1]);
  assert.equal(await db.writeBatch.count({ where: { jobId: job.id } }), 1);
  assert.equal(
    (await db.uploadRow.findUniqueOrThrow({ where: { id: upload.rows[0].id } }))
      .applied,
    true,
  );
});
test("uncertain request older than 23 hours cannot automatically retry", async () => {
  const upload = await fixture({ action: "adjust", from: 10, to: 7 }),
    mock = mockInventory({ i0: 10 });
  const job = await enqueueUpload(SHOP, upload.id, "apply", false, true);
  mock.timeoutNext();
  await runJob(SHOP, mock.admin, job.id);
  await db.writeBatch.updateMany({
    where: { jobId: job.id },
    data: { firstSentAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });
  await assert.rejects(retryJob(SHOP, job.id), /retry expired/);
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.stock.get("i0"), 7);
});
test("server requires confirmation and explicit acknowledgement above 80 percent", async () => {
  const upload = await fixture({ count: 5, affected: 5 });
  await assert.rejects(
    enqueueUpload(SHOP, upload.id, "apply", true, false),
    /Confirm/,
  );
  await assert.rejects(
    enqueueUpload(SHOP, upload.id, "apply", false, true),
    /80%/,
  );
  assert.equal(await db.job.count(), 0);
  const job = await enqueueUpload(SHOP, upload.id, "apply", true, true);
  assert.equal(job.status, "queued");
});
test("exactly 80 percent can proceed without mass-zero acknowledgement", async () => {
  const upload = await fixture({ count: 5, affected: 4 });
  assert.equal(
    (await enqueueUpload(SHOP, upload.id, "apply", false, true)).status,
    "queued",
  );
});
test("one active inventory job per shop prevents competing upload writes", async () => {
  const first = await fixture();
  const second = await db.upload.create({
    data: {
      shopId: SHOP,
      fileName: "other.csv",
      action: "soldOut",
      locationId: LOCATION,
      staffName: "staff",
      mapping: { sku: "SKU" },
      status: "preview",
      rows: {
        create: {
          rowIndex: 2,
          source: { SKU: "sku1" },
          matchKey: "sku1",
          variantId: "v1",
          inventoryItemId: "i1",
          previousQty: 10,
          newQty: 0,
          status: "matched",
        },
      },
    },
  });
  await enqueueUpload(SHOP, first.id, "apply", false, true);
  await assert.rejects(
    enqueueUpload(SHOP, second.id, "apply", false, true),
    /current upload/,
  );
});
test("current lease cannot be claimed by a second worker", async () => {
  const upload = await fixture(),
    mock = mockInventory({ i0: 10 });
  const job = await enqueueUpload(SHOP, upload.id, "apply", false, true);
  await db.job.update({
    where: { id: job.id },
    data: { status: "running", leaseUntil: new Date(Date.now() + 60000) },
  });
  assert.equal(await runJob(SHOP, mock.admin, job.id), null);
  assert.equal(mock.requests.length, 0);
});

test("more than 250 changes are bounded to 250 per mutation and resume over worker slices", async () => {
  const count = 1001,
    upload = await fixture({ count, affected: count }),
    mock = mockInventory(
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => ["i" + i, 10]),
      ),
    );
  const job = await enqueueUpload(SHOP, upload.id, "apply", true, true);
  await runJob(SHOP, mock.admin, job.id);
  assert.equal(mock.requests.length, 4);
  assert.ok(
    mock.requests.every((r) => r.variables.input.quantities.length <= 250),
  );
  assert.equal(
    (await db.job.findUniqueOrThrow({ where: { id: job.id } })).status,
    "queued",
  );
  await runJob(SHOP, mock.admin, job.id);
  assert.equal(mock.requests.length, 5);
  assert.equal(
    new Set(mock.requests.map((r) => r.variables.idempotencyKey)).size,
    5,
  );
  assert.equal(
    await db.uploadRow.count({ where: { uploadId: upload.id, applied: true } }),
    count,
  );
  assert.equal(
    (await db.upload.findUniqueOrThrow({ where: { id: upload.id } })).status,
    "completed",
  );
});
test("mutation errors mark only their batch failed while other batches remain successful", async () => {
  const count = 251,
    upload = await fixture({ count, affected: count }),
    mock = mockInventory(
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => ["i" + i, 10]),
      ),
    );
  let mutations = 0,
    failedIds: string[] = [];
  const admin: Admin = {
    graphql: async (query, options) => {
      if (query.includes("mutation SetInventory") && ++mutations === 2) {
        failedIds = ((options?.variables as any).input.quantities as any[]).map(
          (c) => c.inventoryItemId,
        );
        return Response.json({
          data: {
            inventorySetQuantities: {
              userErrors: [
                {
                  code: "CHANGE_FROM_QUANTITY_STALE",
                  message: "A newer order changed inventory",
                  field: ["input", "quantities", "0"],
                },
              ],
            },
          },
        });
      }
      return mock.admin.graphql(query, options);
    },
  };
  const job = await enqueueUpload(SHOP, upload.id, "apply", true, true);
  await runJob(SHOP, admin, job.id);
  assert.equal(
    (await db.upload.findUniqueOrThrow({ where: { id: upload.id } })).status,
    "partial",
  );
  assert.equal(
    await db.uploadRow.count({
      where: { uploadId: upload.id, status: "error" },
    }),
    failedIds.length,
  );
  assert.equal(
    await db.uploadRow.count({ where: { uploadId: upload.id, applied: true } }),
    count - failedIds.length,
  );
  for (const id of failedIds) assert.equal(mock.stock.get(id), 10);
  const undo = await enqueueUpload(SHOP, upload.id, "undo", true, true);
  await runJob(SHOP, mock.admin, undo.id);
  assert.equal(
    await db.uploadRow.count({ where: { uploadId: upload.id, undone: true } }),
    count - failedIds.length,
  );
});
test("over 5000 changes stage valid JSONL and reconcile reversed bulk output by line number", async () => {
  const count = 5001,
    upload = await fixture({ count, affected: count });
  const job = await enqueueUpload(SHOP, upload.id, "apply", true, true);
  const realFetch = globalThis.fetch;
  let staged: any[] = [],
    starts = 0,
    statusCalls = 0;
  const failedLine = 3;
  const admin: Admin = {
    graphql: async (query, options) => {
      const variables = options?.variables as any;
      if (query.includes("query LiveStock"))
        return Response.json({
          data: {
            nodes: variables.ids.map((id: string) => ({
              id,
              tracked: true,
              inventoryLevel: {
                quantities: [{ name: "available", quantity: 10 }],
              },
            })),
          },
        });
      if (query.includes("mutation Stage"))
        return Response.json({
          data: {
            stagedUploadsCreate: {
              userErrors: [],
              stagedTargets: [
                {
                  url: "https://test.invalid/stage",
                  parameters: [{ name: "key", value: "bulk/input.jsonl" }],
                },
              ],
            },
          },
        });
      if (query.includes("mutation RunBulk")) {
        starts++;
        assert.equal(variables.path, "bulk/input.jsonl");
        assert.equal(variables.identifier, job.id);
        assert.match(variables.mutation, /@idempotent/);
        assert.equal(
          await db.writeBatch.count({
            where: { jobId: job.id, firstSentAt: null },
          }),
          0,
        );
        return Response.json({
          data: {
            bulkOperationRunMutation: {
              userErrors: [],
              bulkOperation: { id: "bulk1", status: "CREATED" },
            },
          },
        });
      }
      if (query.includes("query BulkStatus")) {
        statusCalls++;
        assert.equal(variables.id, "bulk1");
        return Response.json({
          data: {
            node: {
              id: "bulk1",
              status: "COMPLETED",
              url: "https://test.invalid/results",
            },
          },
        });
      }
      throw new Error("Unexpected bulk GraphQL " + query);
    },
  };
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    if (String(input) === "https://test.invalid/stage") {
      assert.equal(init?.method, "POST");
      const form = init?.body as FormData;
      assert.equal(form.get("key"), "bulk/input.jsonl");
      staged = (await (form.get("file") as Blob).text())
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(staged.length, 21);
      assert.equal(
        staged.reduce((sum, row) => sum + row.input.quantities.length, 0),
        count,
      );
      assert.ok(staged.every((row) => row.input.quantities.length <= 250));
      assert.equal(new Set(staged.map((row) => row.idempotencyKey)).size, 21);
      return new Response(null, { status: 201 });
    }
    if (String(input) === "https://test.invalid/results")
      return new Response(
        staged
          .map((_, index) =>
            JSON.stringify({
              __lineNumber: index,
              data: {
                inventorySetQuantities: {
                  userErrors:
                    index === failedLine
                      ? [
                          {
                            message: "Bulk CAS conflict",
                            code: "CHANGE_FROM_QUANTITY_STALE",
                          },
                        ]
                      : [],
                },
              },
            }),
          )
          .reverse()
          .join("\n"),
      );
    throw new Error("Unexpected fetch " + input);
  }) as typeof fetch;
  try {
    await runJob(SHOP, admin, job.id);
    let persisted = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(persisted.status, "queued");
    assert.equal((persisted.payload as any).bulkOperationId, "bulk1");
    assert.equal(
      await db.uploadRow.count({
        where: { uploadId: upload.id, applied: true },
      }),
      0,
    );
    const batches = await db.writeBatch.findMany({
      where: { jobId: job.id },
      orderBy: { id: "asc" },
    });
    await runJob(SHOP, admin, job.id);
    persisted = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(persisted.status, "completed");
    assert.equal(starts, 1);
    assert.equal(statusCalls, 1);
    const failedBatch = batches[failedLine],
      failedRows = failedBatch.rowIds as string[];
    assert.equal(
      await db.uploadRow.count({
        where: { id: { in: failedRows }, status: "error", applied: false },
      }),
      failedRows.length,
    );
    assert.equal(
      await db.uploadRow.count({
        where: { uploadId: upload.id, applied: true },
      }),
      count - failedRows.length,
    );
    assert.equal(
      (await db.upload.findUniqueOrThrow({ where: { id: upload.id } })).status,
      "partial",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("GraphQL THROTTLED responses retry with identical variables", async () => {
  const { gql } = await import("../app/services/graphql.server.ts");
  const variables = {
      idempotencyKey: "same-key",
      input: { name: "available" },
    },
    calls: unknown[] = [];
  const admin: Admin = {
    graphql: async (_query, options) => {
      calls.push(structuredClone(options?.variables));
      return calls.length === 1
        ? Response.json({
            errors: [
              { message: "Throttled", extensions: { code: "THROTTLED" } },
            ],
          })
        : Response.json({ data: { ok: true } });
    },
  };
  assert.deepEqual(await gql(admin, "mutation Example", variables), {
    ok: true,
  });
  assert.deepEqual(calls, [variables, variables]);
});
test("cache JSONL streaming handles split UTF-8, inventory parent IDs and another tenant", async () => {
  const { pollSync } = await import("../app/services/cache.server.ts");
  const item = "gid://shopify/InventoryItem/1",
    variant = "gid://shopify/ProductVariant/1";
  await fixture({ shop: OTHER });
  await db.shop.create({
    data: { id: SHOP, syncStatus: "running", syncOperationId: "cache1" },
  });
  const records = [
    {
      id: variant,
      title: "Default",
      sku: "001",
      barcode: "000123",
      price: "12.00",
      selectedOptions: [{ value: "Small" }],
      product: { id: "p1", title: "Café tee", handle: "cafe" },
      inventoryItem: { id: item, tracked: true },
    },
    {
      id: "level1",
      __parentId: item,
      location: { id: "east" },
      quantities: [{ name: "available", quantity: 9 }],
    },
    {
      id: "level2",
      __parentId: variant,
      location: { id: "west" },
      quantities: [{ name: "available", quantity: 3 }],
    },
  ];
  const data = new TextEncoder().encode(
    records.map((r) => JSON.stringify(r)).join("\n"),
  );
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < data.length; i += 7)
            controller.enqueue(data.slice(i, i + 7));
          controller.close();
        },
      }),
    )) as typeof fetch;
  const admin: Admin = {
    graphql: async () =>
      Response.json({
        data: {
          node: {
            id: "cache1",
            status: "COMPLETED",
            url: "https://test.invalid/cache",
          },
        },
      }),
  };
  try {
    await pollSync(SHOP, admin);
    const cached = await db.variantCache.findUniqueOrThrow({
      where: { shopId_variantId: { shopId: SHOP, variantId: variant } },
    });
    assert.equal(cached.productTitle, "Café tee");
    assert.equal(cached.sku, "001");
    assert.equal(cached.barcode, "000123");
    assert.deepEqual(cached.quantities, { east: 9, west: 3 });
    assert.equal(
      (await db.shop.findUniqueOrThrow({ where: { id: SHOP } })).syncStatus,
      "ready",
    );
    assert.equal(await db.variantCache.count({ where: { shopId: OTHER } }), 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
