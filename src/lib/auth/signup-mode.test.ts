import { describe, expect, it } from "vitest";
import { isSignupAllowed, parseSignupMode } from "./signup-mode";

describe("parseSignupMode", () => {
  it("defaults to closed for empty or unknown values", () => {
    expect(parseSignupMode(undefined)).toBe("closed");
    expect(parseSignupMode("")).toBe("closed");
    expect(parseSignupMode("yes")).toBe("closed");
  });

  it("accepts known values case-insensitively", () => {
    expect(parseSignupMode("OPEN")).toBe("open");
    expect(parseSignupMode(" invite ")).toBe("invite");
    expect(parseSignupMode("closed")).toBe("closed");
  });
});

describe("isSignupAllowed", () => {
  it("never allows signup when closed, even with an invite", () => {
    expect(isSignupAllowed("closed", null)).toBe(false);
    expect(isSignupAllowed("closed", "tok")).toBe(false);
  });

  it("requires a non-empty invite token in invite mode", () => {
    expect(isSignupAllowed("invite", null)).toBe(false);
    expect(isSignupAllowed("invite", "  ")).toBe(false);
    expect(isSignupAllowed("invite", "tok")).toBe(true);
  });

  it("always allows signup when open", () => {
    expect(isSignupAllowed("open", null)).toBe(true);
  });
});
