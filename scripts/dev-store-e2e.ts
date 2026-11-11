import { UNSAFE_decodeViaTurboStream } from "react-router";
import { devHeaders } from "./dev-auth.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server.ts";
import {
  gql,
  SET,
  locations,
  type Admin,
} from "../app/services/graphql.server.ts";
import { liveQuantities } from "../app/services/cache.server.ts";
import { enqueueUpload, runJob } from "../app/services/jobs.server.ts";
import { preview, totals } from "../app/pipeline/preview.ts";
import { parseSheet, workbookBytes } from "../app/pipeline/parsers/sheet.ts";
const shop = process.env.E2E_SHOP || "kaustubhs-test-shop.myshopify.com";
if (shop !== "kaustubhs-test-shop.myshopify.com")
  throw new Error(
    "This test is restricted to the explicitly authorized development store.",
  );
const http = process.env.E2E_HTTP_URL;
if (
  http &&
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(http).hostname)
)
  throw new Error("HTTP test origin must be loopback.");
const httpHeaders = http ? devHeaders() : undefined;
async function httpAction(
  path: string,
  route: string,
  body: FormData | Record<string, string>,
) {
  const response = await fetch(http + path + ".data", {
    method: "POST",
    headers: httpHeaders,
    body: body instanceof FormData ? body : new URLSearchParams(body),
  });
  const decoded = await UNSAFE_decodeViaTurboStream(response.body!, globalThis);
  const envelope = decoded.value as Record<string, any>;
  const data = envelope.data ?? envelope[route]?.data ?? envelope;
  assert.equal(response.status, 200, JSON.stringify(data));
  if (data.error) throw new Error(data.error);
  return data;
}
let productId: string | undefined;
let variantId: string | undefined;
let mutations = 0;
const session = await db.session.findFirst({
  where: { shop, isOnline: false },
  orderBy: { expires: "desc" },
});
if (!session) {
  await db.$disconnect();
  throw new Error(
    "Install and open StockSheet in the dev store first, then rerun this test.",
  );
}
const admin: Admin = {
  graphql: async (query, options) => {
    if (query.trim().startsWith("mutation")) mutations++;
    const response = await fetch(
      "https://" + shop + "/admin/api/2026-10/graphql.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
        body: JSON.stringify({ query, variables: options?.variables || {} }),
      },
    );
    if (!response.ok)
      throw new Error("Shopify API returned " + response.status);
    return response;
  },
};
try {
  const info = await gql(
    admin,
    "query TestStore { shop { plan { partnerDevelopment } } }",
  );
  if (!info.shop.plan.partnerDevelopment)
    throw new Error(
      "Refusing to run: Shopify does not identify this store as a development store.",
    );
  const loc = (await locations(admin))[0];
  if (!loc) throw new Error("Add an active location to the dev store.");
  const sku = "STOCKSHEET-E2E-" + randomUUID().slice(0, 8);
  const created = await gql(
    admin,
    "mutation CreateFixture($product: ProductCreateInput!) { productCreate(product: $product) { product { id title handle variants(first: 1) { nodes { id title price inventoryItem { id } } } } userErrors { message } } }",
    { product: { title: sku, status: "DRAFT" } },
  );
  if (created.productCreate.userErrors.length)
    throw new Error(created.productCreate.userErrors[0].message);
  const product = created.productCreate.product;
  productId = product.id;
  const variant = product.variants.nodes[0];
  variantId = variant.id;
  const configured = await gql(
    admin,
    "mutation ConfigureFixture($id: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $id, variants: $variants) { userErrors { message } } }",
    {
      id: productId,
      variants: [{ id: variantId, inventoryItem: { sku, tracked: true } }],
    },
  );
  assert.equal(configured.productVariantsBulkUpdate.userErrors.length, 0);
  let stock = await liveQuantities(admin, [variant.inventoryItem.id], loc.id);
  if (!stock.has(variant.inventoryItem.id)) {
    const active = await gql(
      admin,
      "mutation ActivateFixture($item: ID!, $location: ID!, $key: String!) { inventoryActivate(inventoryItemId: $item, locationId: $location, available: 7) @idempotent(key: $key) { userErrors { message } } }",
      { item: variant.inventoryItem.id, location: loc.id, key: randomUUID() },
    );
    assert.equal(active.inventoryActivate.userErrors.length, 0);
  } else {
    const set = await gql(admin, SET, {
      idempotencyKey: randomUUID(),
      input: {
        name: "available",
        reason: "correction",
        quantities: [
          {
            inventoryItemId: variant.inventoryItem.id,
            locationId: loc.id,
            quantity: 7,
            changeFromQuantity: stock.get(variant.inventoryItem.id),
          },
        ],
      },
    });
    assert.equal(set.inventorySetQuantities.userErrors.length, 0);
  }
  const cached = await db.variantCache.upsert({
    where: { shopId_variantId: { shopId: shop, variantId: variant.id } },
    create: {
      shopId: shop,
      variantId: variant.id,
      productId: product.id,
      inventoryItemId: variant.inventoryItem.id,
      sku,
      barcode: "",
      handle: product.handle,
      productTitle: product.title,
      variantTitle: variant.title,
      options: ["Default Title"],
      tracked: true,
      price: variant.price,
      quantities: { [loc.id]: 7 },
    },
    update: { tracked: true, quantities: { [loc.id]: 7 } },
  });
  const baseline = mutations;
  const sheet = parseSheet(
    workbookBytes([{ SKU: sku, Quantity: "0" }]),
    "e2e.xlsx",
  );
  const planned = preview(
    sheet.rows,
    sheet.mapping,
    "soldOut",
    [cached],
    loc.id,
  );
  assert.equal(planned[0].newQty, 0);
  assert.equal(planned[0].previousQty, 7);
  assert.equal(mutations, baseline, "Preview must not send mutations");
  let upload = await db.upload.create({
    data: {
      shopId: shop,
      fileName: "automated-dev-store-e2e.xlsx",
      staffName: "Development-store test runner",
      action: "soldOut",
      locationId: loc.id,
      mapping: sheet.mapping,
      status: "preview",
      totals: totals(planned),
      rows: { create: planned },
    },
  });
  if (http) {
    await db.upload.delete({ where: { id: upload.id } });
    const body = new FormData();
    body.append("intent", "upload");
    body.append(
      "file",
      new Blob([new Uint8Array(workbookBytes([{ SKU: sku, Quantity: "0" }]))]),
      "e2e.xlsx",
    );
    const uploaded = await httpAction("/app/upload", "routes/app.upload", body);
    await httpAction("/app/upload", "routes/app.upload", {
      intent: "preview",
      id: uploaded.id,
      mapping: JSON.stringify(sheet.mapping),
      action: "soldOut",
      location: loc.id,
    });
    upload = await db.upload.findUniqueOrThrow({ where: { id: uploaded.id } });
    assert.equal(upload.status, "preview");
    assert.equal(
      (await liveQuantities(admin, [variant.inventoryItem.id], loc.id)).get(
        variant.inventoryItem.id,
      ),
      7,
      "HTTP preview must leave Shopify stock unchanged",
    );
    await httpAction("/app/upload", "routes/app.upload", {
      intent: "apply",
      id: upload.id,
      ack: "true",
      confirmed: "true",
    });
  }
  const apply = http
    ? await db.job.findFirstOrThrow({
        where: { uploadId: upload.id, type: "apply" },
      })
    : await enqueueUpload(shop, upload.id, "apply", true, true);
  for (let n = 0; n < 20; n++) {
    if (http)
      await httpAction("/app/upload", "routes/app.upload", {
        intent: "work",
        id: upload.id,
      });
    else await runJob(shop, admin, apply.id);
    const job = await db.job.findUniqueOrThrow({ where: { id: apply.id } });
    if (job.status === "completed") break;
    if (job.status === "retryable")
      throw new Error(job.error || "Apply paused");
  }
  stock = await liveQuantities(admin, [variant.inventoryItem.id], loc.id);
  assert.equal(
    stock.get(variant.inventoryItem.id),
    0,
    "Apply sets Shopify stock to zero",
  );
  if (http)
    await httpAction("/app/history/" + upload.id, "routes/app.history.$id", {
      intent: "undo",
      ack: "true",
      confirmed: "true",
    });
  const undo = http
    ? await db.job.findFirstOrThrow({
        where: { uploadId: upload.id, type: "undo" },
      })
    : await enqueueUpload(shop, upload.id, "undo", true, true);
  for (let n = 0; n < 20; n++) {
    if (http)
      await httpAction("/app/history/" + upload.id, "routes/app.history.$id", {
        intent: "work",
      });
    else await runJob(shop, admin, undo.id);
    const job = await db.job.findUniqueOrThrow({ where: { id: undo.id } });
    if (job.status === "completed") break;
    if (job.status === "retryable") throw new Error(job.error || "Undo paused");
  }
  stock = await liveQuantities(admin, [variant.inventoryItem.id], loc.id);
  assert.equal(
    stock.get(variant.inventoryItem.id),
    7,
    "Undo restores original stock",
  );
  assert.equal(
    (await db.upload.findUniqueOrThrow({ where: { id: upload.id } })).status,
    "undone",
  );
  console.log(
    http ? "HTTP route end-to-end test:" : "Service end-to-end test:",
  );
  console.log(
    "PASS: XLSX upload parsing ? preview (no writes) ? queued apply (7 to 0) ? undo (0 to 7), verified against Shopify. History ID:",
    upload.id,
  );
} finally {
  if (productId) {
    const deleted = await gql(
      admin,
      "mutation DeleteFixture($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId userErrors { message } } }",
      { input: { id: productId } },
    );
    if (deleted.productDelete.userErrors.length)
      console.error("Fixture cleanup needs attention for product", productId);
    else {
      await db.variantCache.deleteMany({ where: { shopId: shop, variantId } });
      console.log("Deleted the test draft product.");
    }
  }
  await db.$disconnect();
}
