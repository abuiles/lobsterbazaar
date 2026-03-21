import { describe, expect, it } from "vitest";

import { D1Repositories } from "../src/d1";

class RecordingStatement {
  readonly bindings: unknown[] = [];

  constructor(readonly sql: string) {}

  bind(...values: unknown[]) {
    this.bindings.length = 0;
    this.bindings.push(...values);
    return this;
  }

  async run() {
    return { success: true };
  }

  async first<T>() {
    if (this.sql.includes("FROM categories")) {
      return { supported: 1 } as T;
    }

    return null as T | null;
  }

  async all<T>() {
    return { results: [] as T[] };
  }
}

class RecordingDatabase {
  readonly prepared: RecordingStatement[] = [];
  readonly batches: RecordingStatement[][] = [];

  prepare(sql: string) {
    const statement = new RecordingStatement(sql);
    this.prepared.push(statement);
    return statement;
  }

  async batch(statements: RecordingStatement[]) {
    this.batches.push(statements);
    return [];
  }
}

describe("D1Repositories", () => {
  it("uses conflict updates instead of REPLACE for merchant upserts", async () => {
    const db = new RecordingDatabase();
    const repositories = new D1Repositories(db as unknown as D1Database);

    await repositories.putMerchant({
      slug: "claimed-roaster",
      displayName: "Claimed Roaster",
      storeUrl: "https://claimed-roaster.com",
      storeDomain: "claimed-roaster.myshopify.com",
      storefrontMcpUrl: "https://claimed-roaster.myshopify.com/api/mcp",
      countryCodes: ["US", "CA"],
      categorySlugs: ["coffee"],
      locationsSummary: "5+",
      notes: "Runs small seasonal releases.",
      tags: ["coffee"],
      claimContact: "ops@claimed-roaster.com",
      claimStatus: "claimed",
      verticalMetadata: {}
    });

    expect(db.batches).toHaveLength(1);
    const merchantStatement = db.batches[0]?.[0];
    expect(merchantStatement?.sql).toContain("INSERT INTO merchants");
    expect(merchantStatement?.sql).toContain("ON CONFLICT(slug) DO UPDATE");
    expect(merchantStatement?.sql).not.toContain("INSERT OR REPLACE INTO merchants");
    expect(db.batches[0]?.some((statement) => statement.sql.includes("merchant_categories"))).toBe(true);
  });
});
