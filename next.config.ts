import type { NextConfig } from "next";

// `output: "standalone"` powers the local/bun production server (see package.json
// "start"). Netlify's Next runtime builds its own function bundles and does NOT
// want standalone output, so it is disabled when building on Netlify.
const nextConfig: NextConfig = {
  ...(process.env.NETLIFY ? {} : { output: "standalone" }),
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
