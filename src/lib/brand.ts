/**
 * Product branding, configurable per deployment without code changes.
 * Inlined at build time (NEXT_PUBLIC_*) — rebuild after changing.
 */
export const BRAND_NAME =
  (process.env.NEXT_PUBLIC_APP_NAME ?? "").trim() || "Nixie WA-CRM";

/** Short name for tight spots (browser tab suffix, mobile header). */
export const BRAND_SHORT =
  (process.env.NEXT_PUBLIC_APP_SHORT_NAME ?? "").trim() || "Nixie";

/** Company line shown on the sign-in screen. */
export const BRAND_COMPANY =
  (process.env.NEXT_PUBLIC_COMPANY_NAME ?? "").trim() || "Shiny Software Services";
