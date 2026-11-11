import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  parseSheet,
  detectMapping,
  csv,
  workbookBytes,
  MAX_ROWS,
} from "../app/pipeline/parsers/sheet.ts";
import { buildMatcher } from "../app/pipeline/matchers/index.ts";
import { actions } from "../app/pipeline/actions/index.ts";
import {
  preview,
  totals,
  requiresZeroAcknowledgement,
  undoPlan,
} from "../app/pipeline/preview.ts";
import type { Variant } from "../app/pipeline/types.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const variant = (overrides: Partial<Variant> = {}): Variant => ({
  variantId: "v1",
  productId: "p1",
  inventoryItemId: "i1",
  productTitle: "Tee",
  variantTitle: "Small / Blue",
  handle: "tee",
  options: ["Small", "Blue"],
  sku: "001",
  barcode: "000123",
  imageUrl: null,
  tracked: true,
  price: "12.00",
  quantities: { loc: 10 },
  ...overrides,
});
const mapping = {
  sku: "SKU",
  barcode: "Barcode",
  quantity: "Quantity",
  price: "Price",
};
test("CSV preserves leading zeros, quoted fields, BOM, and filters blank rows", () => {
  const parsed = parseSheet(
    bytes(
      '\uFEFFSKU,Barcode,Title,Quantity\r\n001,000123,"A, B",0\r\n,,,\r\n002,000124, Other ,2',
    ),
    "stock.csv",
  );
  assert.deepEqual(parsed.rows, [
    { SKU: "001", Barcode: "000123", Title: "A, B", Quantity: "0" },
    { SKU: "002", Barcode: "000124", Title: "Other", Quantity: "2" },
  ]);
  assert.equal(parsed.mapping.sku, "SKU");
});
test("Excel XLSX/XLS round trip retains text identifiers", () => {
  for (const bookType of ["xlsx", "xls"] as const) {
    const b = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      b,
      XLSX.utils.aoa_to_sheet([
        ["SKU", "Barcode", "Quantity"],
        ["001", "000123", 7],
      ]),
      "Stock",
    );
    const parsed = parseSheet(
      XLSX.write(b, { type: "buffer", bookType }),
      "stock." + bookType,
    );
    assert.deepEqual(parsed.rows, [
      { SKU: "001", Barcode: "000123", Quantity: "7" },
    ]);
  }
  assert.equal(
    parseSheet(
      workbookBytes([{ SKU: "001", Quantity: "10" }]),
      "roundtrip.xlsx",
    ).rows[0].SKU,
    "001",
  );
});
test("parser refuses missing/duplicate headers, empty data, wrong extension, large files", () => {
  for (const data of ["SKU,sku\nA,B", "SKU,\nA,B", "SKU,Qty\n"])
    assert.throws(() => parseSheet(bytes(data), "stock.csv"));
  assert.throws(
    () => parseSheet(bytes("SKU\nA"), "stockxcsv"),
    /Choose an Excel/,
  );
  assert.throws(
    () => parseSheet(new Uint8Array(10 * 1024 * 1024 + 1), "stock.xlsx"),
    /10 MB/,
  );
});
test("parser refuses excess rows instead of silently truncating", () => {
  const input =
    "SKU\n" +
    Array.from({ length: MAX_ROWS + 1 }, (_, i) => "item" + i).join("\n");
  assert.throws(() => parseSheet(bytes(input), "stock.csv"), /100,000/);
});
test("mapping recognizes supplier and Shopify header aliases", () => {
  assert.deepEqual(
    detectMapping([
      "Variant SKU",
      "UPC",
      "Product handle",
      "Option1 Value",
      "Colour",
      "Qty",
      "Unit Price",
    ]),
    {
      sku: "Variant SKU",
      barcode: "UPC",
      handle: "Product handle",
      option1: "Option1 Value",
      option2: "Colour",
      quantity: "Qty",
      price: "Unit Price",
    },
  );
});
test("CSV export escapes formulas including whitespace and quotes", () => {
  const output = csv([{ SKU: " =SUM(1,2)", Title: 'a"b', Quantity: "-5" }]);
  assert.match(output, /"' =SUM\(1,2\)"/);
  assert.match(output, /"a""b"/);
  assert.match(output, /"'-5"/);
  assert.equal(csv([]), "");
});
test("matcher trims/casefolds and follows configurable fallback priority", () => {
  const a = variant({ sku: " A ", barcode: "111" }),
    b = variant({ variantId: "v2", sku: "B", barcode: "222" });
  const match = buildMatcher([a, b]);
  assert.equal(match({ SKU: " a " }, mapping).variant?.variantId, "v1");
  assert.equal(
    match({ SKU: "unknown", Barcode: "222" }, mapping).variant?.variantId,
    "v2",
  );
  assert.equal(
    buildMatcher([a, b], ["barcode", "sku"])(
      { SKU: "A", Barcode: "222" },
      mapping,
    ).variant?.variantId,
    "v2",
  );
  assert.equal(match({ SKU: "" }, mapping).variant, null);
});
test("ambiguous identifiers never fall through to a different key", () => {
  const result = buildMatcher([
    variant(),
    variant({ variantId: "v2", barcode: "999" }),
  ])({ SKU: "001", Barcode: "000123" }, mapping);
  assert.equal(result.variant, null);
  assert.match(result.error!, /Ambiguous/);
});
test("handle matching considers mapped options and refuses ambiguity", () => {
  const variants = [
    variant(),
    variant({ variantId: "v2", options: ["Large", "Blue"] }),
  ];
  const match = buildMatcher(variants);
  assert.equal(
    match(
      { Handle: " TEE ", Size: "large" },
      { handle: "Handle", option1: "Size" },
    ).variant?.variantId,
    "v2",
  );
  assert.equal(match({ Handle: "tee" }, { handle: "Handle" }).variant, null);
});
test("sold out action ignores quantity input", () => {
  assert.deepEqual(
    actions.soldOut.preview({ Quantity: "bad" }, mapping, variant(), 10),
    { quantity: 0 },
  );
  assert.equal(actions.soldOut.mutation, "inventorySetQuantities");
});
test("exact quantity accepts signed whole numbers and rejects invalid values", () => {
  for (const n of ["0", "25", "+4"])
    assert.equal(
      actions.setQuantity.preview({ Quantity: n }, mapping, variant(), 10)
        .quantity,
      Number(n),
    );
  for (const n of [
    "",
    "1.5",
    "1e2",
    "NaN",
    "Infinity",
    "1000000001",
    "9007199254740993",
  ])
    assert.throws(() =>
      actions.setQuantity.preview({ Quantity: n }, mapping, variant(), 10),
    );
});
test("adjust calculates preview target without mutating current inventory", () => {
  const v = variant();
  assert.deepEqual(actions.adjust.preview({ Quantity: "-3" }, mapping, v, 10), {
    quantity: 7,
  });
  assert.deepEqual(v.quantities, { loc: 10 });
  assert.equal(actions.adjust.mutation, "inventoryAdjustQuantities");
});
test("price validates decimals and canonicalizes values", () => {
  for (const [raw, expected] of [
    ["0", "0.00"],
    ["12.5", "12.50"],
    ["12.99", "12.99"],
  ])
    assert.equal(
      actions.setPrice.preview({ Price: raw }, mapping, variant(), 10).price,
      expected,
    );
  for (const n of ["", "-1", "1.234", "1x23", "1e2", "NaN", "1000000001"])
    assert.throws(() =>
      actions.setPrice.preview({ Price: n }, mapping, variant(), 10),
    );
});
test("preview snapshots stock and prices and marks no change/unmatched rows", () => {
  const result = preview(
    [{ SKU: "001" }, { SKU: "missing" }],
    mapping,
    "soldOut",
    [variant()],
    "loc",
  );
  assert.equal(result[0].previousQty, 10);
  assert.equal(result[0].newQty, 0);
  assert.equal(result[0].previousPrice, "12.00");
  assert.equal(result[0].rowIndex, 2);
  assert.equal(result[1].status, "unmatched");
  assert.equal(
    preview(
      [{ SKU: "001", Quantity: "10" }],
      mapping,
      "setQuantity",
      [variant()],
      "loc",
    )[0].status,
    "no_change",
  );
  assert.equal(
    preview(
      [{ SKU: "001", Price: "12" }],
      mapping,
      "setPrice",
      [variant()],
      "loc",
    )[0].status,
    "no_change",
  );
  assert.deepEqual(totals(result), {
    rows: 2,
    matched: 1,
    unmatched: 1,
    errors: 0,
    changing: 1,
    soldOut: 1,
  });
});
test("preview protects untracked/unstocked, invalid quantities and negative results", () => {
  for (const v of [variant({ tracked: false }), variant({ quantities: {} })]) {
    const p = preview([{ SKU: "001" }], mapping, "soldOut", [v], "loc")[0];
    assert.equal(p.status, "error");
  }
  for (const [action, value] of [
    ["setQuantity", "-1"],
    ["adjust", "-11"],
    ["adjust", "1000000000"],
    ["setQuantity", "bad"],
  ] as const) {
    assert.equal(
      preview(
        [{ SKU: "001", Quantity: value }],
        mapping,
        action,
        [variant()],
        "loc",
      )[0].status,
      "error",
    );
  }
  assert.equal(
    preview(
      [{ SKU: "001", Price: "13" }],
      mapping,
      "setPrice",
      [variant({ tracked: false, quantities: {} })],
      "loc",
    )[0].status,
    "matched",
  );
});
test("preview blocks every duplicate target even across fallback match keys", () => {
  const plans = preview(
    [{ SKU: "001" }, { Barcode: "000123" }],
    mapping,
    "adjust",
    [variant()],
    "loc",
  );
  assert.ok(
    plans.every(
      (p) => p.status === "error" && p.errorMessage?.includes("Duplicate"),
    ),
  );
  assert.equal(totals(plans).changing, 0);
});
test("mass-zero safeguard applies strictly above 80 percent", () => {
  assert.equal(requiresZeroAcknowledgement(80, 100), false);
  assert.equal(requiresZeroAcknowledgement(81, 100), true);
  assert.equal(requiresZeroAcknowledgement(0, 0), false);
});
test("undo restores a successful snapshot once and blocks newer changes", () => {
  const row = { applied: true, undone: false, previousQty: 10, newQty: 0 };
  assert.deepEqual(undoPlan(row, 0), { from: 0, to: 10 });
  assert.throws(() => undoPlan(row, 3), /Stock changed/);
  assert.throws(() => undoPlan({ ...row, applied: false }, 0), /not eligible/);
  assert.throws(() => undoPlan({ ...row, undone: true }, 0), /not eligible/);
  assert.throws(() => undoPlan({ ...row, previousQty: null }, 0), /snapshot/);
});
test("pipeline upload-preview-apply-undo fixture restores only changed variants", () => {
  const variants = [
    variant(),
    variant({
      variantId: "v2",
      inventoryItemId: "i2",
      sku: "002",
      quantities: { loc: 0 },
    }),
  ];
  const parsed = parseSheet(bytes("SKU\n001\n002\nmissing"), "weekly.csv");
  const plans = preview(
    parsed.rows,
    parsed.mapping,
    "soldOut",
    variants,
    "loc",
  );
  const inventory = new Map(
    variants.map((v) => [
      v.variantId,
      (v.quantities as Record<string, number>).loc,
    ]),
  );
  const changed = plans.filter((p) => p.status === "matched");
  assert.equal(changed.length, 1);
  for (const p of changed) inventory.set(p.variantId!, p.newQty!);
  assert.equal(inventory.get("v1"), 0);
  for (const p of changed) {
    const undo = undoPlan(
      {
        applied: true,
        undone: false,
        previousQty: p.previousQty,
        newQty: p.newQty,
      },
      inventory.get(p.variantId!)!,
    );
    inventory.set(p.variantId!, undo.to);
  }
  assert.deepEqual([...inventory.values()], [10, 0]);
});

