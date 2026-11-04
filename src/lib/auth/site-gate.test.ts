import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_FAILURES,
  checkSiteGate,
  isGateExempt,
  resetSiteGateFailures,
} from "./site-gate";

const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

function req(path: string, auth?: string, ip = "203.0.113.7") {
  const headers = new Headers({ "x-real-ip": ip });
  if (auth) headers.set("authorization", auth);
  return new Request(`https://crm.example.com${path}`, { headers });
}

beforeEach(() => {
  process.env.SITE_GATE_USER = "owner";
  process.env.SITE_GATE_PASSWORD = "correct-horse-battery-staple";
  resetSiteGateFailures();
});

afterEach(() => {
  delete process.env.SITE_GATE_USER;
  delete process.env.SITE_GATE_PASSWORD;
});

describe("site gate", () => {
  it("is a no-op when not configured", async () => {
    delete process.env.SITE_GATE_PASSWORD;
    expect(await checkSiteGate(req("/login"), "/login")).toBeNull();
  });

  it("challenges a request without credentials", async () => {
    const res = await checkSiteGate(req("/login"), "/login");
    expect(res?.status).toBe(401);
    expect(res?.headers.get("www-authenticate")).toMatch(/^Basic /);
    expect(res?.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("lets the right credentials through", async () => {
    const res = await checkSiteGate(
      req("/dashboard", basic("owner", "correct-horse-battery-staple")),
      "/dashboard",
    );
    expect(res).toBeNull();
  });

  it("rejects a wrong password", async () => {
    const res = await checkSiteGate(req("/login", basic("owner", "nope")), "/login");
    expect(res?.status).toBe(401);
  });

  it("guards static assets too", async () => {
    const path = "/_next/static/chunks/app.js";
    expect((await checkSiteGate(req(path), path))?.status).toBe(401);
  });

  it.each([
    "/api/whatsapp/webhook",
    "/api/automations/cron",
    "/api/flows/cron",
    "/api/v1/contacts",
    "/robots.txt",
  ])("exempts machine endpoint %s", async (path) => {
    expect(isGateExempt(path)).toBe(true);
    expect(await checkSiteGate(req(path), path)).toBeNull();
  });

  it("does not exempt look-alike paths", () => {
    expect(isGateExempt("/api/whatsapp/send")).toBe(false);
    expect(isGateExempt("/api/v1")).toBe(false);
  });

  it("locks an IP out after repeated failures, even with the right password", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      await checkSiteGate(req("/login", basic("owner", `guess-${i}`)), "/login");
    }
    const locked = await checkSiteGate(
      req("/login", basic("owner", "correct-horse-battery-staple")),
      "/login",
    );
    expect(locked?.status).toBe(429);
    expect(locked?.headers.get("retry-after")).toBeTruthy();

    // Other IPs are unaffected.
    const other = await checkSiteGate(
      req("/login", basic("owner", "correct-horse-battery-staple"), "198.51.100.1"),
      "/login",
    );
    expect(other).toBeNull();
  });
});
