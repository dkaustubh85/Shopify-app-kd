import type { ActionFunctionArgs } from "react-router";
import { context, message } from "../services/context.server";
import { saveGuide } from "../services/guide.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, userId } = await context(request);
  try {
    const body = await request.formData();
    await saveGuide(
      shop,
      userId,
      Number(body.get("step")),
      String(body.get("status")),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: message(e) }, { status: 400 });
  }
}

export { headers } from "../utils/shopify-headers.server";
