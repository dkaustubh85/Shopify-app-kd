import db from "../db.server.ts";
import { gql, type Admin } from "./graphql.server.ts";
export const CACHE_QUERY =
  '{ productVariants { edges { node { id title sku barcode price image { url } selectedOptions { value } product { id title handle featuredImage { url } } inventoryItem { id tracked inventoryLevels { edges { node { id location { id } quantities(names: ["available"]) { name quantity } } } } } } } } }';
export async function startSync(shop: string, admin: Admin) {
  const existing = await db.shop.upsert({
    where: { id: shop },
    create: { id: shop },
    update: {},
  });
  if (existing.syncOperationId && existing.syncStatus === "running")
    return existing;
  const result = await gql(
    admin,
    "mutation StartCache($query: String!) { bulkOperationRunQuery(query: $query) { bulkOperation { id status } userErrors { message } } }",
    { query: CACHE_QUERY },
  );
  const payload = result.bulkOperationRunQuery;
  if (payload.userErrors.length)
    throw new Error(payload.userErrors.map((e: any) => e.message).join("; "));
  return db.shop.update({
    where: { id: shop },
    data: {
      syncOperationId: payload.bulkOperation.id,
      syncStatus: "running",
      syncError: null,
      syncStartedAt: new Date(),
    },
  });
}
async function pollSyncOperation(shop: string, admin: Admin) {
  const store = await db.shop.findUnique({ where: { id: shop } });
  if (!store?.syncOperationId || store.syncStatus !== "running") return;
  const data = await gql(
    admin,
    "query CacheStatus($id: ID!) { node(id: $id) { ... on BulkOperation { id status url errorCode } } }",
    { id: store.syncOperationId },
  );
  const op = data.node;
  if (!op)
    throw new Error(
      "The sync operation is no longer available. Click Sync inventory to restart.",
    );
  if (
    !["COMPLETED", "FAILED", "CANCELED", "EXPIRED"].includes(op.status) &&
    store.syncStartedAt &&
    Date.now() - store.syncStartedAt.getTime() > 2 * 60 * 60 * 1000
  )
    throw new Error(
      "Inventory sync has not finished after two hours. Try Sync inventory again.",
    );
  if (op.status === "COMPLETED") {
    const variants = new Map<string, any>();
    const items = new Map<string, string>();
    const levels: any[] = [];
    if (op.url) {
      const response = await fetch(op.url, {
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok || !response.body)
        throw new Error("Could not download inventory cache.");
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      const consume = (line: string) => {
        if (!line.trim()) return;
        const row = JSON.parse(line);
        if (row.id?.startsWith("gid://shopify/ProductVariant/")) {
          variants.set(row.id, row);
          items.set(row.inventoryItem.id, row.id);
        } else if (row.location) levels.push(row);
      };
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += chunk.value;
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          consume(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
        }
      }
      consume(buffer);
    }
    const quantityMap = new Map<string, Record<string, number>>();
    for (const level of levels) {
      const id = items.get(level.__parentId) || level.__parentId;
      const q = quantityMap.get(id) || {};
      q[level.location.id] =
        level.quantities.find((n: any) => n.name === "available")?.quantity ??
        0;
      quantityMap.set(id, q);
    }
    await db.$transaction(
      async (tx) => {
        await tx.variantCache.deleteMany({ where: { shopId: shop } });
        for (const v of variants.values())
          await tx.variantCache.create({
            data: {
              shopId: shop,
              variantId: v.id,
              productId: v.product.id,
              inventoryItemId: v.inventoryItem.id,
              productTitle: v.product.title,
              variantTitle: v.title,
              handle: v.product.handle,
              sku: v.sku || "",
              barcode: v.barcode || "",
              imageUrl: v.image?.url || v.product.featuredImage?.url || null,
              tracked: v.inventoryItem.tracked,
              price: v.price,
              options: v.selectedOptions.map((o: any) => o.value),
              quantities: quantityMap.get(v.id) || {},
            },
          });
        await tx.shop.update({
          where: { id: shop },
          data: { syncStatus: "ready", syncError: null },
        });
      },
      { timeout: 120000 },
    );
  } else if (["FAILED", "CANCELED", "EXPIRED"].includes(op.status)) {
    await db.shop.update({
      where: { id: shop },
      data: { syncStatus: "error", syncError: op.errorCode || op.status },
    });
  }
}
export async function refreshProduct(shop: string, admin: Admin, id: string) {
  let after = null;
  const seen: string[] = [];
  do {
    const data = await gql(
      admin,
      "query RefreshProduct($id: ID!, $after: String) { product(id: $id) { id title handle featuredImage { url } variants(first: 100, after: $after) { nodes { id title sku barcode price image { url } selectedOptions { value } inventoryItem { id tracked } } pageInfo { hasNextPage endCursor } } } }",
      { id, after },
    );
    const p = data.product;
    if (!p) {
      await db.variantCache.deleteMany({
        where: { shopId: shop, productId: id },
      });
      return;
    }
    for (const v of p.variants.nodes) {
      seen.push(v.id);
      const existing = await db.variantCache.findUnique({
        where: { shopId_variantId: { shopId: shop, variantId: v.id } },
      });
      const quantities =
        existing?.quantities ||
        (await itemQuantities(admin, v.inventoryItem.id));
      await db.variantCache.upsert({
        where: { shopId_variantId: { shopId: shop, variantId: v.id } },
        create: {
          shopId: shop,
          variantId: v.id,
          productId: p.id,
          inventoryItemId: v.inventoryItem.id,
          productTitle: p.title,
          variantTitle: v.title,
          handle: p.handle,
          options: v.selectedOptions.map((o: any) => o.value),
          sku: v.sku || "",
          barcode: v.barcode || "",
          imageUrl: v.image?.url || p.featuredImage?.url || null,
          tracked: v.inventoryItem.tracked,
          price: v.price,
          quantities,
        },
        update: {
          productTitle: p.title,
          variantTitle: v.title,
          sku: v.sku || "",
          barcode: v.barcode || "",
          handle: p.handle,
          options: v.selectedOptions.map((o: any) => o.value),
          tracked: v.inventoryItem.tracked,
          price: v.price,
          imageUrl: v.image?.url || p.featuredImage?.url || null,
        },
      });
    }
    after = p.variants.pageInfo.hasNextPage
      ? p.variants.pageInfo.endCursor
      : null;
  } while (after);
  await db.variantCache.deleteMany({
    where: { shopId: shop, productId: id, variantId: { notIn: seen } },
  });
}
export async function liveQuantities(
  admin: Admin,
  ids: string[],
  locationId: string,
) {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const data = await gql(
      admin,
      'query LiveStock($ids: [ID!]!, $location: ID!) { nodes(ids: $ids) { ... on InventoryItem { id tracked inventoryLevel(locationId: $location) { quantities(names: ["available"]) { quantity name } } } } }',
      { ids: ids.slice(i, i + 100), location: locationId },
    );
    for (const item of data.nodes) {
      if (item?.tracked && item.inventoryLevel)
        out.set(item.id, item.inventoryLevel.quantities[0].quantity);
    }
  }
  return out;
}

export async function itemQuantities(admin: Admin, id: string) {
  const quantities: Record<string, number> = {};
  let after = null;
  do {
    const data = await gql(
      admin,
      'query ItemLocations($id: ID!, $after: String) { inventoryItem(id: $id) { inventoryLevels(first: 250, after: $after) { nodes { location { id } quantities(names: ["available"]) { quantity } } pageInfo { hasNextPage endCursor } } } }',
      { id, after },
    );
    if (!data.inventoryItem) break;
    const levels = data.inventoryItem.inventoryLevels;
    for (const level of levels.nodes)
      quantities[level.location.id] = level.quantities[0].quantity;
    after = levels.pageInfo.hasNextPage ? levels.pageInfo.endCursor : null;
  } while (after);
  return quantities;
}

export async function pollSync(shop: string, admin: Admin) {
  try {
    await pollSyncOperation(shop, admin);
  } catch (error) {
    await db.shop.updateMany({
      where: { id: shop, syncStatus: "running" },
      data: {
        syncStatus: "error",
        syncError:
          error instanceof Error
            ? error.message
            : "Sync failed. Try syncing again.",
      },
    });
    throw error;
  }
}
