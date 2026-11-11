import { authenticate } from "../shopify.server";
import db from "../db.server";
export async function context(request: Request) {
  const auth = await authenticate.admin(request);
  const shop = auth.session.shop;
  const store = await db.shop.upsert({
    where: { id: shop },
    create: { id: shop },
    update: {},
  });
  const user = auth.session.onlineAccessInfo?.associated_user;
  const staff = user
    ? [user.first_name, user.last_name].filter(Boolean).join(" ")
    : "Staff " + (auth.sessionToken?.sub || auth.session.id);
  const userId = String(auth.sessionToken?.sub || user?.id || auth.session.id);
  return { ...auth, shop, store, staff, userId };
}
export function message(error: unknown) {
  if (error instanceof Response) throw error;
  return error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}
export const defaults = {
  locationId: "",
  matchKey: "sku",
  lowStockThreshold: 5,
  notificationEmail: "",
};
export function settings(value: unknown) {
  return { ...defaults, ...(value as object) };
}
