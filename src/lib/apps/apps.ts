import type { CrmApp } from "@/types";

/** localStorage key for the app the user is currently working on. */
export const ACTIVE_APP_STORAGE_KEY = "nixie-wa.active-app";

/** Sentinel for "all apps" — the unfiltered view. */
export const ALL_APPS = "all" as const;

export const APP_COLORS = [
  "#0ea5a4", // teal
  "#2563eb", // blue
  "#f59e0b", // turmeric
  "#ef4444", // red
  "#8b5cf6", // violet
  "#10b981", // green
  "#ec4899", // pink
  "#64748b", // slate
] as const;

/**
 * URL-safe slug matching the DB check `^[a-z0-9][a-z0-9-]{0,39}$`.
 * Non-latin names (e.g. Tamil) collapse to "" — callers fall back to a
 * generated slug in that case.
 */
export function slugifyAppName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidAppSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug);
}

/** `http(s)://…` with no whitespace, ≤500 chars — mirrors the DB check. */
export function isValidAppUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true; // optional
  if (trimmed.length > 500 || /\s/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Pick the stored active app if it still exists (and isn't archived);
 * otherwise "all". Guards against a deleted app lingering in storage.
 */
export function resolveActiveAppId(
  apps: readonly Pick<CrmApp, "id" | "archived_at">[],
  stored: string | null | undefined,
): string {
  if (!stored || stored === ALL_APPS) return ALL_APPS;
  return apps.some((a) => a.id === stored && !a.archived_at) ? stored : ALL_APPS;
}

/**
 * Black or white text for a hex background, by relative luminance, so
 * an app chip stays readable whatever colour the admin picked.
 */
export function readableTextOn(hex: string): "#ffffff" | "#0b1f22" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return lum > 0.4 ? "#0b1f22" : "#ffffff";
}

/** First grapheme-ish letter for an app without an icon. */
export function appMonogram(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
}
