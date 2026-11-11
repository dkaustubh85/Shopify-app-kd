import type {
  ActionKind,
  Mapping,
  PlannedChange,
  SheetRow,
  Variant,
} from "./types.ts";
import { buildMatcher } from "./matchers/index.ts";
import { actions } from "./actions/index.ts";
export function preview(
  rows: SheetRow[],
  mapping: Mapping,
  action: ActionKind,
  variants: Variant[],
  locationId: string,
  priority?: string[],
) {
  const match = buildMatcher(variants, priority);
  const targets = new Map<string, PlannedChange[]>();
  const planned = rows.map((source, i): PlannedChange => {
    const found = match(source, mapping);
    const v = found.variant;
    const quantities = (v?.quantities || {}) as Record<string, number>;
    const q = quantities[locationId];
    const p: PlannedChange = {
      rowIndex: i + 2,
      source,
      matchKey: found.key,
      productTitle: v?.productTitle || "",
      variantTitle: v?.variantTitle || "",
      imageUrl: v?.imageUrl || null,
      variantId: v?.variantId || null,
      productId: v?.productId || null,
      inventoryItemId: v?.inventoryItemId || null,
      previousQty: q ?? null,
      newQty: null,
      previousPrice: v?.price || null,
      newPrice: null,
      status: v ? "matched" : "unmatched",
      errorMessage: found.error,
    };
    if (!v) return p;
    const list = targets.get(v.variantId) || [];
    list.push(p);
    targets.set(v.variantId, list);
    try {
      if (action !== "setPrice" && !v.tracked)
        throw new Error(
          "Inventory not tracked. Enable Track quantity in Shopify for this variant.",
        );
      if (action !== "setPrice" && q === undefined)
        throw new Error("This item is not stocked at the selected location.");
      const result = actions[action].preview(source, mapping, v, q ?? 0);
      p.newQty = result.quantity ?? null;
      p.newPrice = result.price ?? null;
      if (
        p.newQty !== null &&
        (!Number.isSafeInteger(p.newQty) ||
          p.newQty < 0 ||
          p.newQty > 1000000000)
      )
        throw new Error(
          "Resulting quantity must be between 0 and 1,000,000,000.",
        );
      if (
        (p.newQty !== null && p.newQty === q) ||
        (p.newPrice !== null && p.newPrice === Number(v.price).toFixed(2))
      )
        p.status = "no_change";
    } catch (e) {
      p.status = "error";
      p.errorMessage = (e as Error).message;
    }
    return p;
  });
  for (const list of targets.values())
    if (list.length > 1)
      for (const p of list) {
        p.status = "error";
        p.errorMessage =
          "Duplicate target in this sheet. Keep only one row per variant.";
      }
  return planned;
}
export function totals(
  rows: Pick<PlannedChange, "status" | "newQty" | "previousQty">[],
) {
  return {
    rows: rows.length,
    matched: rows.filter(
      (r) => r.status === "matched" || r.status === "no_change",
    ).length,
    unmatched: rows.filter((r) => r.status === "unmatched").length,
    errors: rows.filter((r) => r.status === "error").length,
    changing: rows.filter((r) => r.status === "matched").length,
    soldOut: rows.filter(
      (r) =>
        r.status === "matched" && r.newQty === 0 && (r.previousQty ?? 0) > 0,
    ).length,
  };
}
export function requiresZeroAcknowledgement(soldOut: number, tracked: number) {
  return tracked > 0 && soldOut / tracked > 0.8;
}
export function undoPlan(
  row: {
    applied: boolean;
    undone: boolean;
    previousQty: number | null;
    newQty: number | null;
  },
  live: number,
) {
  if (!row.applied || row.undone)
    throw new Error("This row is not eligible for undo.");
  if (row.previousQty === null || row.newQty === null)
    throw new Error("No quantity snapshot.");
  if (live !== row.newQty)
    throw new Error(
      "Stock changed after this upload. Undo skipped to protect newer changes.",
    );
  return { from: live, to: row.previousQty };
}
