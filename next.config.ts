import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Baseline security headers applied to every response.
 *
 * CSP ships as `Content-Security-Policy-Report-Only` so the browser
 * surfaces violations in the console without blocking anything — once
 * we have confidence nothing legit trips it (two deploys, a pass on
 * every route), flip the key to `Content-Security-Policy` to enforce.
 *
 * The rest of the headers are straight blocks, safe to enforce today:
 *   - HSTS: only meaningful on HTTPS (no-op on http://localhost).
 *   - X-Content-Type-Options / X-Frame-Options / Referrer-Policy:
 *     baseline OWASP hardening, no behavioural cost.
 *   - Permissions-Policy: we don't use camera / microphone / etc, so
 *     deny them. A supply-chain compromise or a forgotten plugin
 *     can't silently opt back in.
 */
/**
 * Supabase origin for CSP. `*.supabase.co` covers hosted projects; a
 * custom Supabase domain (or self-hosted Supabase) is picked up from
 * NEXT_PUBLIC_SUPABASE_URL so enforcing the CSP never cuts the app off
 * from its own database.
 */
function supabaseOrigins(): { http: string; ws: string } {
  const fallback = { http: "https://*.supabase.co", ws: "wss://*.supabase.co" };
  try {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!raw) return fallback;
    const url = new URL(raw);
    if (url.hostname.endsWith(".supabase.co")) return fallback;
    const wsProtocol = url.protocol === "http:" ? "ws:" : "wss:";
    return {
      http: `${fallback.http} ${url.origin}`,
      ws: `${fallback.ws} ${wsProtocol}//${url.host}`,
    };
  } catch {
    return fallback;
  }
}

const SUPABASE = supabaseOrigins();

/**
 * The CSP is ENFORCED by default in this fork. Set CSP_REPORT_ONLY=true
 * (and redeploy) to fall back to report-only while debugging a blocked
 * resource — the browser console then lists violations without
 * breaking the page.
 */
const CSP_HEADER_KEY =
  process.env.CSP_REPORT_ONLY === "true"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Private CRM: tell every crawler not to index, follow, cache or
  // snippet anything — applies to HTML, API JSON and static files alike,
  // so even a leaked URL stays out of search results.
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet, noimageindex",
  },
  // Isolate the browsing context from cross-origin popups/openers.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  {
    // Microphone is allowed for same-origin (`self`) so the inbox
    // composer can record voice notes via MediaRecorder. Everything
    // else stays denied — a compromised dependency can't silently grab
    // the camera / geolocation / etc.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  {
    key: CSP_HEADER_KEY,
    value: [
      "default-src 'self'",
      // Next.js needs 'unsafe-inline' for its inline hydration script
      // and 'unsafe-eval' in dev + some production optimisations.
      // Nonce-based CSP is a later project.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Tailwind + inline style attributes on lots of components.
      "style-src 'self' 'unsafe-inline'",
      // Supabase public-bucket avatars, contact avatars (arbitrary
      // https URLs paste-able from the UI), OG images, data URLs for
      // tiny inline assets.
      "img-src 'self' data: blob: https:",
      // Outbound media previews (blob: from MediaRecorder + file picker)
      // and Supabase public-bucket audio/video the inbox renders.
      `media-src 'self' blob: ${SUPABASE.http}`,
      // Voice-note recorder (opus-recorder) spins up a worker.
      "worker-src 'self' blob:",
      "object-src 'none'",
      "font-src 'self' data:",
      // Supabase REST + realtime (WSS). All Meta API calls happen
      // server-side, so graph.facebook.com does not belong here.
      `connect-src 'self' ${SUPABASE.http} ${SUPABASE.ws}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
] as const;

const APP_LOCALE = ["en", "pt", "es", "ko"].includes(process.env.NEXT_PUBLIC_APP_LOCALE ?? "")
  ? (process.env.NEXT_PUBLIC_APP_LOCALE as string)
  : "en";

const nextConfig: NextConfig = {
  // Don't advertise the framework in an `X-Powered-By` header.
  poweredByHeader: false,
  turbopack: {
    resolveAlias: {
      "@app-messages": `./messages/${APP_LOCALE}.json`,
    },
  },
  // Emit a self-contained server bundle (.next/standalone) so the
  // Docker image can run without node_modules or the Next CLI.
  // Harmless outside Docker: `next start` keeps working as before.
  output: "standalone",
  experimental: {
    turbopackPluginRuntimeStrategy: "workerThreads",
    // Shared build hosts (Hostinger) report the machine's full core count
    // (64) while capping threads per container, so `next build` spawning
    // 63 page-data workers aborts with "OS can't spawn worker thread".
    // Cap the worker pool; override with NEXT_BUILD_CPUS on bigger hosts.
    cpus: Number(process.env.NEXT_BUILD_CPUS) || 4,
  },
  // Stop `next dev` from overwriting the repo's hand-written AGENTS.md.
  agentRules: false,

  /**
   * Cross-origin dev access (Next.js 16).
   *
   * Next 16 blocks requests to dev-only resources (`/_next/*` internals,
   * the HMR websocket, the dev overlay) unless the browser's Origin is
   * the host the dev server booted on — `localhost` by default. Tunnels
   * like ngrok serve the app from a public HTTPS host, so without
   * allow-listing that host those dev requests come back 403: HMR stops
   * working and the dev session degrades over the tunnel (issue #365).
   *
   * Wildcards match subdomains only (Next's CSRF matcher), so the
   * randomised tunnel subdomain is covered. Add any other host via
   * `ALLOWED_DEV_ORIGINS` (comma-separated). This key is dev-only and
   * has no effect on a production build.
   */
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
    "*.trycloudflare.com",
    "*.loca.lt",
    ...(process.env.ALLOWED_DEV_ORIGINS
      ? process.env.ALLOWED_DEV_ORIGINS.split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      : []),
  ],

  /**
   * Cache-Control policy.
   *
   * Why this exists:
   *   Hostinger's CDN was applying `s-maxage=31536000` (1 year) to
   *   prerendered HTML pages by default. When a new deploy shipped
   *   fresh Turbopack chunk hashes, the edge kept serving year-old
   *   HTML referencing chunk filenames that no longer existed on
   *   disk — result: HTML 200, every /_next/static/*.js and .css
   *   came back 404, the page rendered unstyled. Private/incognito
   *   did nothing because the cache is server-side.
   *
   * Strategy:
   *   - /_next/static/* — leave to Next. Turbopack dev chunks can go
   *     stale if we force immutable caching here; Next already emits
   *     the correct production headers for hashed assets.
   *   - /api/*          — no-store. API responses are per-user and
   *     must never be shared across requests at the edge.
   *
   * Security headers are appended via a separate catch-all rule
   * below — Next.js merges headers from every matching rule, so
   * they apply to every response regardless of which cache rule
   * matched.
   */
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/:path((?!_next/static|_next/image|api).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store",
          },
        ],
      },
      {
        // Security headers on every response, including /_next/static
        // assets (nosniff matters there) and /api/* (HSTS + referrer-
        // policy don't hurt).
        source: "/:path*",
        headers: [...SECURITY_HEADERS],
      },
      {
        // `/:path*` does not match the bare root in every matcher mode;
        // the root (which redirects to /dashboard) gets the same set.
        source: "/",
        headers: [...SECURITY_HEADERS],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
