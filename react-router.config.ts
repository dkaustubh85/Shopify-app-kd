import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Render terminates HTTPS before forwarding HTTP to react-router-serve.
  // Permit only our public app host; keep foreign-origin action checks enabled.
  allowedActionOrigins: ["stocksheet-web.onrender.com"],
} satisfies Config;
