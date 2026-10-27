import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// web/ lives inside the core repo: pin the workspace root so Next doesn't infer the parent lockfile.
const nextConfig: NextConfig = {
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  poweredByHeader: false,
  devIndicators: false,
};
export default nextConfig;
