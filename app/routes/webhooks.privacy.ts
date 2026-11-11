import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handlePrivacy } from "../services/privacy.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const event =
    request.headers.get("x-shopify-event-id") ||
    request.headers.get("x-shopify-webhook-id");
  if (!event) return new Response("Missing event ID", { status: 400 });
  if (
    !["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT", "SHOP_REDACT"].includes(
      topic,
    )
  )
    return new Response("Unsupported topic", { status: 400 });
  await handlePrivacy(shop, topic, event, payload);
  return new Response(null, { status: 200 });
}
