import type { NextConfig } from "next";

const API_ORIGIN =
  (process.env.LARAVEL_API_ORIGIN || process.env.NEXT_PUBLIC_API_URL || "")
    .trim()
    .replace(/\/api\/?$/, "")
    .replace(/\/+$/, "") || "http://127.0.0.1:8000";

const nextLibConstants = "./node_modules/next/dist/lib/constants.js";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  reactStrictMode: true,
  // PostHog ingest paths are trailing-slash sensitive.
  skipTrailingSlashRedirect: true,
  turbopack: {
    resolveAlias: {
      "next/dist/esm/lib/constants": nextLibConstants,
    },
  },
  async redirects() {
    return [{ source: "/design", destination: "/", permanent: false }];
  },
  async rewrites() {
    return [
      // `/api/marketplace/*` is handled by `app/api/marketplace/[[...path]]/route.ts` so we can forward
      // `X-Forwarded-For` and Laravel can resolve the browser IP (`$request->ip()`).
      { source: "/api/image-proxy", destination: `${API_ORIGIN}/api/image-proxy` },
      { source: "/storage/:path*", destination: `${API_ORIGIN}/storage/:path*` },
      { source: "/files/:path*", destination: `${API_ORIGIN}/files/:path*` },
      { source: "/vista-files/:path*", destination: `${API_ORIGIN}/vista-files/:path*` },
      // PostHog EU reverse proxy — same-origin ingest avoids ad blockers.
      { source: "/ingest/static/:path*", destination: "https://eu-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/:path*", destination: "https://eu.i.posthog.com/:path*" },
    ];
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "next/dist/esm/lib/constants": nextLibConstants,
    };
    return config;
  },
};

export default nextConfig;
