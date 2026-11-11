import * as XLSX from "xlsx";
import type { Mapping, SheetRow } from "../types.ts";
export const MAX_ROWS = 100000;
export function parseSheet(buffer: Uint8Array, name: string) {
  if (!/\.(xlsx|xls|csv)$/i.test(name))
    throw new Error("Choose an Excel (.xlsx or .xls) or CSV file.");
  if (buffer.byteLength > 10 * 1024 * 1024)
    throw new Error("Choose a file smaller than 10 MB.");
  const workbook = XLSX.read(buffer, {
    type: "array",
    raw: true,
    cellText: true,
    cellDates: false,
    sheetRows: MAX_ROWS + 2,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("This workbook has no sheets.");
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  const headers = (data.shift() || []).map((v) =>
    String(v)
      .replace(/^\uFEFF/, "")
      .trim(),
  );
  if (!headers.length || headers.some((h) => !h))
    throw new Error("Every column needs a header in the first row.");
  if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length)
    throw new Error("Column names must be unique.");
  if (data.length > MAX_ROWS)
    throw new Error("Split this sheet into files of 100,000 rows or fewer.");
  const rows: SheetRow[] = data
    .filter((r) => r.some((v) => String(v).trim()))
    .map((r) =>
      Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "").trim()])),
    );
  if (!rows.length) throw new Error("The sheet has no data rows.");
  return { headers, rows, mapping: detectMapping(headers) };
}
export function detectMapping(headers: string[]): Mapping {
  const aliases: Record<string, string[]> = {
    sku: ["sku", "variantsku", "itemcode", "productcode", "stockcode"],
    barcode: ["barcode", "ean", "upc", "gtin", "variantbarcode"],
    handle: ["handle", "producthandle"],
    option1: ["option1", "option1value", "size"],
    option2: ["option2", "option2value", "color", "colour"],
    option3: ["option3", "option3value"],
    quantity: [
      "quantity",
      "qty",
      "stock",
      "inventory",
      "available",
      "inventoryquantity",
    ],
    price: ["price", "unitprice", "variantprice", "retailprice"],
  };
  return Object.fromEntries(
    Object.entries(aliases).flatMap(([k, a]) => {
      const h = headers.find((h) =>
        a.includes(h.toLowerCase().replace(/[^a-z0-9]/g, "")),
      );
      return h ? [[k, h]] : [];
    }),
  );
}
export function workbookBytes(rows: SheetRow[], headers?: string[]) {
  const b = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    b,
    XLSX.utils.json_to_sheet(rows, headers ? { header: headers } : {}),
    "Inventory",
  );
  return XLSX.write(b, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
export function csv(rows: SheetRow[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const escape = (s: string) =>
    '"' +
    (/^\s*[=+@-]|^[\t\r\n]/.test(s) ? "'" : "") +
    s.replaceAll('"', '""') +
    '"';
  return [keys, ...rows.map((r) => keys.map((k) => r[k] ?? ""))]
    .map((r) => r.map(escape).join(","))
    .join("\r\n");
}
