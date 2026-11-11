import { spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
export function devConfig() {
  const envResult = spawnSync(
    process.execPath,
    [
      "node_modules/@shopify/cli/bin/run.js",
      "app",
      "env",
      "show",
      "--no-color",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, SHOPIFY_CLI_NO_ANALYTICS: "1" },
    },
  );
  if (envResult.status !== 0)
    throw new Error("Shopify CLI could not read the linked app environment.");
  const config = {};
  for (const line of envResult.stdout.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z_]+)=(.*)$/);
    if (m) config[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  if (!config.SHOPIFY_API_KEY || !config.SHOPIFY_API_SECRET)
    throw new Error("App environment is incomplete. No secrets were logged.");
  return config;
}
export function devHeaders(userId = "0") {
  const config = devConfig();
  const now = Math.floor(Date.now() / 1000);
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned =
    encode({ alg: "HS256", typ: "JWT" }) +
    "." +
    encode({
      iss: "https://kaustubhs-test-shop.myshopify.com/admin",
      dest: "https://kaustubhs-test-shop.myshopify.com",
      aud: config.SHOPIFY_API_KEY,
      sub: String(userId),
      exp: now + 600,
      nbf: now - 10,
      iat: now,
      jti: randomUUID(),
      sid: randomUUID(),
    });
  const token =
    unsigned +
    "." +
    createHmac("sha256", config.SHOPIFY_API_SECRET)
      .update(unsigned)
      .digest("base64url");
  return {
    authorization: "Bearer " + token,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  };
}
