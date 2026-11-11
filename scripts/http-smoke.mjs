import assert from "node:assert/strict";
import { devHeaders } from "./dev-auth.mjs";
const base = process.env.SMOKE_URL || "http://localhost:60841";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
  throw new Error("HTTP smoke tests require a loopback origin.");
const headers = devHeaders();
for (const route of [
  "/app",
  "/app/upload",
  "/app/templates",
  "/app/history",
  "/app/export",
  "/app/settings",
  "/app/help",
]) {
  const response = await fetch(base + route, {
    headers: headers,
    redirect: "manual",
  });
  const text = await response.text();
  assert.equal(
    response.status,
    200,
    route + " should render; got " + response.status,
  );
  assert.ok(
    !text.includes("Unexpected Server Error"),
    route + " should not have an error boundary",
  );
  console.log("PASS authenticated SSR", route);
}
for (const kind of ["sample", "export"]) {
  const response = await fetch(
    base +
      "/app/download?kind=" +
      kind,
    { headers: headers },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /spreadsheetml/);
  assert.ok((await response.arrayBuffer()).byteLength > 100);
  console.log("PASS Excel download", kind);
}
const protectedWorker = await fetch(base + "/worker", { method: "POST" });
assert.equal(protectedWorker.status, 401);
console.log("PASS worker rejects unauthorized requests");

const privacy = await fetch(base + '/webhooks/privacy', {method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Topic':'shop/redact','X-Shopify-Shop-Domain':'invalid-test.myshopify.com','X-Shopify-Hmac-Sha256':'invalid'},body:'{}'});
assert.equal(privacy.status,401);console.log('PASS privacy webhook rejects invalid signatures');
