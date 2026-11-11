import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const event =
    request.headers.get("x-shopify-event-id") ||
    request.headers.get("x-shopify-webhook-id");
  if (!event) return new Response("Missing event ID", { status: 400 });
  await db.$transaction(async (tx) => {
    if (await tx.webhookEvent.findUnique({ where: { id: event } })) return;
    const p = payload as any;
    if (
      topic === "PRODUCTS_UPDATE" ||
      topic === "PRODUCTS_CREATE" ||
      topic === "PRODUCTS_DELETE"
    )
      await tx.job.create({
        data: {
          shopId: shop,
          type: "refreshProduct",
          payload: {
            productId:
              p.admin_graphql_api_id || "gid://shopify/Product/" + p.id,
          },
        },
      });
    if (topic === "INVENTORY_ITEMS_UPDATE")
      await tx.variantCache.updateMany({
        where: {
          shopId: shop,
          inventoryItemId: "gid://shopify/InventoryItem/" + p.id,
        },
        data: { tracked: p.tracked },
      });
    if (topic === "INVENTORY_LEVELS_UPDATE") {
      const rows = await tx.variantCache.findMany({
        where: {
          shopId: shop,
          inventoryItemId: "gid://shopify/InventoryItem/" + p.inventory_item_id,
        },
      });
      for (const row of rows)
        await tx.variantCache.update({
          where: { id: row.id },
          data: {
            quantities: {
              ...(row.quantities as object),
              ["gid://shopify/Location/" + p.location_id]: p.available,
            },
          },
        });
    }
    await tx.webhookEvent.create({ data: { id: event } });
  });
  return new Response();
}
