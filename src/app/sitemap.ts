import { MetadataRoute } from "next";
import { db } from "@/lib/db";
// Content helpers are imported dynamically below to avoid build-time
// errors in environments where `@/lib/content` is not available or
// lacks type definitions. This keeps the sitemap generation resilient.

/*
  sitemap.ts

  Generates the sitemap for the site. This file follows the style of
  the example `sitemap_ex.ts` but adds explicit documentation for:
   - routes included
   - sitemap entry fields (priority, changefreq, lastmod)
   - base URL configuration via a config module or environment variable
   - dynamic routes (blog posts and projects) and how they are fetched
   - error handling for data fetching failures
   - URL ordering (homepage, high priority pages, then dynamic pages)

  Assumptions / decisions:
   - A `config` module is available at `@/lib/config` which exports
     `BASE_URL` and `LOCALES` (fallbacks use environment variables).
   - Dynamic content sources are `getAllPosts()` and `getAllProjects()`
     located in `@/lib/content` (these return arrays with `slug` and `date`).
   - If a data source fails, sitemap generation will continue with
     whatever routes could be resolved, and the error will be logged.
   - Each sitemap entry includes `url` and `lastModified` to satisfy
     Next.js MetadataRoute.Sitemap typing; additional fields `priority`
     and `changefreq` are included as comments (not part of the type),
     but we keep them in the returned objects for downstream sitemap
     generators that may consume them.

  Note: Next.js's built-in MetadataRoute.Sitemap expects objects shaped like
  { url: string; lastModified?: Date }. We return that shape, and attach
  optional fields (priority, changefreq) which can be used when serializing
  to XML outside of Next's helper. Keep lastModified as a Date instance.
*/

const BASE_URL = process.env.BASE_URL || "https://legistrack.vercel.app";
// This project does not use locales - single-root site.
const LOCALES: string[] = ["/"];

// Statically known top-level routes to include in the sitemap.
// Order here defines priority ordering in the output.
const STATIC_ROUTES: Array<{
  path: string;
  priority?: number;
  changefreq?: string;
}> = [
  { path: "/", priority: 1.0, changefreq: "daily" },
  { path: "/about", priority: 0.6, changefreq: "monthly" },
  // Add other static pages here as needed.
];

/**
 * Contract / shape for dynamic items returned from content helpers
 */
// (No content directory in this project; dynamic items are read from DB directly.)

/**
 * Helper to build a sitemap entry with fallback values.
 * We keep the returned value compatible with MetadataRoute.Sitemap
 * (url and lastModified) but also attach priority/changefreq for
 * potential XML serialization.
 */
function buildEntry(
  path: string,
  opts?: { priority?: number; changefreq?: string; lastmod?: Date | string }
) {
  const url = `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`.replace(
    /([^:])\/\/+/,
    "$1/"
  );
  const lastModified = opts?.lastmod ? new Date(opts.lastmod) : new Date();
  // Return type is intentionally loose to include optional fields.
  return {
    url,
    lastModified,
    // Optional metadata useful for external sitemap serializers
    priority: opts?.priority,
    changefreq: opts?.changefreq,
  } as unknown as MetadataRoute.Sitemap;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // We'll collect entries in the desired order:
  // 1) Root pages (homepage, bills list)
  // 2) Dynamic bill pages (/bills/[id])
  // 3) Dynamic executive order pages (/bills/eo/[id])
  const entries: Array<ReturnType<typeof buildEntry>> = [];

  try {
    // 1) Locale-root pages and top-level localized routes
    // If LOCALES uses ["/"] as default, we handle it as a single root.
    const locales = LOCALES.length ? LOCALES : ["/"];

    for (const locale of locales) {
      const normalizedLocale =
        locale === "/" ? "" : locale.replace(/^\/+|\/+$/g, "");
      // add homepage for locale
      entries.push(
        buildEntry(`/${normalizedLocale}` || "/", {
          priority: 1.0,
          changefreq: "daily",
        })
      );

      // add localized static routes
      for (const route of STATIC_ROUTES) {
        // skip root since we added it
        if (route.path === "/") continue;
        const path = `/${normalizedLocale}${route.path}`.replace(/\/\/+/, "/");
        entries.push(
          buildEntry(path, {
            priority: route.priority,
            changefreq: route.changefreq,
          })
        );
      }
    }

    // 2) Dynamic routes: fetch bills and executive orders from the DB
    // We'll fetch a reasonable number to include (e.g., the most recent 100 bills and EOs).
    let bills: Array<{ id: string; introducedDate?: Date }> = [];
    let eos: Array<{ id: string; signingDate?: Date }> = [];
    try {
      bills = await db.bill.findMany({
        take: 200,
        orderBy: [{ introducedDate: "desc" }],
        select: { id: true, introducedDate: true },
      });
    } catch (err) {
      console.error("sitemap: failed to fetch bills from db:", err);
      bills = [];
    }

    try {
      eos = await db.executiveOrder.findMany({
        take: 200,
        orderBy: [{ signingDate: "desc" }],
        select: { id: true, signingDate: true },
      });
    } catch (err) {
      console.error("sitemap: failed to fetch executive orders from db:", err);
      eos = [];
    }

    // Add root and bills list pages (no locales)
    entries.push(buildEntry("/", { priority: 1.0, changefreq: "daily" }));
    entries.push(buildEntry("/bills", { priority: 0.8, changefreq: "daily" }));

    // Add bill detail pages
    for (const bill of bills) {
      entries.push(
        buildEntry(`/bills/${bill.id}`, {
          lastmod: bill.introducedDate || new Date(),
          priority: 0.6,
          changefreq: "monthly",
        })
      );
    }

    // Add executive order pages under /bills/eo/[id]
    for (const eo of eos) {
      entries.push(
        buildEntry(`/bills/eo/${eo.id}`, {
          lastmod: eo.signingDate || new Date(),
          priority: 0.6,
          changefreq: "monthly",
        })
      );
    }

    // Optional: Deduplicate entries by URL while preserving order
    const seen = new Set<string>();
    const deduped = entries.filter((e) => {
      const entryUrl = (e as unknown as { url?: string }).url;
      if (!entryUrl) return false;
      if (seen.has(entryUrl)) return false;
      seen.add(entryUrl);
      return true;
    });

    // MetadataRoute.Sitemap is an array type; ensure we return the correct shape
    return deduped.map((e) => ({
      url: (e as unknown as { url: string }).url,
      lastModified: (e as unknown as { lastModified?: Date }).lastModified,
    })) as unknown as MetadataRoute.Sitemap;
  } catch (err) {
    // If something unexpected happens, we log and return a minimal sitemap
    // containing only the root. This prevents a hard failure in Next.js.
    console.error("sitemap: unexpected error while building sitemap:", err);
    return [
      {
        url: BASE_URL,
        lastModified: new Date(),
      },
    ];
  }
}
