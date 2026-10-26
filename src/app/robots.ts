import type { MetadataRoute } from "next";

/**
 * Private CRM — nothing here is for search engines. Every crawler is
 * told to stay out of every path. Pages also carry `noindex` metadata
 * and every response carries an `X-Robots-Tag: noindex` header (see
 * next.config.ts), so a URL that leaks via an external link still
 * won't be indexed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
