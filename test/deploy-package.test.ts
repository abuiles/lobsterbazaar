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
    directory_summary: "Coffee directory",
    vertical_id: "coffee",
    vertical_name: "Coffee",
    brand_name: "Lobster Brew",
    emoji: "🦞",
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
    categoriesJson?: string;
    merchantsCsv: string;
    offersJson?: string;
  }
): Promise<void> {
  await mkdir(deployDir, { recursive: true });
  await writeFile(path.join(deployDir, "config.json"), JSON.stringify(options.config ?? createDeployConfig()), "utf8");
  await writeFile(path.join(deployDir, "merchants.csv"), options.merchantsCsv, "utf8");

  if (typeof options.categoriesJson !== "undefined") {
    await writeFile(path.join(deployDir, "categories.json"), options.categoriesJson, "utf8");
  } else {
    await rm(path.join(deployDir, "categories.json"), { force: true });
  }

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
        "slug,display_name,store_url,country_codes,category_slugs,notes,tags",
        'quoted-roaster,Quoted Roaster,https://quoted-roaster.com,US,coffee,"Notes with a comma, and more detail","coffee|quoted"'
      ].join("\n"),
      IMPORTED_AT
    );

    expect(merchants).toHaveLength(1);
    expect(merchants[0]?.slug).toBe("quoted-roaster");
    expect(merchants[0]?.notes).toBe("Notes with a comma, and more detail");
    expect(merchants[0]?.categorySlugs).toEqual(["coffee"]);
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

  it("falls back to deploy.config.json when config.json is absent", async () => {
    const deployPackage = await loadDeployPackage(
      "deploy",
      createFileReader(
        new Map<string, string>([
          ["deploy/deploy.config.json", JSON.stringify(createDeployConfig({ deploy_id: "lobsterbread" }))],
          [
            "deploy/merchants.csv",
            "slug,display_name,store_url,country_codes,notes\nsample-bakery,Sample Bakery,https://sample-bakery.com,US,Known sample"
          ]
        ])
      ),
      IMPORTED_AT
    );

    expect(deployPackage.config.deployId).toBe("lobsterbread");
    expect(deployPackage.merchants).toHaveLength(1);
  });

  it("parses deploy emoji and falls back when omitted", async () => {
    const withEmoji = await loadDeployPackage(
      "deploy",
      createFileReader(
        new Map<string, string>([
          ["deploy/config.json", JSON.stringify(createDeployConfig({ emoji: "☕" }))],
          [
            "deploy/merchants.csv",
            "slug,display_name,store_url,country_codes,notes,claim_status\nsample-roaster,Sample Roaster,https://sample-roaster.com,US,Known sample,claimed"
          ]
        ])
      ),
      IMPORTED_AT
    );

    const withoutEmoji = await loadDeployPackage(
      "deploy",
      createFileReader(
        new Map<string, string>([
          ["deploy/config.json", JSON.stringify(createDeployConfig({ emoji: undefined }))],
          [
            "deploy/merchants.csv",
            "slug,display_name,store_url,country_codes,notes,claim_status\nsample-roaster,Sample Roaster,https://sample-roaster.com,US,Known sample,claimed"
          ]
        ])
      ),
      IMPORTED_AT
    );

    expect(withEmoji.config.emoji).toBe("☕");
    expect(withoutEmoji.config.emoji).toBe("🦞");
  });

  it("parses optional skill buying targets when present", async () => {
    const deployPackage = await loadDeployPackage(
      "deploy",
      createFileReader(
        new Map<string, string>([
          [
            "deploy/config.json",
            JSON.stringify(
              createDeployConfig({ skill_buying_targets: "breads, pastries, and bakery subscriptions" })
            )
          ],
          [
            "deploy/merchants.csv",
            "slug,display_name,store_url,country_codes,notes,claim_status\nsample-bakery,Sample Bakery,https://sample-bakery.com,US,Known sample,claimed"
          ]
        ])
      ),
      IMPORTED_AT
    );

    expect(deployPackage.config.skillBuyingTargets).toBe("breads, pastries, and bakery subscriptions");
  });

  it("parses explicit categories and merchant category membership", async () => {
    const deployPackage = await loadDeployPackage(
      "deploy",
      createFileReader(
        new Map<string, string>([
          ["deploy/config.json", JSON.stringify(createDeployConfig({
            vertical_id: undefined,
            vertical_name: undefined,
            vertical_summary: undefined,
            root_surface: {
              sectionOrder: ["hero", "categories", "merchant_onboarding"],
              merchantOnboarding: {
                title: "Own a Shopify store?",
                ctaLabel: "Install the Shopify app",
                ctaHref: "https://apps.shopify.com/store-agent-kit"
              }
            }
          }))],
          [
            "deploy/categories.json",
            JSON.stringify([
              {
                slug: "bread",
                name: "Bread",
                summary: "Bread directory",
                subtitle: "bread, bakeries, pastries",
                mascot_url: "/assets/mascots/lobsterbread-mascot-v2.jpg"
              },
              {
                slug: "coffee",
                name: "Coffee",
                summary: "Coffee directory",
                skill_buying_targets: "coffee beans and brewing gear"
              }
            ])
          ],
          [
            "deploy/merchants.csv",
            [
              "slug,display_name,store_url,country_codes,category_slugs,notes,claim_status,claim_contact",
              "sample-roaster,Sample Roaster,https://sample-roaster.com,US,coffee|bread,Known sample,claimed,hello@sample-roaster.com"
            ].join("\n")
          ]
        ])
      ),
      IMPORTED_AT
    );

    expect(deployPackage.categories.map((category) => category.slug)).toEqual(["bread", "coffee"]);
    expect(deployPackage.categories[0]?.subtitle).toBe("bread, bakeries, pastries");
    expect(deployPackage.categories[0]?.mascotUrl).toBe("/assets/mascots/lobsterbread-mascot-v2.jpg");
    expect(deployPackage.categories[1]?.skillBuyingTargets).toBe("coffee beans and brewing gear");
    expect(deployPackage.merchants[0]?.categorySlugs).toEqual(["coffee", "bread"]);
    expect(deployPackage.config.directorySummary).toBe("Coffee directory");
    expect(deployPackage.config.rootSurface?.merchantOnboarding?.ctaHref).toBe("https://apps.shopify.com/store-agent-kit");
  });

  it("rejects merchants that reference unknown categories", async () => {
    await expect(
      loadDeployPackage(
        "deploy",
        createFileReader(
          new Map<string, string>([
            ["deploy/config.json", JSON.stringify(createDeployConfig({
              vertical_id: undefined,
              vertical_name: undefined,
              vertical_summary: undefined
            }))],
            [
              "deploy/categories.json",
              JSON.stringify([
                {
                  slug: "coffee",
                  name: "Coffee",
                  summary: "Coffee directory"
                }
              ])
            ],
            [
              "deploy/merchants.csv",
              [
                "slug,display_name,store_url,country_codes,category_slugs,notes",
                "sample-roaster,Sample Roaster,https://sample-roaster.com,US,coffee|bread,Known sample"
              ].join("\n")
            ]
          ])
        ),
        IMPORTED_AT
      )
    ).rejects.toThrow(/references unknown category bread/i);
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

    expect(await repositories.listCategorySlugs()).toEqual(["coffee"]);
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
    expect(first).toContain("INSERT INTO categories");
    expect(first).toContain("DELETE FROM categories WHERE slug NOT IN ('coffee', 'bread');");
    expect(first).toContain("INSERT INTO merchants");
    expect(first).toContain("INSERT INTO merchant_categories");
    expect(first).toContain("claim_import_sample-roaster");
    expect(first).toContain("ON CONFLICT(slug) DO UPDATE");
    expect(first).toContain("offer_sample");
    expect(first).toContain("DELETE FROM offers WHERE offer_id NOT IN ('offer_sample');");
    expect(first).toContain("DELETE FROM merchant_claims WHERE claim_id NOT IN ('claim_import_sample-roaster');");
    expect(first).toContain("DELETE FROM categories WHERE slug NOT IN ('coffee', 'bread');");
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

      const [skill, categories, categorySkill, country, merchant, offers] = await Promise.all([
        readFile(path.join(outputDir, "skill.md"), "utf8"),
        readFile(path.join(outputDir, "categories", "index.json"), "utf8"),
        readFile(path.join(outputDir, "coffee", "skill.md"), "utf8"),
        readFile(path.join(outputDir, "coffee", "countries", "US.json"), "utf8"),
        readFile(path.join(outputDir, "coffee", "merchants", "sample-roaster.json"), "utf8"),
        readFile(path.join(outputDir, "coffee", "offers", "US.json"), "utf8")
      ]);

      expect(skill).toContain("# Lobster Brew Root Skill");
      expect(skill).toContain("Version: 2.0.0");
      expect(skill).toContain("`GET lobsterbrew.com/{category}/skill.md`");
      expect(skill).toContain("`GET lobsterbrew.com/categories.md`");
      expect(categories).toContain("\"slug\": \"coffee\"");
      expect(categorySkill).toContain("# Lobster Brew Coffee Skill");
      expect(categorySkill).toContain("`GET lobsterbrew.com/coffee/countries.md`");
      expect(categorySkill).toContain("GET `lobsterbrew.com/coffee/merchants/{slug}/connect.md`");
      expect(categorySkill).toContain("lb_source__ = lobsterbrew");
      expect(country).toContain("\"countryCode\": \"US\"");
      expect(merchant).toContain("\"slug\": \"sample-roaster\"");
      expect(merchant).toContain("\"categorySlugs\": [");
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
      await expect(readFile(path.join(outputDir, "coffee", "merchants", "escape.json"), "utf8")).rejects.toThrow();
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

      await expect(readFile(path.join(outputDir, "coffee", "merchants", "second-roaster.json"), "utf8")).rejects.toThrow();
      const remainingMerchant = await readFile(path.join(outputDir, "coffee", "merchants", "sample-roaster.json"), "utf8");
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

      const originalMerchant = await readFile(path.join(outputDir, "coffee", "merchants", "sample-roaster.json"), "utf8");

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
      const merchantAfterFailure = await readFile(path.join(outputDir, "coffee", "merchants", "sample-roaster.json"), "utf8");
      expect(merchantAfterFailure).toBe(originalMerchant);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
