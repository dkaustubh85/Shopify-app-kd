export const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FORM_FIELDS = 32;
export const MAX_TEXT_FIELD_BYTES = 64 * 1024;
export const MAX_FIELD_NAME_LENGTH = 128;

// Measure the actual stream: a missing or dishonest Content-Length must not
// bypass the memory bound, including requests containing many small parts.
async function boundedBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(
          "The complete upload request must be 12 MB or smaller.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function fieldName(name: string) {
  if (name.length > MAX_FIELD_NAME_LENGTH)
    throw new Error("Form field names must be 128 characters or fewer.");
}

export async function readUploadForm(request: Request): Promise<FormData> {
  const bytes = await boundedBody(request);
  const type = request.headers.get("content-type")?.toLowerCase() || "";
  if (type.includes("multipart/form-data")) {
    // Bound entry count before the native parser allocates per-part objects.
    const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(
      request.headers.get("content-type") || "",
    );
    if (!boundary) throw new Error("Missing multipart boundary.");
    const marker = Buffer.from("--" + (boundary[1] || boundary[2]));
    const rawBytes = Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    let parts = 0;
    for (
      let pos = rawBytes.indexOf(marker);
      pos !== -1;
      pos = rawBytes.indexOf(marker, pos + marker.length)
    ) {
      if (pos !== 0 && !(rawBytes[pos - 2] === 13 && rawBytes[pos - 1] === 10))
        continue;
      const end = pos + marker.length;
      if (
        rawBytes[end] === 13 &&
        rawBytes[end + 1] === 10 &&
        ++parts > MAX_FORM_FIELDS
      )
        throw new Error("Use 32 form fields or fewer.");
    }
    let fields = 0;
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    const bounded = new Request(request.url, {
      method: request.method,
      headers,
      body: bytes,
      signal: request.signal,
    });
    const form = await bounded.formData();
    for (const [name, value] of form) {
      if (++fields > MAX_FORM_FIELDS)
        throw new Error("Use 32 form fields or fewer.");
      fieldName(name);
      if (
        typeof value === "string" &&
        new TextEncoder().encode(value).byteLength > MAX_TEXT_FIELD_BYTES
      )
        throw new Error("Text form fields must be 64 KB or smaller.");
      if (typeof value !== "string" && value.size > MAX_FILE_BYTES)
        throw new Error("Files must be 10 MB or smaller.");
    }
    return form;
  }
  if (!type.includes("application/x-www-form-urlencoded"))
    throw new Error("Send an upload form or URL-encoded form.");
  const raw = new TextDecoder().decode(bytes);
  // Count before URLSearchParams builds entries for a potentially hostile form.
  if (raw.split("&", MAX_FORM_FIELDS + 1).length > MAX_FORM_FIELDS)
    throw new Error("Use 32 form fields or fewer.");
  const form = new FormData();
  for (const [name, value] of new URLSearchParams(raw)) {
    fieldName(name);
    if (new TextEncoder().encode(value).byteLength > MAX_TEXT_FIELD_BYTES)
      throw new Error("Text form fields must be 64 KB or smaller.");
    form.append(name, value);
  }
  return form;
}
