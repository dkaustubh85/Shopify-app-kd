import test from "node:test";
import assert from "node:assert/strict";
import {
  readUploadForm,
  MAX_REQUEST_BYTES,
  MAX_FILE_BYTES,
  MAX_FORM_FIELDS,
  MAX_TEXT_FIELD_BYTES,
} from "../app/pipeline/sources/upload.server.ts";

const url = "https://stocksheet.test/app/upload";
function encoded(body: string, headers: Record<string,string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}
function multipart(form: FormData) {
  return new Request(url, { method: "POST", body: form });
}
test("upload parser retains files and ordinary metadata", async () => {
  const body = new FormData();
  body.append("intent", "upload");
  body.append("file", new Blob(["SKU,Quantity\n001,0"]), "weekly.csv");
  const parsed = await readUploadForm(multipart(body));
  assert.equal(parsed.get("intent"), "upload");
  const file = parsed.get("file") as File;
  assert.equal(file.name, "weekly.csv");
  assert.equal(await file.text(), "SKU,Quantity\n001,0");
});
test("URL-encoded forms preserve Unicode, escaped mapping and duplicate entries", async () => {
  const parsed = await readUploadForm(encoded("intent=preview&name=Caf%C3%A9+stock&mapping=%7B%22sku%22%3A%22SKU%22%7D&x=1&x=2"));
  assert.equal(parsed.get("name"), "Café stock");
  assert.equal(parsed.get("mapping"), '{"sku":"SKU"}');
  assert.deepEqual(parsed.getAll("x"), ["1", "2"]);
});
test("actual streamed bytes exceed the limit even with a false Content-Length", async () => {
  let cancelled = false;
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { sent++; controller.enqueue(new Uint8Array(3*1024*1024)); },
    cancel() { cancelled = true; },
  });
  const request = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "1" },
    body,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(readUploadForm(request), /12 MB/);
  assert.equal(cancelled, true);
  assert.ok(sent <= 6, "the parser stops consuming the hostile stream promptly");
});
test("aggregate multipart bytes are bounded even when individual files are small enough", async () => {
  const form = new FormData();
  form.append("one", new Blob([new Uint8Array(7*1024*1024)]), "one.csv");
  form.append("two", new Blob([new Uint8Array(6*1024*1024)]), "two.csv");
  await assert.rejects(readUploadForm(multipart(form)), /12 MB/);
  assert.equal(MAX_REQUEST_BYTES, 12*1024*1024);
});
test("existing 10 MB file cap still applies within the total request limit", async () => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(MAX_FILE_BYTES + 1)]), "large.xlsx");
  await assert.rejects(readUploadForm(multipart(form)), /10 MB|64 KB/i);
});
test("multipart counts repeated field names and limits field name length", async () => {
  const form = new FormData();
  for (let i=0;i<MAX_FORM_FIELDS+1;i++) form.append("repeat", "x");
  await assert.rejects(readUploadForm(multipart(form)), /32 form fields/);
  const names = new FormData();
  names.append("a".repeat(129), "x");
  await assert.rejects(readUploadForm(multipart(names)), /128 characters/);
});
test("both form formats reject oversized text metadata", async () => {
  const form = new FormData();
  form.append("mapping", "a".repeat(MAX_TEXT_FIELD_BYTES+1));
  await assert.rejects(readUploadForm(multipart(form)), /10 MB|64 KB/i);
  await assert.rejects(readUploadForm(encoded("mapping="+"a".repeat(MAX_TEXT_FIELD_BYTES+1))), /64 KB/);
});
test("URL-encoded forms enforce count, byte-sized Unicode and name boundaries", async () => {
  await assert.rejects(readUploadForm(encoded(Array.from({length:33},()=>"x=a").join("&"))), /32 form fields/);
  await assert.rejects(readUploadForm(encoded("a".repeat(129)+"=x")), /128 characters/);
  await assert.rejects(readUploadForm(encoded("mapping="+encodeURIComponent("é".repeat(32769)))), /64 KB/);
  const parsed = await readUploadForm(encoded("mapping="+"a".repeat(MAX_TEXT_FIELD_BYTES)));
  assert.equal((parsed.get("mapping") as string).length, MAX_TEXT_FIELD_BYTES);
});
test("unsupported form types fail clearly", async () => {
  await assert.rejects(readUploadForm(new Request(url,{method:"POST",body:"{}","headers":{"content-type":"application/json"}})), /upload form/);
});