test("each action delegates immutable planned changes to the supplied writer", async () => {
  const expected = {
    soldOut: "inventorySetQuantities",
    setQuantity: "inventorySetQuantities",
    adjust: "inventoryAdjustQuantities",
    setPrice: "productVariantsBulkUpdate",
  };
  for (const [name, plugin] of Object.entries(actions)) {
    const changes = preview(
      [{ SKU: "001", Quantity: "3", Price: "15.00" }],
      mapping,
      name as keyof typeof actions,
      [variant()],
      "loc",
    );
    const before = structuredClone(changes);
    const results = await plugin.apply(changes, async (mutation, received) => {
      assert.equal(mutation, expected[name as keyof typeof expected]);
      assert.strictEqual(received, changes);
      return received.map((row) => ({ rowIndex: row.rowIndex, success: true }));
    });
    assert.deepEqual(results, [{ rowIndex: 2, success: true }]);
    assert.deepEqual(changes, before);
  }
});
test("action apply propagates writer failures for the durable job to handle", async () => {
  const changes = preview([{ SKU: "001" }], mapping, "soldOut", [variant()], "loc");
  await assert.rejects(
    actions.soldOut.apply(changes, async () => { throw new Error("Shopify unavailable"); }),
    /Shopify unavailable/,
  );
});
