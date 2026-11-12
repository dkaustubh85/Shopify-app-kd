import type { Config } from "@react-router/dev/config";

// Shopify CLI supplies the current tunnel URL during app dev.
const appUrl = process.env.SHOPIFY_APP_URL || process.env.HOST;
const appHost = appUrl ? new URL(appUrl).host : undefined;

export default {
  ssr: true,
  // Proxies terminate HTTPS before forwarding HTTP to the app.
  // Trust our deployed host and the configured app host, including the dev tunnel.
  allowedActionOrigins: [
    "stocksheet-web.onrender.com",
    ...(appHost ? [appHost] : []),
  ],
} satisfies Config;
