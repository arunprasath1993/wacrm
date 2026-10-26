import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guideById, guideForPath, HELP_GUIDES, searchGuides } from "./guides";
import type { Bi } from "./types";

function allBi(): Array<[string, Bi]> {
  const out: Array<[string, Bi]> = [];
  for (const g of HELP_GUIDES) {
    out.push([`${g.id}.title`, g.title], [`${g.id}.summary`, g.summary]);
    g.sections.forEach((s, i) => {
      out.push([`${g.id}.s${i}.heading`, s.heading]);
      if (s.body) out.push([`${g.id}.s${i}.body`, s.body]);
      if (s.tip) out.push([`${g.id}.s${i}.tip`, s.tip]);
      (s.steps ?? []).forEach((x, j) => out.push([`${g.id}.s${i}.step${j}`, x]));
      (s.points ?? []).forEach((x, j) => out.push([`${g.id}.s${i}.point${j}`, x]));
    });
  }
  return out;
}

describe("help guides content", () => {
  it("has unique ids", () => {
    const ids = HELP_GUIDES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(allBi())("%s is written in both Tamil and English", (_path, bi) => {
    expect(bi.en.trim().length).toBeGreaterThan(0);
    expect(bi.ta.trim().length).toBeGreaterThan(0);
  });

  it("Tamil text actually contains Tamil script (not an English copy)", () => {
    for (const g of HELP_GUIDES) {
      expect(/[஀-௿]/.test(g.summary.ta), g.id).toBe(true);
    }
  });

  it("links only to guides that exist", () => {
    for (const g of HELP_GUIDES) {
      for (const r of g.related ?? []) expect(guideById(r), `${g.id} → ${r}`).toBeDefined();
    }
  });

  it("covers every dashboard page", () => {
    const dir = join(process.cwd(), "src/app/(dashboard)");
    const pages = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/${d.name}`)
      .filter((p) => p !== "/settings" && p !== "/help");
    for (const p of pages) {
      expect(guideForPath(p).route, p).toBe(p);
    }
  });
});

describe("guideForPath", () => {
  it("matches nested routes to their page guide", () => {
    expect(guideForPath("/broadcasts/new").id).toBe("broadcasts");
    expect(guideForPath("/automations/abc/edit").id).toBe("automations");
  });
  it("uses the settings tab", () => {
    expect(guideForPath("/settings", "apps").id).toBe("apps");
    expect(guideForPath("/settings", "whatsapp").id).toBe("whatsapp-connection");
  });
  it("falls back to getting started", () => {
    expect(guideForPath("/somewhere").id).toBe("getting-started");
    expect(guideForPath("/settings", "appearance").id).toBe("getting-started");
  });
});

describe("searchGuides", () => {
  it("finds guides by Tamil or English words", () => {
    expect(searchGuides("template").map((g) => g.id)).toContain("templates");
    expect(searchGuides("வாரியாக").length).toBeGreaterThan(0);
    expect(searchGuides("")).toHaveLength(HELP_GUIDES.length);
  });
});
