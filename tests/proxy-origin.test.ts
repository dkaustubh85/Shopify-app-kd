import test from "node:test";
import assert from "node:assert/strict";
import { createRequestHandler, type ServerBuild } from "react-router";
import config from "../react-router.config.ts";

function fixture(allowedActionOrigins: string[]) {
  let actionCalls = 0;
  const build = {
    mode: "production", ssr: true, basename: "/", publicPath: "/",
    assetsBuildDirectory: "build/client", future: {}, allowedActionOrigins, routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
    entry: { module: { default: () => new Response("document"), handleError() {} } },
    assets: { routes: {}, entry: { module: "" }, url: "", version: "test" },
    routes: {
      root: { id: "root", path: "", module: { default() { return null; } } },
      guide: { id: "guide", parentId: "root", path: "app/guide", module: {
        action() { actionCalls++; return { ok: true }; },
      } },
    },
  } as unknown as ServerBuild;
  const handler = createRequestHandler(build, "production");
  return {
    calls: () => actionCalls,
    submit: (origin: string) => handler(new Request("http://stocksheet-web.onrender.com/app/guide.data", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: "step=1&status=in_progress",
    })),
  };
}

test("Render HTTPS form submissions reach the action behind its HTTP proxy", async () => {
  const app = fixture(config.allowedActionOrigins);
  const response = await app.submit("https://stocksheet-web.onrender.com");
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(app.calls(), 1);
});

test("foreign origins cannot invoke actions behind the Render proxy", async () => {
  for (const origin of ["https://attacker.example", "https://stocksheet-web.onrender.com.attacker.example"]) {
    const app = fixture(config.allowedActionOrigins);
    const response = await app.submit(origin);
    assert.equal(response.status, 400);
    await response.text();
    assert.equal(app.calls(), 0);
  }
});

test("regression: the former configuration rejects valid Render submissions", async () => {
  const app = fixture([]);
  const response = await app.submit("https://stocksheet-web.onrender.com");
  assert.equal(response.status, 400);
  await response.text();
  assert.equal(app.calls(), 0);
});

