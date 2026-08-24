import type { MetadataRoute } from "next";
import { isNonProductionEnvironment } from "@/lib/preview";

/*
 * Evaluated per request, not baked into the build.
 *
 * A build artifact can outlive the environment it was made for, and a
 * robots.txt that was decided at build time would keep saying whatever was
 * true then. The environment is asked at the moment it is answered.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (isNonProductionEnvironment()) {
    // A preview: fake prices, fake payments, disposable data. Nothing here
    // should appear in a search result for Afrinext.
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return { rules: { userAgent: "*", allow: "/" } };
}
