import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "supabase", "migrations", "069_ad_analytics.sql");

function readMigration(): string {
  return existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
}

function functionBody(sql: string, functionName: string): string {
  const header = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`, "i");
  const start = sql.search(header);
  if (start < 0) throw new Error(`${functionName} is not defined in 069`);
  const bodyStart = sql.indexOf("$$", start);
  const bodyEnd = sql.indexOf("$$", bodyStart + 2);
  return sql.slice(bodyStart + 2, bodyEnd);
}

/** Drops `--` comments so prose can't satisfy (or break) a check. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

describe("migration 069_ad_analytics", () => {
  const sql = readMigration();
  const code = stripComments(sql);

  it("exists", () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it.each(["record_contact_touch", "recompute_contact_first_touch", "backfill_pre_existing_touches"])(
    "%s is internal: revoked from everyone, executable by service_role only",
    (fn) => {
      expect(code).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`),
      );
      expect(code).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
      expect(code).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO [^;]*authenticated`));
    },
  );

  it.each(["record_contact_touch", "recompute_contact_first_touch", "backfill_pre_existing_touches", "get_meta_ads_status"])(
    "%s is SECURITY DEFINER with a pinned search_path",
    (fn) => {
      const header = new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\([\\s\\S]*?security\\s+definer\\s+set\\s+search_path\\s*=\\s*public\\s+as\\s+\\$\\$`,
        "i",
      );
      expect(code).toMatch(header);
    },
  );

  it("record_contact_touch locks the contact row, scoped to the account", () => {
    expect(functionBody(code, "record_contact_touch")).toMatch(
      /from\s+contacts\s+where\s+id\s*=\s*p_contact_id\s+and\s+account_id\s*=\s*p_account_id\s+for\s+update/i,
    );
  });

  it("get_meta_ads_status never touches access_token and checks membership", () => {
    const body = functionBody(code, "get_meta_ads_status");
    expect(body).not.toMatch(/access_token/i);
    expect(body).not.toMatch(/select\s+\*/i);
    expect(body).toMatch(/is_account_member\s*\(\s*p_account_id\s*\)/i);
  });

  it("merge_duplicate_contacts repoints touches and recomputes the survivor", () => {
    const body = functionBody(code, "merge_duplicate_contacts");
    const repoint = body.search(/update\s+contact_touches\s+set\s+contact_id\s*=\s*v_survivor/i);
    const deleteLoser = body.search(/delete\s+from\s+contacts\s+where\s+id\s*=\s*any\s*\(\s*v_losers\s*\)/i);
    expect(repoint).toBeGreaterThan(-1);
    expect(deleteLoser).toBeGreaterThan(repoint);
    expect(body).toMatch(/recompute_contact_first_touch\s*\(\s*v_group\.account_id\s*,\s*v_survivor\s*\)/i);
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.merge_duplicate_contacts\(\) TO service_role;/);
  });

  it("enables row level security on every table it creates", () => {
    const created = [...code.matchAll(/create\s+table\s+if\s+not\s+exists\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual(["contact_touches", "meta_ad_entities", "meta_ad_insights_daily", "meta_ads_config"]);
    for (const table of created) {
      expect(code).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`));
    }
  });

  it("gives service-role-only tables no write policies", () => {
    for (const table of ["contact_touches", "meta_ad_entities", "meta_ad_insights_daily"]) {
      expect(code).not.toMatch(new RegExp(`CREATE POLICY \\w+ ON ${table} FOR (INSERT|UPDATE|DELETE|ALL)`, "i"));
      expect(code).toMatch(new RegExp(`CREATE POLICY \\w+ ON ${table} FOR SELECT USING \\(is_account_member\\(account_id\\)\\)`));
    }
  });

  it("restricts meta_ads_config (holds the token) to admins for every command", () => {
    for (const cmd of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(code).toMatch(
        new RegExp(`CREATE POLICY \\w+ ON meta_ads_config FOR ${cmd}[^;]*is_account_member\\(account_id, 'admin'\\)`),
      );
    }
  });

  it("guards DDL so it can be re-run", () => {
    expect(code).not.toMatch(/create\s+table\s+(?!if\s+not\s+exists)/i);
    expect(code).not.toMatch(/create\s+(unique\s+)?index\s+(?!if\s+not\s+exists)/i);
    expect(code).not.toMatch(/add\s+column\s+(?!if\s+not\s+exists)/i);
    const policies = [...code.matchAll(/CREATE POLICY (\w+) ON (\w+)/g)];
    for (const [, name, table] of policies) {
      expect(code).toContain(`DROP POLICY IF EXISTS ${name} ON ${table};`);
    }
  });

  it("ends by reloading the PostgREST schema cache", () => {
    expect(code.trim()).toMatch(/NOTIFY pgrst, 'reload schema';$/);
  });
});
