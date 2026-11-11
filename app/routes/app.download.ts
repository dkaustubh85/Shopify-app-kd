import type { LoaderFunctionArgs } from "react-router";
import { context, settings } from "../services/context.server";
import db from "../db.server";
import { workbookBytes } from "../pipeline/parsers/sheet";
import { historyDownload, attachment } from "../services/downloads.server";
import { locations } from "../services/graphql.server";
import { activeLocation } from "../utils/input";
import type { Mapping } from "../pipeline/types";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, store, admin } = await context(request);
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (kind === "sample")
    return attachment(
      workbookBytes([
        {
          SKU: "YOUR-SKU-001",
          Barcode: "0012345678901",
          Handle: "your-product",
          Option1: "Default Title",
          Quantity: "10",
          Price: "19.99",
        },
        {
          SKU: "YOUR-SKU-002",
          Barcode: "0012345678902",
          Handle: "your-other-product",
          Option1: "Default Title",
          Quantity: "0",
          Price: "24.99",
        },
      ]),
      "stocksheet-sample.xlsx",
    );
  if (kind === "upload" || kind === "results" || kind === "unmatched")
    return historyDownload(shop, url.searchParams.get("id") || "", kind);
  if (kind !== "export")
    return Response.json(
      { error: "Choose a valid download." },
      { status: 400 },
    );
  if (store.syncStatus !== "ready")
    return Response.json(
      {
        error: "Inventory is still syncing. Check the dashboard and try again.",
      },
      { status: 409 },
    );
  const id = url.searchParams.get("template");
  const template = id
    ? await db.template.findFirst({ where: { id, shopId: shop } })
    : null;
  if (id && !template)
    return Response.json(
      { error: "Template not found. Choose another format." },
      { status: 404 },
    );
  const mapping = (template?.mapping || {
    sku: "SKU",
    barcode: "Barcode",
    handle: "Handle",
    option1: "Option1",
    option2: "Option2",
    option3: "Option3",
    quantity: "Quantity",
    price: "Price",
  }) as Mapping;
  const available = await locations(admin);
  const location =
    url.searchParams.get("location") ||
    activeLocation(settings(store.settings).locationId, available);
  if (!available.some((l) => l.id === location))
    return Response.json(
      {
        error:
          "This location is no longer active. Refresh Export inventory and select an active location.",
      },
      { status: 400 },
    );
  const variants = await db.variantCache.findMany({
    where: { shopId: shop },
    orderBy: { sku: "asc" },
  });
  const rows = variants.map((v) => {
    const values: Record<string, string> = {
      sku: v.sku,
      barcode: v.barcode,
      handle: v.handle,
      option1: (v.options as string[])[0] || "",
      option2: (v.options as string[])[1] || "",
      option3: (v.options as string[])[2] || "",
      quantity: String(
        (v.quantities as Record<string, number>)[location] ?? "",
      ),
      price: v.price,
    };
    return Object.fromEntries(
      Object.entries(mapping)
        .filter(([, column]) => column)
        .map(([key, column]) => [column!, values[key] || ""]),
    );
  });
  return attachment(
    workbookBytes(rows, Object.values(mapping).filter(Boolean) as string[]),
    "stocksheet-inventory.xlsx",
  );
}

export { headers } from "../utils/shopify-headers.server";
