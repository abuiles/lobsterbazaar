import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { MemoryArtifactStore, MemoryRepositories } from "../src/memory";
import { createTestHarness, requestJson, requestText, RecordingMetricsDataset } from "./helpers";

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

interface CategoryCountriesResponse {
  category_slug: string;
  generated_at: string;
  countries: string[];
}

interface CategoryCountryResponse {
  category_slug: string;
  country_code: string;
  generated_at: string;
  merchants: Array<{
    slug: string;
    display_name: string;
    store_url: string;
    summary: string;
    description: string;
    active_offers_count: number;
  }>;
}

interface CategoriesResponse {
  generated_at: string;
  categories: Array<{
    slug: string;
    name: string;
    summary: string;
    skill_path: string;
    countries_path: string;
  }>;
}

interface CategoryOffersResponse {
  category_slug: string;
  country_code: string;
  generated_at: string;
  offers: Array<{
    offer_id: string;
    merchant_slug: string;
    merchant_display_name: string;
    title: string;
    summary: string;
    offer_type: string;
    valid_through: string;
    terms_text: string;
  }>;
}

interface CategoryMerchantResponse {
  category_slug: string;
  merchant: {
    slug: string;
    display_name: string;
    store_url: string;
    country_codes: string[];
    category_slugs: string[];
    active_offers_count: number;
    connect_path: string;
  };
}

interface CategoryMerchantConnectResponse {
  category_slug: string;
  merchant: {
    name: string;
    slug?: string;
    connect_path: string;
    store_url: string;
  };
  mcp: {
    url: string;
  };
  cart_attributes: Array<{
    key: string;
    value: string;
  }>;
  offers: Array<{
    offer_id: string;
    title: string;
    summary: string;
    offer_type: string;
    valid_through: string;
    terms_text: string;
  }>;
}

function lastMetricWrite(metrics: { writes: AnalyticsEngineDataPoint[] }): AnalyticsEngineDataPoint {
  const metric = metrics.writes.at(-1);
  expect(metric).toBeDefined();
  return metric as AnalyticsEngineDataPoint;
}

class RootSurfaceRepositories extends MemoryRepositories {
  override async listCategories() {
    const categories = await super.listCategories();
    return categories.map((category) => ({
      ...category,
      subtitle: category.slug === "coffee" ? "coffee, roasters, cafes" : "bread, bakeries, pastries",
      mascotUrl: category.slug === "coffee"
        ? "/assets/mascots/lobsterbrew-mascot.jpg"
        : "/assets/mascots/lobsterbread-mascot-v2.jpg"
    }));
  }
}

