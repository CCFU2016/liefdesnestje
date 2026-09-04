import type { MetadataRoute } from "next";

// A private household app: nothing here should be indexed or discoverable.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
