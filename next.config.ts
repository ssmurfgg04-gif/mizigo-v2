import type { NextConfig } from "next";

// `output: "standalone"` powers the local/bun production server (see package.json
// "start"). Netlify's Next runtime builds its own function bundles and does NOT
// want standalone output, so it is disabled when building on Netlify.
const nextConfig: NextConfig = {
  ...(process.env.NETLIFY ? {} : { output: "standalone" }),
  // baked at build time so /api/bootstrap can report which commit is live
  // (Netlify provides COMMIT_REF; local builds report "dev")
  env: {
    BUILD_SHA: process.env.COMMIT_REF || process.env.BUILD_SHA || "dev",
  },
  // the build must never swallow type errors (tsc --noEmit is part of QA)
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  async headers() {
    // baseline security headers (also mirrored in netlify.toml)
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
      {
        key: "Content-Security-Policy",
        // sandbox demo: Next needs inline hydration scripts; eval only in dev
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https://basemaps.cartocdn.com https://*.tile.openstreetmap.org",
          "font-src 'self' data:",
          "connect-src 'self' https://basemaps.cartocdn.com",
          "worker-src 'self' blob:",
          "child-src 'self' blob:",
          "form-action 'self'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
        ].join("; "),
      },
    ];
    return [
      { source: "/:path*", headers: security },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
