import type { ActionFunctionArgs } from "react-router";
import { timingSafeEqual } from "node:crypto";
import { unauthenticated } from "../shopify.server";
import db from "../db.server";
import { runJob } from "../services/jobs.server";
import { pollSync } from "../services/cache.server";
export async function action({ request }: ActionFunctionArgs) {
  const expected = process.env.WORKER_SECRET;
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (
    !expected ||
    Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  )
    return new Response("Unauthorized", { status: 401 });
  const shops = await db.shop.findMany();
  for (const shop of shops) {
    if (
      !(await db.session.findFirst({
        where: { shop: shop.id, isOnline: false },
      }))
    )
      continue;
    try {
      const { admin } = await unauthenticated.admin(shop.id);
      await pollSync(shop.id, admin);
      await runJob(shop.id, admin);
    } catch {
      console.error("Worker could not process shop", shop.id);
    }
  }
  return Response.json({ ok: true });
}
