import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL(".", import.meta.url));

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  outputFileTracingRoot: webRoot,
  turbopack: { root: webRoot },
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    // Production traffic goes through Caddy; only next dev uses this local API bridge.
    if (process.env.NODE_ENV !== "development") return [];
    const api = (process.env.DEV_API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
    return [
      { source: "/api/v1/:path*", destination: `${api}/api/v1/:path*` },
      { source: "/healthz", destination: `${api}/healthz` },
    ];
  },
};
export default config;
