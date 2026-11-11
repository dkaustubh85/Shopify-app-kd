import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { devHeaders } from "./dev-auth.mjs";
const base = process.env.SMOKE_URL || "http://localhost:61617";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const user = String(Date.now()),
  headers = devHeaders(user),
  token = headers.authorization.slice(7);
const temp = mkdtempSync(join(tmpdir(), "stocksheet-browser-"));
const downloads = join(temp, "downloads");
mkdirSync(downloads);
const chrome = spawn(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-port=0",
    "--user-data-dir=" + temp,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label) {
  for (let i = 0; i < 100; i++) {
    try {
      if (await fn()) return;
    } catch {}
    await delay(150);
  }
  throw new Error("Timed out: " + label);
}
let ws;
const db = new PrismaClient();
let uploadId;
let templateId;
const errors = [];
try {
  await waitFor(() => {
    try {
      return readFileSync(join(temp, "DevToolsActivePort"), "utf8");
    } catch {
      return false;
    }
  }, "Chrome");
  const port = readFileSync(join(temp, "DevToolsActivePort"), "utf8").split(
    "\n",
  )[0];
  const [page] = await (
    await fetch("http://127.0.0.1:" + port + "/json/list")
  ).json();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let next = 0;
  const pending = new Map();
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  ws.addEventListener("message", async (event) => {
    const m = JSON.parse(event.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        m.error
          ? p.reject(new Error(JSON.stringify(m.error)))
          : p.resolve(m.result);
      }
      return;
    }
    if (m.method === "Runtime.exceptionThrown")
      errors.push(
        (
          m.params.exceptionDetails.exception?.description ||
          m.params.exceptionDetails.text
        ).replaceAll(token, "[redacted]"),
      );
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      try {
        if (
          request.url.includes("cdn.shopify.com/shopifycloud/app-bridge.js") ||
          request.url.includes("cdn.shopify.com/shopifycloud/polaris-")
        )
          await call("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: "Content-Type", value: "application/javascript" },
            ],
            body: Buffer.from(
              "/* Shopify host simulated for local browser QA. */",
            ).toString("base64"),
          });
        else if (new URL(request.url).origin === new URL(base).origin)
          await call("Fetch.continueRequest", {
            requestId,
            headers: [
              ...Object.entries(request.headers)
                .filter(([k]) => k.toLowerCase() !== "authorization")
                .map(([name, value]) => ({ name, value })),
              { name: "Authorization", value: headers.authorization },
            ],
          });
        else await call("Fetch.continueRequest", { requestId });
      } catch (e) {
        errors.push("Request interception failed");
      }
    }
  });
  await call("Network.setUserAgentOverride", {
    userAgent: headers["User-Agent"],
  });
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source:
      "window.shopify={idToken:async()=>" +
      JSON.stringify(token) +
      ',toast:{show:()=>{},hide:()=>{}},loading:()=>{},config:{apiKey:"test",shop:"kaustubhs-test-shop.myshopify.com"}};',
  });
  await call("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
  });
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  async function evaluate(expression) {
    const r = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  async function text() {
    return evaluate("document.body.innerText");
  }
  async function click(label) {
    const ok = await evaluate(
      '(()=>{const e=[...document.querySelectorAll("button,a")].find(e=>e.textContent.trim()===' +
        JSON.stringify(label) +
        " && e.getBoundingClientRect().width && !e.disabled);if(e){e.click();return true;}return false;})()",
    );
    assert.ok(ok, "Clickable " + label);
  }
  async function contains(value) {
    try {
      await waitFor(async () => (await text()).includes(value), value);
    } catch (e) {
      console.log((await text()).slice(0, 1500));
      console.log(errors);
      await screenshot("failure");
      throw e;
    }
  }
  async function screenshot(name) {
    mkdirSync("docs/verification", { recursive: true });
    const r = await call("Page.captureScreenshot", { format: "png" });
    writeFileSync(
      "docs/verification/" + name + ".png",
      Buffer.from(r.data, "base64"),
    );
  }
  await call("Page.navigate", { url: base + "/app" });
  await contains("Step 1 of 6");
  await screenshot("guide");
  await click("Download sample Excel");
  await waitFor(
    () => readdirSync(downloads).some((f) => f.endsWith(".xlsx")),
    "sample XLSX download",
  );
  assert.equal(
    readFileSync(
      join(
        downloads,
        readdirSync(downloads).find((f) => f.endsWith(".xlsx")),
      ),
    )
      .subarray(0, 2)
      .toString(),
    "PK",
  );
  console.log("PASS browser sample Excel download");
  await click("Next");
  await contains("Step 2 of 6");
  await delay(500);
  await click("Back");
  await contains("Step 1 of 6");
  await delay(500);
  for (let i = 2; i <= 6; i++) {
    await click("Next");
    await contains("Step " + i + " of 6");
    await delay(600);
  }
  await click("Start my first upload");
  await waitFor(
    () =>
      evaluate(
        'location.pathname==="/app/upload"&&!document.body.innerText.includes("Step 6 of 6")',
      ),
    "finish guide",
  );
  await call("Page.reload");
  await contains("Choose a spreadsheet");
  assert.ok(!(await text()).includes("Your first upload, step by step"));
  console.log("PASS guide Next, Back, completion and persistence");
  await click("Getting started");
  await contains("Step 1 of 6");
  await click("Skip for now");
  await waitFor(
    () => evaluate('!document.querySelector("[role=dialog]")'),
    "guide dismissed",
  );
  const fixture = join(temp, "browser-qa-" + user + ".csv"),
    bytes = Buffer.from("SKU,Quantity\r\nBROWSER-QA-NOT-A-SKU,3\r\n");
  writeFileSync(fixture, bytes);
  const doc = await call("DOM.getDocument");
  const input = await call("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: "input[type=file]",
  });
  assert.ok(input.nodeId);
  await call("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: [fixture],
  });
  try {
    await waitFor(
      () => evaluate('new URL(location.href).searchParams.has("id")'),
      "uploaded CSV",
    );
  } catch (e) {
    console.log((await text()).slice(-2500));
    console.log(errors);
    await screenshot("upload-failure");
    throw e;
  }
  uploadId = await evaluate('new URL(location.href).searchParams.get("id")');
  console.log("PASS browser file upload");
  await call("Page.navigate", { url: base + "/app/history/" + uploadId });
  await contains("Download original sheet");
  await click("Download original sheet");
  await waitFor(
    () => readdirSync(downloads).some((f) => f.endsWith(".csv")),
    "original download",
  );
  assert.deepEqual(
    readFileSync(
      join(
        downloads,
        readdirSync(downloads).find((f) => f.endsWith(".csv")),
      ),
    ),
    bytes,
  );
  console.log("PASS history original bytes");
  await screenshot("history");
  for (const route of [
    "",
    "/upload",
    "/templates",
    "/history",
    "/export",
    "/settings",
    "/help",
  ]) {
    await call("Page.navigate", { url: base + "/app" + route });
    await contains("Getting started");
    await delay(900);
    assert.ok(!(await text()).includes("Unexpected Server Error"));
    console.log("PASS browser route /app" + route);
  }

  async function fill(label, value) {
    assert.ok(
      await evaluate(
        '(()=>{const label=[...document.querySelectorAll("label")].find(e=>e.textContent.includes(' +
          JSON.stringify(label) +
          '));const input=label&&document.getElementById(label.htmlFor);if(!input)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,' +
          JSON.stringify(value) +
          ');input.dispatchEvent(new Event("input",{bubbles:true}));return true;})()',
      ),
    );
  }
  await call("Page.navigate", { url: base + "/app/settings" });
  await contains("Low-stock threshold");
  await delay(600);
  await fill("Low-stock threshold", "-1");
  await click("Save settings");
  await contains("Use a non-negative whole-number threshold.");
  console.log("PASS settings rejects invalid values");
  await call("Page.navigate", { url: base + "/app/export" });
  await contains("Download Excel");
  await delay(600);
  const beforeExports = readdirSync(downloads).filter((f) =>
    f.endsWith(".xlsx"),
  ).length;
  await click("Download Excel");
  await waitFor(
    () =>
      readdirSync(downloads).filter((f) => f.endsWith(".xlsx")).length >
      beforeExports,
    "inventory export",
  );
  console.log("PASS browser inventory export");
  const template = await db.template.create({
    data: {
      shopId: "kaustubhs-test-shop.myshopify.com",
      name: "Browser QA " + user,
      mapping: { sku: "SKU" },
    },
  });
  templateId = template.id;
  await call("Page.navigate", { url: base + "/app/templates" });
  await contains("Browser QA " + user);
  await delay(600);
  async function templateClick(label) {
    assert.ok(
      await evaluate(
        '(()=>{const h=[...document.querySelectorAll("h2")].find(e=>e.textContent.includes(' +
          JSON.stringify(user) +
          '));let p=h;while(p&&!p.querySelector("button"))p=p.parentElement;const b=p&&[...p.querySelectorAll("button")].find(e=>e.textContent.trim()===' +
          JSON.stringify(label) +
          ");if(b){b.click();return true;}return false;})()",
      ),
    );
  }
  await templateClick("Rename");
  await contains("Rename template");
  await fill("Template name", "Renamed QA " + user);
  await click("Save");
  await contains("Renamed QA " + user);
  console.log("PASS template rename");
  await templateClick("Delete");
  await contains("Delete this template?");
  await click("Delete template");
  await waitFor(
    async () => !(await db.template.findUnique({ where: { id: templateId } })),
    "template deletion",
  );
  console.log("PASS template deletion");

  const appErrors = errors.filter(
    (e) =>
      !(
        e.startsWith("Error: WebSocket closed without opened.") &&
        e.includes("/@vite/client:")
      ),
  );
  console.log(
    "Development-only Vite HMR connection warnings:",
    errors.length - appErrors.length,
  );
  assert.deepEqual(appErrors, []);
  console.log(
    "PASS no browser runtime exceptions. Shopify host simulated; app routes and downloads are real.",
  );
} finally {
  if (ws?.readyState === 1) ws.close();
  chrome.kill();
  if (uploadId)
    await db.upload.deleteMany({
      where: {
        id: uploadId,
        shopId: "kaustubhs-test-shop.myshopify.com",
        fileName: "browser-qa-" + user + ".csv",
      },
    });
  if (templateId)
    await db.template.deleteMany({
      where: { id: templateId, shopId: "kaustubhs-test-shop.myshopify.com" },
    });
  await db.userGuide.deleteMany({
    where: { shopId: "kaustubhs-test-shop.myshopify.com", userId: user },
  });
  await db.$disconnect();
}
