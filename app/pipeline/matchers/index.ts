import type { Mapping, SheetRow, Variant } from "../types.ts";
export const normalize = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLocaleLowerCase("en-US");
export function buildMatcher(
  variants: Variant[],
  priority = ["sku", "barcode", "handle"],
) {
  const indexes = new Map<string, Map<string, Variant[]>>();
  for (const key of ["sku", "barcode", "handle"] as const) {
    const index = new Map<string, Variant[]>();
    for (const v of variants) {
      const value = normalize(v[key]);
      if (value) index.set(value, [...(index.get(value) || []), v]);
    }
    indexes.set(key, index);
  }
  return (row: SheetRow, mapping: Mapping) => {
    for (const key of priority) {
      const column = mapping[key as keyof Mapping];
      const value = normalize(column ? row[column] : "");
      if (!value) continue;
      let matches = indexes.get(key)?.get(value) || [];
      if (key === "handle")
        matches = matches.filter((v) => {
          const options = v.options as string[];
          return [1, 2, 3].every((n) => {
            const c = mapping[("option" + n) as keyof Mapping];
            return !c || normalize(options[n - 1]) === normalize(row[c]);
          });
        });
      if (matches.length > 1)
        return {
          variant: null,
          key: value,
          error:
            "Ambiguous: multiple variants match. Add a unique SKU or barcode.",
        };
      if (matches.length === 1)
        return { variant: matches[0], key: value, error: null };
    }
    return {
      variant: null,
      key: "",
      error: "No matching variant. Check your SKU, barcode, or handle.",
    };
  };
}
