import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source rather than build output, so the
  // app compiles them itself. One less build step, and stack traces point at
  // the real source.
  transpilePackages: ["@afrinext/core", "@afrinext/db", "@afrinext/ui", "@afrinext/i18n"],
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  typedRoutes: true,
};

export default nextConfig;
