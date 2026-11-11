/* eslint-disable no-control-regex -- Deliberately reject control characters in filenames. */
export function safeFilename(value: string, fallback = "stocksheet.xlsx") {
  const name = value
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return name || fallback;
}
export function attachmentName(disposition: string | null) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return safeFilename(decodeURIComponent(encoded));
    } catch {
      /* Use the ordinary filename below. */
    }
  }
  return safeFilename(
    disposition?.match(/filename="([^"]+)"/i)?.[1] || "stocksheet.xlsx",
  );
}
export async function fetchAttachment(
  url: string,
  idToken: () => Promise<string>,
  fetcher: typeof fetch = fetch,
) {
  if (!url.startsWith("/app/download?") || url.includes("#"))
    throw new Error("Choose a StockSheet download.");
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetcher(url, {
      headers: { Authorization: "Bearer " + (await idToken()) },
      credentials: "same-origin",
      redirect: "error",
    });
    if (response.status !== 401) break;
  }
  if (!response)
    throw new Error("The download could not start. Please try again.");
  if (!response.ok) {
    let detail = "";
    if (response.headers.get("content-type")?.includes("application/json")) {
      const body = await response.json();
      if (typeof body.error === "string") detail = body.error;
    }
    throw new Error(
      detail ||
        "The download could not start. Reopen StockSheet from Shopify and try again.",
    );
  }
  const type = response.headers.get("content-type") || "";
  if (!/spreadsheetml|application\/vnd\.ms-excel|text\/csv/.test(type))
    throw new Error(
      "Your sign-in expired. Reopen StockSheet from Shopify and try the download again.",
    );
  const blob = await response.blob();
  if (!blob.size)
    throw new Error("There are no rows to download for this selection.");
  return {
    blob,
    filename: attachmentName(response.headers.get("content-disposition")),
  };
}
