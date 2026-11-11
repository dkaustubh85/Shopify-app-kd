import "@shopify/shopify-api/adapters/node";
import { shopifyApi } from "@shopify/shopify-api";
import { PrismaClient } from "@prisma/client";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { devConfig } from "./dev-auth.mjs";
const db = new PrismaClient();
try {
  const shop = "kaustubhs-test-shop.myshopify.com";
  const storage = new PrismaSessionStorage(db);
  const saved = await storage.loadSession("offline_" + shop);
  if (!saved?.refreshToken)
    throw new Error(
      "Open the app in Shopify to establish a refreshable session.",
    );
  const config = devConfig();
  const api = shopifyApi({
    apiKey: config.SHOPIFY_API_KEY,
    apiSecretKey: config.SHOPIFY_API_SECRET,
    apiVersion: "2026-10",
    hostName: "localhost",
    isEmbeddedApp: true,
    logger: { level: 0 },
    future: { expiringOfflineAccessTokens: true },
  });
  const { session } = await api.auth.refreshToken({
    shop,
    refreshToken: saved.refreshToken,
  });
  await storage.storeSession(session);
  console.log("Development-store access refreshed. No credentials logged.");
} catch {
  console.error(
    "Unable to refresh development-store session; reopen the app inside Shopify.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
