export interface Admin {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}
export async function gql(
  admin: Admin,
  query: string,
  variables: Record<string, unknown> = {},
) {
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const response = await admin.graphql(query, { variables });
      const body = await response.json();
      if (body.errors?.some((e: any) => e.extensions?.code === "THROTTLED")) {
        await delay(Math.min(30000, 500 * 2 ** attempt));
        continue;
      }
      if (body.errors?.length)
        throw new Error(body.errors.map((e: any) => e.message).join("; "));
      return body.data;
    } catch (error) {
      const e = error as any;
      if (
        e?.response?.code === 429 ||
        e?.response?.errors?.some?.(
          (x: any) => x.extensions?.code === "THROTTLED",
        )
      ) {
        await delay(Math.min(30000, 500 * 2 ** attempt));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Shopify is busy. Retry this job in a moment.");
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const SET =
  "mutation SetInventory($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) { inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) { userErrors { field message code } } }";
export const ADJUST =
  "mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) { inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) { userErrors { field message code } } }";
export const PRICE =
  "mutation SetPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message code } } }";
export const LOCATIONS =
  "query Locations($after: String) { locations(first: 100, after: $after) { nodes { id name isActive } pageInfo { hasNextPage endCursor } } }";
export async function locations(admin: Admin) {
  const result: { id: string; name: string }[] = [];
  let after = null;
  do {
    const data = await gql(admin, LOCATIONS, { after });
    result.push(...data.locations.nodes.filter((l: any) => l.isActive));
    after = data.locations.pageInfo.hasNextPage
      ? data.locations.pageInfo.endCursor
      : null;
  } while (after);
  return result;
}
