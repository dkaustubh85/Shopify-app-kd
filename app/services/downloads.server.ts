import db from "../db.server.ts";
import { workbookBytes, csv } from "../pipeline/parsers/sheet.ts";
import { safeFilename } from "../utils/download.ts";
import type { SheetRow } from "../pipeline/types.ts";
export const EXCEL_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export function fileType(name: string) {
  return /\.csv$/i.test(name)
    ? "text/csv; charset=utf-8"
    : /\.xls$/i.test(name)
      ? "application/vnd.ms-excel"
      : EXCEL_TYPE;
}
export function attachment(
  bytes: Uint8Array | string,
  name: string,
  type = EXCEL_TYPE,
) {
  const safe = safeFilename(name);
  return new Response(
    typeof bytes === "string" ? bytes : new Uint8Array(bytes),
    {
      headers: {
        "Content-Type": type,
        "Content-Disposition":
          'attachment; filename="' +
          safe.replace(/[^\x20-\x7e]/g, "_") +
          "\"; filename*=UTF-8''" +
          encodeURIComponent(safe),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export async function historyDownload(
  shop: string,
  id: string,
  kind: "upload" | "results" | "unmatched",
) {
  const upload = await db.upload.findFirst({ where: { id, shopId: shop } });
  if (!upload)
    return Response.json({ error: "Upload not found." }, { status: 404 });
  if (kind === "upload") {
    const original = await db.uploadFile.findUnique({
      where: { uploadId: id },
    });
    if (original)
      return attachment(original.contents, upload.fileName, original.mimeType);
  }
  const rows = await db.uploadRow.findMany({
    where: {
      uploadId: id,
      ...(kind === "unmatched"
        ? { status: { in: ["unmatched", "error", "undo_conflict"] } }
        : {}),
    },
    orderBy: { rowIndex: "asc" },
  });
  const stem = upload.fileName.replace(/\.[^.]+$/, "");
  if (kind === "upload")
    return attachment(
      workbookBytes(rows.map((r) => r.source as SheetRow)),
      stem + "-rebuilt.xlsx",
    );
  if (kind === "results")
    return attachment(
      csv(
        rows.map((r) => ({
          ...(r.source as SheetRow),
          "StockSheet row": String(r.rowIndex),
          "StockSheet status": r.status,
          "Previous quantity": String(r.previousQty ?? ""),
          "New quantity": String(r.newQty ?? ""),
          "Previous price": r.previousPrice ?? "",
          "New price": r.newPrice ?? "",
          "StockSheet error": r.errorMessage || "",
        })),
      ),
      stem + "-results.csv",
      "text/csv; charset=utf-8",
    );
  // Return a useful header-only CSV when every row matched.
  const contents = rows.length
    ? csv(
        rows.map((r) => ({
          ...(r.source as SheetRow),
          "StockSheet error": r.errorMessage || r.status,
        })),
      )
    : '"StockSheet error"\r\n';
  return attachment(
    contents,
    stem + "-unmatched.csv",
    "text/csv; charset=utf-8",
  );
}
