import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { loadDeployPackage, parseMerchantManifest } from "../src/deploy-package";
import { importDeployPackage } from "../src/import-deploy";
import { MemoryRepositories } from "../src/memory";
import { buildDeploySql } from "../src/sql";

const execFileAsync = promisify(execFile);
const IMPORTED_AT = "2026-03-15T00:00:00Z";

function createDeployConfig(overrides: Record<string, unknown> = {}) {
  return {
    deploy_id: "lobsterbrew",
    deploy_domain: "lobsterbrew.test",
    vertical_id: "coffee",
    vertical_name: "Coffee",
    brand_name: "Lobster Brew",
    brand_description: "Coffee deploy",
    vertical_summary: "Coffee directory",
    public_directory: true,
    offers_enabled: true,
    claim_mode: "operator_managed",
    ...overrides
  };
}

function createFileReader(files: Map<string, string>) {
  return async (file: string): Promise<string> => {
    const value = files.get(file);
    if (typeof value === "undefined") {
      const error = new Error(`ENOENT: no such file or directory, open '${file}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }

    return value;
  };
}

async function writeDeployPackage(
  deployDir: string,
  options: {
    config?: Record<string, unknown>;
    merchantsCsv: string;
    offersJson?: string;
  }
): Promise<void> {
  await mkdir(deployDir, { recursive: true });
  await writeFile(path.join(deployDir, "config.json"), JSON.stringify(options.config ?? createDeployConfig()), "utf8");
  await writeFile(path.join(deployDir, "merchants.csv"), options.merchantsCsv, "utf8");

  if (typeof options.offersJson !== "undefined") {
    await writeFile(path.join(deployDir, "offers.json"), options.offersJson, "utf8");
  } else {
    await rm(path.join(deployDir, "offers.json"), { force: true });
  }
}

describe("deploy package loading", () => {
  it("parses merchant CSV rows with quoted commas", () => {
    const merchants = parseMerchantManifest(
      [
        "slug,display_name,store_url,country_codes,notes,tags",
        'quoted-roaster,Quoted Roaster,https://quoted-roaster.com,US,"Notes with a comma, and more detail","coffee|quoted"'
      ].join("\n"),
      IMPORTED_AT
    );

    expect(merchants).toHaveLength(1);
    expect(merchants[0]?.slug).toBe("quoted-roaster");
    expect(merchants[0]?.notes).toBe("Notes with a comma, and more detail");
    expect(merchants[0]?.tags).toEqual(["coffee", "quoted"]);
  });

  it("rejects malformed CSV rows and unsafe merchant slugs", () => {
    expect(() =>
      parseMerchantManifest(
        [
          "slug,display_name,store_url,country_codes,notes",
          'broken-slug,Broken,https://broken.test,US,"unterminated'
        ].join("\n"),
        IMPORTED_AT
      )
    ).toThrow(/unterminated quoted field/i);

    expect(() =>
      parseMerchantManifest(
        [
          "slug,display_name,store_url,country_codes,notes",
          "../../escape,Escape,https://escape.test,US,Unsafe"
        ].join("\n"),
        IMPORTED_AT
      )
    ).toThrow(/lowercase URL-safe slug/i);
  });

  it("rejects unsupported deploy config flags in V0", async () => {
    const files = new Map<string, string>([
      ["deploy/config.json", JSON.stringify(createDeployConfig({
        public_directory: false,
        offers_enabled: false,
        claim_mode: "self_service"
      }))],
      [
        "deploy/merchants.csv",
        "slug,display_name,store_url,country_codes,notes,claim_status\nsample-roaster,Sample Roaster,https://sample-roaster.com,US,Known sample,claimed"
      ]
    ]);

    await expect(loadDeployPackage("deploy", createFileReader(files), IMPORTED_AT)).rejects.toThrow(
      /public_directory=false|offers_enabled=false|claim_mode=self_service/i
    );
  });

  it("parses owner share config and normalizes a leading @", async () => {
    const files = new Map<string, string>([
      [
        "deploy/config.json",
        JSON.stringify(createDeployConfig({
          owner_share_x_handle: "@lobsterbrew",
          owner_share_tagline: "Cart built by claw, approved by human."
        }))
      ],
      [
        "deploy/merchants.csv",
        "slug,display_name,store_url,country_codes,notes,claim_status\nsample-roaster,Sample Roaster,https://sample-roaster.com,US,Known sample,claimed"
      ]
    ]);

    const deployPackage = await loadDeployPackage("deploy", createFileReader(files), IMPORTED_AT);

    expect(deployPackage.config.ownerShareXHandle).toBe("lobsterbrew");
    expect(deployPackage.config.ownerShareTagline).toBe("Cart built by claw, approved by human.");
  });

  it("rejects offers imported for unclaimed merchants", async () => {
    const files = new Map<string, string>([
      [
        "deploy/config.json",
        JSON.stringify(createDeployConfig())
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
            offer_id: "offer_unclaimed",
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
      loadDeployPackage("deploy", createFileReader(files), IMPORTED_AT)
    ).rejects.toThrow(/claimed merchants/i);
  });

  it("requires stable offer ids for deterministic imports", async () => {
    const files = new Map<string, string>([
      ["deploy/config.json", JSON.stringify(createDeployConfig())],
      [
        "deploy/merchants.csv",
        "slug,display_name,store_url,country_codes,notes,claim_status,claim_contact\nsample-roaster,Sample Roaster,https://sample-roaster.com,US,Known sample,claimed,hello@sample-roaster.com"
      ],
      [
        "deploy/offers.json",
        JSON.stringify([
          {
            merchant_slug: "sample-roaster",
            title: "10% off",
            summary: "Fresh offer",
            country_codes: ["US"],
            valid_through: "2026-04-15T23:59:59Z",
            offer_type: "discount_code",
            terms_text: "Terms",
            status: "active"
          }
        ])
      ]
    ]);

    await expect(loadDeployPackage("deploy", createFileReader(files), IMPORTED_AT)).rejects.toThrow(
      /offer_id is required/i
    );
  });

  it("makes repeated deploy imports authoritative", async () => {
    const repositories = new MemoryRepositories();

    const firstFiles = new Map<string, string>([
      ["deploy/config.json", JSON.stringify(createDeployConfig())],
      [
        "deploy/merchants.csv",
        [
          "slug,display_name,store_url,country_codes,notes,claim_status,claim_contact",
          "sample-roaster,Sample Roaster,https://sample-roaster.com,US,Known sample,claimed,hello@sample-roaster.com",
          "second-roaster,Second Roaster,https://second-roaster.com,CA,Second sample,claimed,hello@second-roaster.com"
        ].join("\n")
      ],
      [
        "deploy/offers.json",
        JSON.stringify([
          {
            offer_id: "offer_sample",
            merchant_slug: "sample-roaster",
            title: "10% off",
            summary: "Fresh offer",
            country_codes: ["US"],
            valid_through: "2026-04-15T23:59:59Z",
            offer_type: "discount_code",
            terms_text: "Terms",
            status: "active"
          }
        ])
      ]
    ]);

    const secondFiles = new Map<string, string>([
      ["deploy/config.json", JSON.stringify(createDeployConfig())],
      [
        "deploy/merchants.csv",
        [
          "slug,display_name,store_url,country_codes,notes,claim_status,claim_contact",
          "sample-roaster,Sample Roaster,https://sample-roaster.com,US,Known sample,unclaimed,hello@sample-roaster.com"
        ].join("\n")
      ],
      ["deploy/offers.json", JSON.stringify([])]
    ]);

    const firstPackage = await loadDeployPackage("deploy", createFileReader(firstFiles), IMPORTED_AT);
    await importDeployPackage(repositories, firstPackage);
    expect((await repositories.listMerchantArtifacts("2026-03-15T12:00:00Z")).map((merchant) => merchant.slug)).toEqual([
      "sample-roaster",
      "second-roaster"
    ]);
    expect((await repositories.listActiveOffers("US", "2026-03-15T12:00:00Z")).map((offer) => offer.offerId)).toEqual([
      "offer_sample"
    ]);

    const secondPackage = await loadDeployPackage("deploy", createFileReader(secondFiles), IMPORTED_AT);
    await importDeployPackage(repositories, secondPackage);

    expect((await repositories.listMerchantArtifacts("2026-03-15T12:00:00Z")).map((merchant) => merchant.slug)).toEqual([
      "sample-roaster"
    ]);
    expect(await repositories.listActiveOffers("US", "2026-03-15T12:00:00Z")).toEqual([]);
    expect(await repositories.listCountryCodes()).toEqual(["US"]);
  });

  it("builds deterministic SQL from deploys/example", async () => {
    const deployPackage = await loadDeployPackage(
      "deploys/example",
      (file) => readFile(path.resolve(process.cwd(), file), "utf8"),
      IMPORTED_AT
    );

    const first = buildDeploySql(deployPackage);
    const second = buildDeploySql(deployPackage);

    expect(first).toBe(second);
    expect(first).toContain("INSERT INTO merchants");
    expect(first).toContain("claim_import_sample-roaster");
    expect(first).toContain("ON CONFLICT(slug) DO UPDATE");
    expect(first).toContain("offer_sample");
    expect(first).toContain("DELETE FROM offers WHERE offer_id NOT IN ('offer_sample');");
    expect(first).toContain("DELETE FROM merchant_claims WHERE claim_id NOT IN ('claim_import_sample-roaster');");
    expect(first).toContain("DELETE FROM merchants WHERE slug NOT IN ('sample-roaster', 'plain-roaster');");
    expect(first).not.toContain("BEGIN TRANSACTION;");
    expect(first).not.toContain("COMMIT;");
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
          IMPORTED_AT
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
      expect(skill).toContain("## Subscription products");
      expect(skill).toContain("resolution_path = storefront_graphql_fallback");
      expect(skill).toContain("lb_source__ = lobsterbrew");
      expect(country).toContain("\"countryCode\": \"US\"");
      expect(merchant).toContain("\"slug\": \"sample-roaster\"");
      expect(offers).toContain("\"offerId\": \"offer_sample\"");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("rejects path traversal attempts without escaping the output directory", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "lobsterbazaar-path-"));
    const deployDir = path.join(tmpDir, "deploy");
    const outputDir = path.join(tmpDir, "out");

    try {
      await writeDeployPackage(deployDir, {
        merchantsCsv: [
          "slug,display_name,store_url,country_codes,notes,claim_status,claim_contact",
          "../../escape,Escape,https://escape.test,US,Unsafe,claimed,hello@escape.test"
        ].join("\n"),
        offersJson: "[]\n"
      });

      let failed = false;
      try {
        await execFileAsync(
          process.execPath,
          ["--import", "tsx/esm", "scripts/materialize-deploy.ts", deployDir, outputDir, IMPORTED_AT],
          { cwd: process.cwd() }
        );
      } catch {
        failed = true;
      }

      expect(failed).toBe(true);
      await expect(readFile(path.join(tmpDir, "escape.json"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(outputDir, "merchants", "escape.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("replaces stale files when regenerating into the same output directory", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "lobsterbazaar-rerun-"));
    const deployDir = path.join(tmpDir, "deploy");
    const outputDir = path.join(tmpDir, "out");

    try {
      await writeDeployPackage(deployDir, {
        merchantsCsv: [
          "slug,display_name,store_url,country_codes,notes,claim_status,claim_contact",
          "sample-roaster,Sample Roaster,https://sample-roaster.com,US,Known sample,claimed,hello@sample-roaster.com",
          "second-roaster,Second Roaster,https://second-roaster.com,CA,Second sample,claimed,hello@second-roaster.com"
        ].join("\n"),
        offersJson: JSON.stringify([
          {
            offer_id: "offer_sample",
            merchant_slug: "sample-roaster",
            title: "10% off",
            summary: "Fresh offer",
            country_codes: ["US"],
            valid_through: "2026-04-15T23:59:59Z",
            offer_type: "discount_code",
            terms_text: "Terms",
            status: "active"
          }
        ])
      });

      await execFileAsync(
        process.execPath,
        ["--import", "tsx/esm", "scripts/materialize-deploy.ts", deployDir, outputDir, IMPORTED_AT],
        { cwd: process.cwd() }
      );

      await writeDeployPackage(deployDir, {
        merchantsCsv: [
          "slug,display_name,store_url,country_codes,notes,claim_status,claim_contact",
          "sample-roaster,Sample Roaster,https://sample-roaster.com,US,Known sample,claimed,hello@sample-roaster.com"
        ].join("\n"),
        offersJson: JSON.stringify([])
      });

      await execFileAsync(
        process.execPath,
        ["--import", "tsx/esm", "scripts/materialize-deploy.ts", deployDir, outputDir, IMPORTED_AT],
        { cwd: process.cwd() }
      );

      await expect(readFile(path.join(outputDir, "merchants", "second-roaster.json"), "utf8")).rejects.toThrow();
      const remainingMerchant = await readFile(path.join(outputDir, "merchants", "sample-roaster.json"), "utf8");
      expect(remainingMerchant).toContain("\"slug\": \"sample-roaster\"");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves the previous artifact set if regeneration fails", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "lobsterbazaar-atomic-"));
    const deployDir = path.join(tmpDir, "deploy");
    const outputDir = path.join(tmpDir, "out");

    try {
      await writeDeployPackage(deployDir, {
        merchantsCsv: [
          "slug,display_name,store_url,country_codes,notes,claim_status,claim_contact",
          "sample-roaster,Sample Roaster,https://sample-roaster.com,US,Known sample,claimed,hello@sample-roaster.com"
        ].join("\n"),
        offersJson: JSON.stringify([
          {
            offer_id: "offer_sample",
            merchant_slug: "sample-roaster",
            title: "10% off",
            summary: "Fresh offer",
            country_codes: ["US"],
            valid_through: "2026-04-15T23:59:59Z",
            offer_type: "discount_code",
            terms_text: "Terms",
            status: "active"
          }
        ])
      });

      await execFileAsync(
        process.execPath,
        ["--import", "tsx/esm", "scripts/materialize-deploy.ts", deployDir, outputDir, IMPORTED_AT],
        { cwd: process.cwd() }
      );

      const originalMerchant = await readFile(path.join(outputDir, "merchants", "sample-roaster.json"), "utf8");

      await writeDeployPackage(deployDir, {
        merchantsCsv: [
          "slug,display_name,store_url,country_codes,notes,claim_status,claim_contact",
          "sample-roaster,Sample Roaster,not-a-url,US,Known sample,claimed,hello@sample-roaster.com"
        ].join("\n"),
        offersJson: JSON.stringify([
          {
            offer_id: "offer_sample",
            merchant_slug: "sample-roaster",
            title: "10% off",
            summary: "Fresh offer",
            country_codes: ["US"],
            valid_through: "2026-04-15T23:59:59Z",
            offer_type: "discount_code",
            terms_text: "Terms",
            status: "active"
          }
        ])
      });

      let failed = false;
      try {
        await execFileAsync(
          process.execPath,
          ["--import", "tsx/esm", "scripts/materialize-deploy.ts", deployDir, outputDir, IMPORTED_AT],
          { cwd: process.cwd() }
        );
      } catch {
        failed = true;
      }

      expect(failed).toBe(true);
      const merchantAfterFailure = await readFile(path.join(outputDir, "merchants", "sample-roaster.json"), "utf8");
      expect(merchantAfterFailure).toBe(originalMerchant);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
