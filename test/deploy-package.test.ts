import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { loadDeployPackage, parseMerchantManifest } from "../src/deploy-package";
import { buildDeploySql } from "../src/sql";

const execFileAsync = promisify(execFile);

describe("deploy package loading", () => {
  it("parses merchant CSV rows with quoted commas", () => {
    const merchants = parseMerchantManifest(
      [
        "slug,display_name,store_url,country_codes,notes,tags",
        'quoted-roaster,Quoted Roaster,https://quoted-roaster.com,US,"Notes with a comma, and more detail","coffee|quoted"'
      ].join("\n"),
      "2026-03-15T00:00:00Z"
    );

    expect(merchants).toHaveLength(1);
    expect(merchants[0]?.slug).toBe("quoted-roaster");
    expect(merchants[0]?.notes).toBe("Notes with a comma, and more detail");
    expect(merchants[0]?.tags).toEqual(["coffee", "quoted"]);
  });

  it("rejects offers imported for unclaimed merchants", async () => {
    const files = new Map<string, string>([
      [
        "deploy/config.json",
        JSON.stringify({
          deploy_id: "lobsterbrew",
          deploy_domain: "lobsterbrew.test",
          vertical_id: "coffee",
          vertical_name: "Coffee",
          brand_name: "Lobster Brew",
          brand_description: "Coffee deploy",
          vertical_summary: "Coffee directory"
        })
      ],
      [
        "deploy/merchants.csv",
        [
          "slug,display_name,store_url,country_codes,notes,claim_status",
          "plain-roaster,Plain Roaster,https://plain-roaster.com,US,Unclaimed merchant,unclaimed"
        ].join("\n")
      ],
      [
        "deploy/offers.json",
        JSON.stringify([
          {
            merchant_slug: "plain-roaster",
            title: "10% off",
            summary: "Not allowed for unclaimed merchants.",
            country_codes: ["US"],
            valid_through: "2026-04-15T23:59:59Z",
            offer_type: "discount_code",
            terms_text: "Nope",
            status: "active"
          }
        ])
      ]
    ]);

    await expect(
      loadDeployPackage("deploy", async (file) => {
        const value = files.get(file);
        if (!value) {
          const error = new Error(`ENOENT: no such file or directory, open '${file}'`);
          throw error;
        }

        return value;
      })
    ).rejects.toThrow(/claimed merchants/i);
  });

  it("builds deterministic SQL from deploys/example", async () => {
    const deployPackage = await loadDeployPackage(
      "deploys/example",
      (file) => readFile(path.resolve(process.cwd(), file), "utf8"),
      "2026-03-15T00:00:00Z"
    );

    const first = buildDeploySql(deployPackage);
    const second = buildDeploySql(deployPackage);

    expect(first).toBe(second);
    expect(first).toContain("INSERT INTO merchants");
    expect(first).toContain("claim_import_sample-roaster");
    expect(first).toContain("ON CONFLICT(slug) DO UPDATE");
    expect(first).toContain("offer_sample");
  });
});

describe("deploy artifact materialization", () => {
  it("writes local artifacts from the example deploy package", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "lobsterbazaar-artifacts-"));

    try {
      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx/esm",
          "scripts/materialize-deploy.ts",
          "deploys/example",
          outputDir,
          "2026-03-15T00:00:00Z"
        ],
        {
          cwd: process.cwd()
        }
      );

      const [skill, country, merchant, offers] = await Promise.all([
        readFile(path.join(outputDir, "skill.md"), "utf8"),
        readFile(path.join(outputDir, "countries", "US.json"), "utf8"),
        readFile(path.join(outputDir, "merchants", "sample-roaster.json"), "utf8"),
        readFile(path.join(outputDir, "offers", "US.json"), "utf8")
      ]);

      expect(skill).toContain("# Lobster Brew Skill");
      expect(skill).toContain("lb_source__ = lobsterbrew");
      expect(country).toContain("\"countryCode\": \"US\"");
      expect(merchant).toContain("\"slug\": \"sample-roaster\"");
      expect(offers).toContain("\"offerId\": \"offer_sample\"");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
