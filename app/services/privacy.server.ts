import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import db from "../db.server.ts";
const topics = ["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT", "SHOP_REDACT"];
export async function handlePrivacy(
  shop: string,
  topic: string,
  event: string,
  payload: unknown,
) {
  if (!topics.includes(topic)) throw new Error("Unsupported privacy topic");
  if (!event) throw new Error("Missing event ID");
  const id =
    "privacy-" +
    createHash("sha256")
      .update(shop + ":" + topic + ":" + event)
      .digest("hex");
  await db.$transaction(async (tx) => {
    if (await tx.webhookEvent.findUnique({ where: { id } })) return;
    if (topic === "SHOP_REDACT") {
      await tx.session.deleteMany({ where: { shop } });
      await tx.job.deleteMany({ where: { shopId: shop } });
      await tx.upload.deleteMany({ where: { shopId: shop } });
      await tx.template.deleteMany({ where: { shopId: shop } });
      await tx.variantCache.deleteMany({ where: { shopId: shop } });
      await tx.userGuide.deleteMany({ where: { shopId: shop } });
      await tx.shop.deleteMany({ where: { id: shop } });
    } else {
      // Keep customer requests out of the inventory worker. Original spreadsheets
      // can contain arbitrary data; a trained operator must review and fulfil them.
      const receivedAt = new Date();
      await tx.job.create({
        data: {
          id,
          shopId: shop,
          type: "privacy",
          status: "awaiting_review",
          payload: {
            topic,
            request: payload as Prisma.InputJsonValue,
            receivedAt: receivedAt.toISOString(),
            dueAt: new Date(receivedAt.getTime() + 30 * 86400000).toISOString(),
          },
        },
      });
    }
    await tx.webhookEvent.create({ data: { id } });
  });
}
