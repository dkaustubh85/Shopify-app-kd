import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await authenticate.webhook(request);
  await db.$transaction([
    db.session.deleteMany({ where: { shop } }),
    db.job.updateMany({
      where: {
        shopId: shop,
        status: { in: ["queued", "running", "retryable"] },
      },
      data: { status: "canceled", leaseUntil: null, error: "App uninstalled" },
    }),
    db.variantCache.deleteMany({ where: { shopId: shop } }),
    db.shop.updateMany({
      where: { id: shop },
      data: { syncStatus: "uninstalled" },
    }),
  ]);
  return new Response();
}