describe("lobsterbazaar worker", () => {
  it("renders the landing page with root category guidance", async () => {
    const { app } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(">Lobster Bazaar<");
    expect(body).toContain("Coffee-oriented merchant discovery for lobsters.");
    expect(body).toContain("Read https://lobsterbrew.test/skill.md and follow the instructions to choose a category before browsing merchants.");
    expect(body).toContain("Skill install instruction");
    expect(body).toContain("All Lobster Categories");
    expect(body).toContain("Coffee");
    expect(body).toContain("Bread");
    expect(body).toContain("/coffee/skill.md");
    expect(body).toContain("/bread/skill.md");
    expect(body).toContain("Featured Merchants");
    expect(body).toContain("Sample Roaster");
    expect(body).toContain("source code on GitHub");
  });

  it("renders a deploy-specific root surface with category mascots and merchant onboarding", async () => {
    const artifacts = new MemoryArtifactStore();
    const repositories = new RootSurfaceRepositories();

    await repositories.putCategory({
      slug: "coffee",
      name: "Coffee",
      summary: "Coffee-oriented merchant discovery for lobsters."
    });

    await repositories.putCategory({
      slug: "bread",
      name: "Bread",
      summary: "Bread-oriented merchant discovery for lobsters."
    });

    const app = createApp({
      artifacts,
      repositories,
      config: {
        brandName: "Lobster Stores",
        deployId: "lobsterstores",
        deployDomain: "lobsterstores.com",
        verticalId: "directory",
        verticalSummary: "Category-first merchant discovery for OpenClaw and AI shoppers.",
        skillBuyingTargets: "coffee, bread, and related Shopify merchants",
        mascotUrl: "/assets/mascots/lobsterbazaar-default.jpg",
        emoji: "🦞",
        directoryVerticals: [
          {
            deployId: "lobsterbrew",
            brandName: "Lobster Brew",
            domain: "lobsterbrew.com",
            url: "https://lobsterbrew.com",
            verticalName: "Coffee",
            directorySubtitle: "coffee, roasters, cafes",
            emoji: "🦞☕️"
          },
          {
            deployId: "lobsterbread",
            brandName: "Lobster Bread",
            domain: "lobsterbread.com",
            url: "https://lobsterbread.com",
            verticalName: "Bread",
            directorySubtitle: "bread, bakeries, pastries",
            emoji: "🦞🥐"
          }
        ],
        rootSurface: {
          sectionOrder: ["hero", "categories", "merchant_onboarding"],
          hero: {
            eyebrow: "discovery for OpenClaw and AI shoppers",
            title: "Help OpenClaw and AI shoppers discover Shopify merchants.",
            body: "Lobster Stores helps shoppers explore Shopify merchants, compare stores, and hand off to the right storefront when the fit is clear.",
            imageUrl: "https://lobsterstores.com/assets/mascots/lobsterstores.jpg",
            imageAlt: "Lobster Stores mascot",
            primaryCta: {
              label: "install the skill",
              href: "#install"
            },
            secondaryCta: {
              label: "browse merchants",
              href: "#directory"
            },
            tertiaryCta: {
              label: "register your store",
              href: "#register"
            }
          },
          install: {
            title: "send your agent to Lobster Stores.",
            body: "Built for OpenClaw, but it works with Codex, Cursor, Claude Code, or any agent that can read a URL and follow instructions. Start with the directory skill to browse Shopify merchants, compare stores, and hand off to the right storefront when you are ready to shop.",
            prompt: "Read https://lobsterstores.com/skill.md and use it to browse the Lobster Stores directory of Shopify merchants. Compare stores, explore the directory, and hand off to the right storefront when you are ready to shop."
          },
          categories: {
            title: "discover Shopify stores across the lobster map.",
            body: ""
          },
          categoryOrder: ["coffee", "bread"],
          merchantOnboarding: {
            title: "Merchant onboarding",
            body: "Install the Shopify app to manage your listing.",
            ctaLabel: "Install Lobster Stores from the Shopify App Store",
            ctaHref: "https://apps.shopify.com/store-agent-kit",
            bullets: [
              "Create your merchant listing in the app after installation.",
              "Request verification for an existing listing from the app.",
              "Verification helps OpenClaw agents and AI shoppers trust your listing faster."
            ],
            supportLinks: [
              {
                label: "source code on GitHub",
                href: "https://github.com/abuiles/lobsterbazaar"
              },
              {
                label: "built by @abuiles",
                href: "https://x.com/abuiles"
              }
            ],
            footerLines: [
              "made for claws, shoppers, and merchants"
            ],
            note: ""
          }
        }
      } as any,
      metrics: new RecordingMetricsDataset() as unknown as AnalyticsEngineDataset,
      operatorToken: "test-operator-token",
      now: () => "2026-03-15T12:00:00Z"
    });

    const response = await app.fetch(new Request("https://lobsterstores.com/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Help OpenClaw and AI shoppers discover Shopify merchants.");
    expect(body).toContain("install the skill");
    expect(body).toContain("browse merchants");
    expect(body).toContain("register your store");
    expect(body).toContain("Merchant onboarding");
    expect(body).toContain("Install the Shopify app to manage your listing.");
    expect(body).toContain("Install Lobster Stores from the Shopify App Store");
    expect(body).toContain("light mode");
    expect(body).toContain("send your agent to Lobster Stores.");
    expect(body).toContain("Read https://lobsterstores.com/skill.md");
    expect(body).toContain("discover Shopify stores across the lobster map.");
    expect(body).toContain("/assets/mascots/lobsterbrew-mascot.jpg");
    expect(body).toContain("/assets/mascots/lobsterbread-mascot-v2.jpg");
    expect(body).toContain("https://lobsterstores.com/assets/mascots/lobsterstores.jpg");
    expect(body).toContain("coffee, roasters, cafes");
    expect(body).toContain("bread, bakeries, pastries");
    expect(body).toContain("source code on GitHub");
    expect(body).toContain("built by @abuiles");
    expect(body).toContain("made for claws, shoppers, and merchants");
    expect(body).not.toContain("Lobster network");
    expect(body).not.toContain("verified listing");
    expect(body).not.toContain("Category index");
    expect(body).not.toContain("Root skill");
    expect(body).not.toContain("Browse categories");
    expect(body).not.toContain("Merchant setup lives below the directory so discovery stays first.");
    expect(body).not.toContain("Share your Shopify store URL, category, merchant details, and what makes your business a fit inside the app.");
    expect(body).not.toContain("merchant connect for MCP handoff");
  });

  it("serves the root skill markdown as the category entrypoint", async () => {
    const { app, metrics } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/skill.md"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("---\nname: lobsterbrew");
    expect(body).toContain("homepage: lobsterbrew.test");
    expect(body).toContain("# Lobster Bazaar Root Skill");
    expect(body).toContain("Version: 2.0.0");
    expect(body).toContain("Use this root skill to choose the right category first.");
    expect(body).toContain("`GET lobsterbrew.test/categories.md`");
    expect(body).toContain("`GET lobsterbrew.test/{category}/skill.md`");
    expect(body).toContain("Published Categories");
    expect(body).toContain("Coffee");
    expect(body).toContain("Bread");
    expect(body).not.toContain("/claws/register");
    expect(lastMetricWrite(metrics as RecordingMetricsDataset).blobs).toEqual([
      "skill_view",
      "lobsterbrew",
      "coffee",
      "/skill",
      "GET",
      "ok",
      "2xx",
      "",
      "",
      ""
    ]);
    expect(lastMetricWrite(metrics as RecordingMetricsDataset).indexes).toEqual(["coffee"]);
  });

  it("serves category skill markdown", async () => {
    const { app } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/coffee/skill.md"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("# Lobster Bazaar Coffee Skill");
    expect(body).toContain("Category: Coffee (`coffee`)");
    expect(body).toContain("Use it when the owner wants to buy coffee, subscriptions, and brewing gear.");
    expect(body).toContain("`GET lobsterbrew.test/coffee/countries.md`");
    expect(body).toContain("`GET lobsterbrew.test/coffee/countries/{country_code}.md`");
    expect(body).toContain("`GET lobsterbrew.test/coffee/offers/{country_code}.md`");
    expect(body).toContain("GET `lobsterbrew.test/coffee/merchants/{slug}/connect.md`");
  });

  it("returns the category country index in JSON and markdown", async () => {
    const { app } = await createTestHarness();

    const jsonResponse = await requestJson<CategoryCountriesResponse>(app, "/coffee/countries");
    expect(jsonResponse.response.status).toBe(200);
    expect(jsonResponse.body.category_slug).toBe("coffee");
    expect(jsonResponse.body.countries).toEqual(["CA", "US"]);

    const markdownResponse = await requestText(app, "/coffee/countries.md");
    expect(markdownResponse.response.status).toBe(200);
    expect(markdownResponse.body).toContain("# Coffee Countries");
    expect(markdownResponse.body).toContain("/coffee/countries/CA.md");
    expect(markdownResponse.body).toContain("/coffee/countries/US.md");
  });

  it("orders country merchants with active offers first", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestJson<CategoryCountryResponse>(app, "/coffee/countries/US");

    expect(response.status).toBe(200);
    expect(body.category_slug).toBe("coffee");
    expect(body.country_code).toBe("US");
    expect(body.merchants).toHaveLength(2);
    const [firstMerchant, secondMerchant] = body.merchants;
    expect(firstMerchant?.slug).toBe("claimed-roaster");
    expect(firstMerchant?.active_offers_count).toBe(1);
    expect(firstMerchant?.summary).toBe("5+");
    expect(firstMerchant?.description).toBe("Runs small seasonal releases.");
    expect(secondMerchant?.slug).toBe("sample-roaster");
    expect(secondMerchant?.summary).toBe("20+");
    expect(secondMerchant?.description).toBe("Known for washed coffees and bright acidity.");
  });

  it("returns only active offers for the requested country", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestJson<CategoryOffersResponse>(app, "/coffee/offers/US");

    expect(response.status).toBe(200);
    expect(body.category_slug).toBe("coffee");
    expect(body.country_code).toBe("US");
    expect(body.offers).toHaveLength(1);
    const [firstOffer] = body.offers;
    expect(firstOffer?.offer_id).toBe("offer_active");
    expect(firstOffer?.merchant_slug).toBe("claimed-roaster");
  });

  it("returns merchant details for the selected category", async () => {
    const { app } = await createTestHarness();

    const jsonResponse = await requestJson<CategoryMerchantResponse>(app, "/coffee/merchants/claimed-roaster");
    expect(jsonResponse.response.status).toBe(200);
    expect(jsonResponse.body.category_slug).toBe("coffee");
    expect(jsonResponse.body.merchant.slug).toBe("claimed-roaster");
    expect(jsonResponse.body.merchant.display_name).toBe("Claimed Roaster");
    expect(jsonResponse.body.merchant.active_offers_count).toBe(1);
    expect(jsonResponse.body.merchant.connect_path).toBe("/coffee/merchants/claimed-roaster/connect");

    const markdownResponse = await requestText(app, "/coffee/merchants/claimed-roaster.md");
    expect(markdownResponse.response.status).toBe(200);
    expect(markdownResponse.body).toContain("# Claimed Roaster");
    expect(markdownResponse.body).toContain("- category: `coffee`");
    expect(markdownResponse.body).toContain("- merchant_slug: `claimed-roaster`");
    expect(markdownResponse.body).toContain("connect_url: `https://lobsterbrew.test/coffee/merchants/claimed-roaster/connect.md`");
  });

  it("returns all available categories", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestJson<CategoriesResponse>(app, "/categories");

    expect(response.status).toBe(200);
    expect(body.generated_at).toBe("2026-03-15T12:00:00Z");
    expect(body.categories.map((category) => category.slug)).toEqual(["bread", "coffee"]);
  });

  it("returns available categories as markdown", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestText(app, "/categories.md");

    expect(response.status).toBe(200);
    expect(body).toContain("# Categories");
    expect(body).toContain("Coffee");
    expect(body).toContain("Bread");
  });

  it("serves head requests for skill markdown", async () => {
    const { app } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/skill.md", {
      method: "HEAD"
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
  });

  it("renders the landing page with category entrypoints", async () => {
    const { app } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("<h1>Lobster Bazaar</h1>");
    expect(body).toContain("Coffee-oriented merchant discovery for lobsters.");
    expect(body).toContain("Read https://lobsterbrew.test/skill.md and follow the instructions to choose a category before browsing merchants.");
    expect(body).toContain("Then the agent can discover merchants through the category-specific skill");
    expect(body).toContain("Pick a category first, then stay inside that namespace for discovery.");
    expect(body).toContain("All Lobster Categories");
    expect(body).toContain("Bread");
    expect(body).toContain("coffee");
    expect(body).toContain("/coffee/skill.md");
    expect(body).toContain("/bread/skill.md");
  });

  it("does not render the legacy featured merchants surface", async () => {
    const { app, repositories } = await createTestHarness();

    await repositories.putMerchant({
      slug: "sample-roaster",
      displayName: "Sample Roaster",
      storeUrl: "https://sample-roaster.com",
      storeDomain: "sample-roaster.myshopify.com",
      storefrontMcpUrl: undefined,
      countryCodes: ["US"],
      categorySlugs: ["coffee"],
      locationsSummary: "20+",
      notes: "Known for washed coffees and bright acidity.",
      tags: ["coffee", "specialty"],
      claimContact: "hello@sample-roaster.com",
      claimStatus: "unclaimed",
      verticalMetadata: {}
    });

    const response = await app.fetch(new Request("https://lobsterbrew.test/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("featured merchants");
    expect(body).not.toContain("Featured Merchants");
  });

  it("lists only featured merchants from repository data", async () => {
    const repositories = new MemoryRepositories();

    await repositories.putCategory({
      slug: "coffee",
      name: "Coffee",
      summary: "Coffee-oriented merchant discovery for lobsters."
    });

    await repositories.putMerchant({
      slug: "alpha-roaster",
      displayName: "Alpha Roaster",
      storeUrl: "https://alpha-roaster.com",
      storeDomain: "alpha-roaster.myshopify.com",
      storefrontMcpUrl: undefined,
      countryCodes: ["US"],
      categorySlugs: ["coffee"],
      locationsSummary: "2 cafes",
      notes: "Alpha description",
      tags: ["coffee"],
      claimContact: undefined,
      claimStatus: "claimed",
      verticalMetadata: {
        featured: true
      }
    });

    await repositories.putMerchant({
      slug: "beta-roaster",
      displayName: "Beta Roaster",
      storeUrl: "https://beta-roaster.com",
      storeDomain: "beta-roaster.myshopify.com",
      storefrontMcpUrl: undefined,
      countryCodes: ["US"],
      categorySlugs: ["coffee"],
      locationsSummary: "1 cafe",
      notes: "Beta description",
      tags: ["coffee"],
      claimContact: undefined,
      claimStatus: "claimed",
      verticalMetadata: {
        featured: true
      }
    });

    await repositories.putMerchant({
      slug: "gamma-roaster",
      displayName: "Gamma Roaster",
      storeUrl: "https://gamma-roaster.com",
      storeDomain: "gamma-roaster.myshopify.com",
      storefrontMcpUrl: undefined,
      countryCodes: ["US"],
      categorySlugs: ["coffee"],
      locationsSummary: "4 cafes",
      notes: "Gamma description",
      tags: ["coffee"],
      claimContact: undefined,
      claimStatus: "claimed",
      verticalMetadata: {}
    });

    await repositories.putClaim({
      claimId: "claim_alpha_roaster",
      merchantSlug: "alpha-roaster",
      status: "claimed",
      contact: "alpha@example.com",
      note: "Seed claim for alpha."
    });

    await repositories.putClaim({
      claimId: "claim_beta_roaster",
      merchantSlug: "beta-roaster",
      status: "claimed",
      contact: "beta@example.com",
      note: "Seed claim for beta."
    });

    await repositories.putOffer({
      offerId: "offer_alpha",
      merchantSlug: "alpha-roaster",
      title: "Alpha offer",
      summary: "Alpha summary",
      countryCodes: ["US"],
      activeFrom: "2026-03-01T00:00:00Z",
      validThrough: "2026-04-01T00:00:00Z",
      offerType: "discount_code",
      termsText: "Alpha terms",
      priority: 10,
      publicProofUrl: undefined,
      offerCode: undefined,
      status: "active",
      verticalMetadata: {}
    });

    const featuredMerchants = await repositories.listFeaturedMerchants("2026-03-15T12:00:00Z");

    expect(featuredMerchants.map((merchant) => merchant.slug)).toEqual([
      "alpha-roaster",
      "beta-roaster"
    ]);
  });

  it("returns country offers as markdown", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestText(app, "/coffee/offers/US.md");

    expect(response.status).toBe(200);
    expect(body).toContain("# Active Coffee Offers in US");
    expect(body).toContain("10% off first order");
  });

  it("returns country markdown with connect links for each merchant", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestText(app, "/coffee/countries/US.md");

    expect(response.status).toBe(200);
    expect(body).toContain("- claimed-roaster: 1 active offer(s)");
    expect(body).toContain("description: Runs small seasonal releases.");
    expect(body).toContain("summary: 5+");
    expect(body).toContain("merchant_url: `https://lobsterbrew.test/coffee/merchants/claimed-roaster.md`");
    expect(body).toContain("connect_url: `https://lobsterbrew.test/coffee/merchants/claimed-roaster/connect.md`");
    expect(body).toContain("- sample-roaster: no active offers");
    expect(body).toContain("description: Known for washed coffees and bright acidity.");
    expect(body).toContain("summary: 20+");
    expect(body).toContain("merchant_url: `https://lobsterbrew.test/coffee/merchants/sample-roaster.md`");
    expect(body).toContain("connect_url: `https://lobsterbrew.test/coffee/merchants/sample-roaster/connect.md`");
  });

  it("returns 404 and skips artifact creation for unsupported countries", async () => {
    const { app, artifacts } = await createTestHarness();

    const unsupportedCountryResponse = await requestJson<ErrorResponse>(app, "/coffee/countries/ZZ");
    const unsupportedOffersResponse = await requestJson<ErrorResponse>(app, "/coffee/offers/ZZ");

    expect(unsupportedCountryResponse.response.status).toBe(404);
    expect(unsupportedOffersResponse.response.status).toBe(404);
    expect(await artifacts.getCategoryCountry("coffee", "ZZ")).toBeNull();
    expect(await artifacts.getCategoryOffers("coffee", "ZZ")).toBeNull();
  });

  it("returns merchant MCP connect payload with lb_source__", async () => {
    const { app, metrics } = await createTestHarness();

    const { response, body } = await requestJson<CategoryMerchantConnectResponse>(
      app,
      "/coffee/merchants/claimed-roaster/connect"
    );

    expect(response.status).toBe(200);
    expect(body.category_slug).toBe("coffee");
    expect(body.merchant.name).toBe("Claimed Roaster");
    expect(body.merchant.connect_path).toBe("/coffee/merchants/claimed-roaster/connect");
    expect(body.mcp.url).toBe("https://claimed-roaster.myshopify.com/api/mcp");
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0]?.offer_id).toBe("offer_active");
    expect(body.cart_attributes).toEqual([
      {
        key: "lb_source__",
        value: "lobsterbrew"
      }
    ]);
    expect(lastMetricWrite(metrics as RecordingMetricsDataset).blobs).toEqual([
      "merchant_connect_view",
      "lobsterbrew",
      "coffee",
      "/:category/merchants/:slug/connect",
      "GET",
      "ok",
      "2xx",
      "",
      "claimed-roaster",
      ""
    ]);
  });

  it("returns a minimal connect markdown payload with active offers", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestText(app, "/coffee/merchants/claimed-roaster/connect.md");

    expect(response.status).toBe(200);
    expect(body).toContain("# Merchant Connect Prompt");
    expect(body).toContain("Use this context block before sending MCP calls for this merchant.");
    expect(body).toContain("category_slug: `coffee`");
    expect(body).toContain("merchant_name: `Claimed Roaster`");
    expect(body).toContain("merchant_slug: `claimed-roaster`");
    expect(body).toContain("connect_path: `/coffee/merchants/claimed-roaster/connect`");
    expect(body).toContain("store_url: `https://claimed-roaster.com`");
    expect(body).toContain("storefront_mcp_url: `https://claimed-roaster.myshopify.com/api/mcp`");
    expect(body).toContain("10% off first order");
    expect(body).toContain("cart_attributes:");
    expect(body).toContain("lb_source__: lobsterbrew");
  });

  it("renders the generated root skill markdown", async () => {
    const { app, metrics } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/skill.md"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("---\nname: lobsterbrew");
    expect(body).toContain("homepage: lobsterbrew.test");
    expect(body).toContain("# Lobster Bazaar Root Skill");
    expect(body).toContain("Version: 2.0.0");
    expect(body).toContain("Use this root skill to choose the right category first.");
    expect(body).toContain("`GET lobsterbrew.test/categories.md`");
    expect(body).toContain("`GET lobsterbrew.test/{category}/skill.md`");
    expect(body).toContain("Published Categories");
    expect(body).toContain("Coffee");
    expect(body).toContain("Bread");
    expect(body).toContain("Do not treat the root as a merchant discovery surface");
    expect(lastMetricWrite(metrics as RecordingMetricsDataset).blobs).toEqual([
      "skill_view",
      "lobsterbrew",
      "coffee",
      "/skill",
      "GET",
      "ok",
      "2xx",
      "",
      "",
      ""
    ]);
    expect(lastMetricWrite(metrics as RecordingMetricsDataset).indexes).toEqual(["coffee"]);
  });

  it("renders the generated category skill markdown", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestText(app, "/coffee/skill.md");

    expect(response.status).toBe(200);
    expect(body).toContain("# Lobster Bazaar Coffee Skill");
    expect(body).toContain("Version: 2.0.0");
    expect(body).toContain("Category: Coffee (`coffee`)");
    expect(body).toContain("`GET lobsterbrew.test/coffee/countries.md`");
    expect(body).toContain("`GET lobsterbrew.test/coffee/countries/{country_code}.md`");
    expect(body).toContain("`GET lobsterbrew.test/coffee/offers/{country_code}.md`");
    expect(body).toContain("GET `lobsterbrew.test/coffee/merchants/{slug}/connect.md`");
    expect(body).toContain("lb_source__ = lobsterbrew");
  });

  it("materializes root and category artifacts with fresh repository data", async () => {
    const { app, artifacts, repositories } = await createTestHarness();

    const firstResponse = await app.fetch(
      new Request("https://lobsterbrew.test/internal/materialize", {
        method: "POST",
        headers: {
          authorization: "Bearer test-operator-token"
        }
      })
    );

    expect(firstResponse.status).toBe(200);
    expect((await artifacts.getRootSkill()) ?? "").toContain("# Lobster Bazaar Root Skill");
    expect((await artifacts.getCategorySkill("coffee")) ?? "").toContain("# Lobster Bazaar Coffee Skill");
    expect((await artifacts.getCategoryCountry("coffee", "US"))?.merchants.map((merchant) => merchant.slug)).toEqual([
      "claimed-roaster",
      "sample-roaster"
    ]);
    expect((await artifacts.getCategoryOffers("coffee", "US"))?.offers.map((offer) => offer.offerId)).toEqual(["offer_active"]);
    expect(await artifacts.getCategoryMerchant("coffee", "sample-roaster")).not.toBeNull();

    await repositories.putMerchant({
      slug: "fresh-roaster",
      displayName: "Fresh Roaster",
      storeUrl: "https://fresh-roaster.com",
      storeDomain: "fresh-roaster.myshopify.com",
      storefrontMcpUrl: undefined,
      countryCodes: ["US"],
      categorySlugs: ["coffee"],
      locationsSummary: "2 cafes",
      notes: "Freshly imported for rematerialization coverage.",
      tags: ["coffee"],
      claimContact: "hello@fresh-roaster.com",
      claimStatus: "claimed",
      verticalMetadata: {}
    });

    await repositories.putClaim({
      claimId: "claim_fresh_roaster",
      merchantSlug: "fresh-roaster",
      status: "claimed",
      contact: "hello@fresh-roaster.com",
      note: "Operator approved access."
    });

    await repositories.putOffer({
      offerId: "offer_fresh",
      merchantSlug: "fresh-roaster",
      title: "Free shipping",
      summary: "Free shipping on two bags or more.",
      countryCodes: ["US"],
      activeFrom: "2026-03-10T00:00:00Z",
      validThrough: "2026-04-10T00:00:00Z",
      offerType: "free_shipping",
      termsText: "Applies to domestic orders only.",
      priority: 75,
      publicProofUrl: undefined,
      offerCode: undefined,
      status: "active",
      verticalMetadata: {}
    });

    const secondResponse = await app.fetch(
      new Request("https://lobsterbrew.test/internal/materialize", {
        method: "POST",
        headers: {
          authorization: "Bearer test-operator-token"
        }
      })
    );

    expect(secondResponse.status).toBe(200);
    expect((await artifacts.getRootSkill()) ?? "").toContain("# Lobster Bazaar Root Skill");
    expect((await artifacts.getCategorySkill("coffee")) ?? "").toContain("# Lobster Bazaar Coffee Skill");
    expect((await artifacts.getCategoryCountry("coffee", "US"))?.merchants.map((merchant) => merchant.slug)).toEqual([
      "claimed-roaster",
      "fresh-roaster",
      "sample-roaster"
    ]);
    expect((await artifacts.getCategoryOffers("coffee", "US"))?.offers.map((offer) => offer.offerId)).toEqual([
      "offer_fresh",
      "offer_active"
    ]);
    expect(await artifacts.getCategoryMerchant("coffee", "fresh-roaster")).not.toBeNull();
  });

  it("supports incremental materialize from a since timestamp", async () => {
    const { app, artifacts, repositories } = await createTestHarness();

    const firstResponse = await app.fetch(
      new Request("https://lobsterbrew.test/internal/materialize", {
        method: "POST",
        headers: {
          authorization: "Bearer test-operator-token"
        }
      })
    );

    expect(firstResponse.status).toBe(200);
    expect((await artifacts.getCategoryCountry("coffee", "US"))?.merchants.map((merchant) => merchant.slug)).toEqual([
      "claimed-roaster",
      "sample-roaster"
    ]);

    await repositories.putMerchant({
      slug: "fresh-roaster",
      displayName: "Fresh Roaster",
      storeUrl: "https://fresh-roaster.com",
      storeDomain: "fresh-roaster.myshopify.com",
      storefrontMcpUrl: undefined,
      countryCodes: ["US"],
      categorySlugs: ["coffee"],
      locationsSummary: "2 cafes",
      notes: "Freshly imported for incremental materialization coverage.",
      tags: ["coffee"],
      claimContact: "hello@fresh-roaster.com",
      claimStatus: "claimed",
      verticalMetadata: {},
      createdAt: "2026-03-16T12:00:00Z",
      updatedAt: "2026-03-16T12:00:00Z"
    });

    await repositories.putClaim({
      claimId: "claim_fresh_roaster",
      merchantSlug: "fresh-roaster",
      status: "claimed",
      contact: "hello@fresh-roaster.com",
      note: "Operator approved access.",
      createdAt: "2026-03-16T12:00:00Z",
      updatedAt: "2026-03-16T12:00:00Z"
    });

    await repositories.putOffer({
      offerId: "offer_fresh",
      merchantSlug: "fresh-roaster",
      title: "Free shipping",
      summary: "Free shipping on two bags or more.",
      countryCodes: ["US"],
      activeFrom: "2026-03-10T00:00:00Z",
      validThrough: "2026-04-10T00:00:00Z",
      offerType: "free_shipping",
      termsText: "Applies to domestic orders only.",
      priority: 75,
      publicProofUrl: undefined,
      offerCode: undefined,
      status: "active",
      verticalMetadata: {},
      createdAt: "2026-03-16T12:00:00Z",
      updatedAt: "2026-03-16T12:00:00Z"
    });

    const secondResponse = await app.fetch(
      new Request("https://lobsterbrew.test/internal/materialize?since=2026-03-15T23:59:59Z", {
        method: "POST",
        headers: {
          authorization: "Bearer test-operator-token"
        }
      })
    );

    expect(secondResponse.status).toBe(200);
    expect((await artifacts.getCategoryCountry("coffee", "US"))?.merchants.map((merchant) => merchant.slug)).toEqual([
      "claimed-roaster",
      "fresh-roaster",
      "sample-roaster"
    ]);
    expect((await artifacts.getCategoryOffers("coffee", "US"))?.offers.map((offer) => offer.offerId)).toEqual([
      "offer_fresh",
      "offer_active"
    ]);
  });

  it("returns 400 when since is invalid", async () => {
    const { app } = await createTestHarness();

    const response = await app.fetch(
      new Request("https://lobsterbrew.test/internal/materialize?since=not-a-date", {
        method: "POST",
        headers: {
          authorization: "Bearer test-operator-token"
        }
      })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.message).toContain("`since` must be an ISO timestamp");
    expect(body.error.code).toBe("bad_request");
  });

  it("records snapshot counts for successful materialize runs", async () => {
    const { app, metrics } = await createTestHarness();

    const response = await app.fetch(
      new Request("https://lobsterbrew.test/internal/materialize", {
        method: "POST",
        headers: {
          authorization: "Bearer test-operator-token"
        }
      })
    );

    expect(response.status).toBe(200);
    const metric = lastMetricWrite(metrics as RecordingMetricsDataset);
    expect(metric.blobs).toEqual([
      "materialize_success",
      "lobsterbrew",
      "coffee",
      "/internal/materialize",
      "POST",
      "ok",
      "2xx",
      "",
      "",
      ""
    ]);
    const doubles = metric.doubles ?? [];
    expect(doubles.slice(3)).toEqual([2, 1, 1, 2]);
  });

  it("records snapshot counts without rematerializing artifacts", async () => {
    const { app, metrics } = await createTestHarness();

    const response = await app.fetch(
      new Request("https://lobsterbrew.test/internal/metrics/materialize", {
        method: "POST",
        headers: {
          authorization: "Bearer test-operator-token"
        }
      })
    );

    expect(response.status).toBe(200);
    const metric = lastMetricWrite(metrics as RecordingMetricsDataset);
    expect(metric.blobs).toEqual([
      "materialize_success",
      "lobsterbrew",
      "coffee",
      "/internal/metrics/materialize",
      "POST",
      "ok",
      "2xx",
      "",
      "",
      ""
    ]);
    expect((metric.doubles ?? []).slice(3)).toEqual([2, 1, 1, 2]);
  });

  it("does not fail successful requests when the metrics binding throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failingMetrics = {
      writeDataPoint(): void {
        throw new Error("metrics unavailable");
      }
    } as unknown as AnalyticsEngineDataset;
    const { app } = await createTestHarness({ metricsDataset: failingMetrics });

    const response = await app.fetch(new Request("https://lobsterbrew.test/skill.md"));

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not fail materialize when the metrics snapshot lookup throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    class ThrowingSnapshotRepositories extends MemoryRepositories {
      override async getMetricsSnapshot(): Promise<never> {
        throw new Error("snapshot unavailable");
      }
    }

    const repositories = new ThrowingSnapshotRepositories();
    const { app } = await createTestHarness({
      repositories,
      metricsDataset: new RecordingMetricsDataset() as unknown as AnalyticsEngineDataset
    });

    const response = await app.fetch(
      new Request("https://lobsterbrew.test/internal/materialize", {
        method: "POST",
        headers: {
          authorization: "Bearer test-operator-token"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
