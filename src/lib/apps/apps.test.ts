import { describe, expect, it } from "vitest";
import {
  ALL_APPS,
  appMonogram,
  isValidAppSlug,
  isValidAppUrl,
  readableTextOn,
  resolveActiveAppId,
  slugifyAppName,
} from "./apps";

describe("slugifyAppName", () => {
  it("turns names into DB-valid slugs", () => {
    expect(slugifyAppName("Nixie CRM")).toBe("nixie-crm");
    expect(slugifyAppName("  MoneyCtrl — Payments!! ")).toBe("moneyctrl-payments");
    expect(slugifyAppName("Café Pay")).toBe("cafe-pay");
    expect(isValidAppSlug(slugifyAppName("Nixie CRM"))).toBe(true);
  });

  it("returns empty for scripts it cannot transliterate", () => {
    expect(slugifyAppName("நிக்ஸி")).toBe("");
  });

  it("caps length at 40 without a trailing dash", () => {
    const slug = slugifyAppName("a".repeat(39) + " b");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
    expect(isValidAppSlug(slug)).toBe(true);
  });
});

describe("isValidAppUrl", () => {
  it("accepts http(s) and empty", () => {
    expect(isValidAppUrl("https://nixie.in")).toBe(true);
    expect(isValidAppUrl("")).toBe(true);
  });
  it("rejects other schemes and whitespace", () => {
    expect(isValidAppUrl("javascript:alert(1)")).toBe(false);
    expect(isValidAppUrl("https://a b.com")).toBe(false);
    expect(isValidAppUrl("ftp://x.com")).toBe(false);
  });
});

describe("resolveActiveAppId", () => {
  const apps = [
    { id: "a", archived_at: null },
    { id: "b", archived_at: "2026-01-01" },
  ];
  it("keeps a live stored app", () => expect(resolveActiveAppId(apps, "a")).toBe("a"));
  it("drops archived or missing apps", () => {
    expect(resolveActiveAppId(apps, "b")).toBe(ALL_APPS);
    expect(resolveActiveAppId(apps, "zzz")).toBe(ALL_APPS);
    expect(resolveActiveAppId(apps, null)).toBe(ALL_APPS);
  });
});

describe("readableTextOn", () => {
  it("uses dark text on light colours and white on dark ones", () => {
    expect(readableTextOn("#f59e0b")).toBe("#0b1f22");
    expect(readableTextOn("#2563eb")).toBe("#ffffff");
    expect(readableTextOn("nonsense")).toBe("#ffffff");
  });
});

describe("appMonogram", () => {
  it("returns the first letter, uppercased", () => {
    expect(appMonogram("nixie")).toBe("N");
    expect(appMonogram("")).toBe("?");
  });
});
