import { describe, expect, it, vi } from "vitest";

import { createTestHarness, requestJson, requestText, RecordingMetricsDataset } from "./helpers";
import { MemoryRepositories } from "../src/memory";

interface RegisterResponse {
  claw: {
    claw_id: string;
    role: string;
    display_name: string;
    api_key: string;
  };
  important: string;
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

interface CountryResponse {
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

interface CountriesResponse {
  generated_at: string;
  countries: string[];
}

interface OffersResponse {
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

interface MerchantConnectResponse {
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

describe("lobsterbazaar worker", () => {
  it("registers buyer claws and returns a one-time api key", async () => {
    const { app, repositories, metrics } = await createTestHarness();

    const { response, body } = await requestJson<RegisterResponse>(app, "/claws/register", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        role: "buyer",
        display_name: "kitchen claw"
      })
    });

    expect(response.status).toBe(201);
    expect(body.claw.role).toBe("buyer");
    expect(body.claw.display_name).toBe("kitchen claw");
    expect(body.claw.api_key).toMatch(/^lobsterbrew_/);
    expect(body.important).toMatch(/Save your API key/i);

    const claws = await repositories.listClaws();
    expect(claws).toHaveLength(1);
    expect(claws[0]?.apiKeyHash).not.toBe(body.claw.api_key);
    expect(lastMetricWrite(metrics as RecordingMetricsDataset).blobs).toEqual([
      "claw_register_success",
      "lobsterbrew",
      "coffee",
      "/claws/register",
      "POST",
      "ok",
      "2xx",
      "buyer",
      "",
      ""
    ]);
  });

  it("rejects merchant claw registration for unclaimed merchants", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestJson<ErrorResponse>(app, "/claws/register", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        role: "merchant",
        display_name: "merchant claw",
        merchant_slug: "sample-roaster"
      })
    });

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("conflict");
  });

  it("rejects merchant claw registration without operator-managed claim access", async () => {
    const { app } = await createTestHarness({
      includeClaimAccess: false,
      includeSeedOffers: false
    });

    const { response, body } = await requestJson<ErrorResponse>(app, "/claws/register", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        role: "merchant",
        display_name: "merchant claw",
        merchant_slug: "claimed-roaster"
      })
    });

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("conflict");
  });

  it("registers merchant claws when operator-managed claim access exists", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestJson<RegisterResponse>(app, "/claws/register", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        role: "merchant",
        display_name: "merchant claw",
        merchant_slug: "claimed-roaster"
      })
    });

    expect(response.status).toBe(201);
    expect(body.claw.role).toBe("merchant");
    expect(body.claw.display_name).toBe("merchant claw");
  });

  it("orders country merchants with active offers first", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestJson<CountryResponse>(app, "/countries/US");

    expect(response.status).toBe(200);
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

    const { response, body } = await requestJson<OffersResponse>(app, "/offers/US");

    expect(response.status).toBe(200);
    expect(body.country_code).toBe("US");
    expect(body.offers).toHaveLength(1);
    const [firstOffer] = body.offers;
    expect(firstOffer?.offer_id).toBe("offer_active");
    expect(firstOffer?.merchant_slug).toBe("claimed-roaster");
  });

  it("returns all available countries", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestJson<CountriesResponse>(app, "/countries");

    expect(response.status).toBe(200);
    expect(body.generated_at).toBe("2026-03-15T12:00:00Z");
    expect(body.countries).toEqual(["CA", "US"]);
  });

  it("returns available countries as markdown", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestText(app, "/countries.md");

    expect(response.status).toBe(200);
    expect(body).toContain("# Available Countries");
    expect(body).toContain("- CA");
    expect(body).toContain("- US");
  });

  it("serves head requests for skill markdown", async () => {
    const { app } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/skill.md", {
      method: "HEAD"
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
  });

  it("renders the landing page with the default mascot slot", async () => {
    const { app } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(">Lobster Bazaar<");
    expect(body).toContain("Coffee-oriented merchant discovery for lobsters.");
    expect(body).toContain("Send your agent to Lobster Bazaar");
    expect(body).toContain("Built for OpenClaw, but it works with Codex, Cursor, Claude Code, or any agent that can read a URL and follow instructions.");
    expect(body).toContain("Read https://lobsterbrew.test/skill.md and follow the instructions to browse the directory and connect to the right merchant MCP.");
    expect(body).toContain("Skill install instruction");
    expect(body.indexOf('data-surface-tab="install">install skill')).toBeLessThan(
      body.indexOf('data-surface-tab="featured">featured merchants')
    );
    expect(body.indexOf('data-surface-tab="featured">featured merchants')).toBeLessThan(
      body.indexOf('data-surface-tab="directory">directory')
    );
    expect(body).toContain("Featured Merchants");
    expect(body).toContain("Sample Roaster");
    expect(body).toContain("Known for washed coffees and bright acidity.");
    expect(body).toContain('href="https://sample-roaster.com"');
    expect(body).toContain("sample-roaster.com");
    expect(body).toContain("Let the agent read the skill and pick a merchant");
    expect(body).toContain("All Lobster Categories");
    expect(body).toContain("Lobster Bread");
    expect(body).toContain("lobsterbread.com");
    expect(body).toContain("host-agnostic install surface:");
    expect(body).toContain("toggle theme");
    expect(body).toContain("hello@lobsterstores.com");
    expect(body).toContain("source code on GitHub");
    expect(body).toContain("powered by");
    expect(body).toContain('/assets/mascots/lobsterbazaar-default.jpg');
  });

  it("hides the featured merchants surface when no merchants are featured", async () => {
    const { app, repositories } = await createTestHarness();

    await repositories.putMerchant({
      slug: "sample-roaster",
      displayName: "Sample Roaster",
      storeUrl: "https://sample-roaster.com",
      storeDomain: "sample-roaster.myshopify.com",
      storefrontMcpUrl: undefined,
      countryCodes: ["US"],
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

    await repositories.putMerchant({
      slug: "alpha-roaster",
      displayName: "Alpha Roaster",
      storeUrl: "https://alpha-roaster.com",
      storeDomain: "alpha-roaster.myshopify.com",
      storefrontMcpUrl: undefined,
      countryCodes: ["US"],
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

    const { response, body } = await requestText(app, "/offers/US.md");

    expect(response.status).toBe(200);
    expect(body).toContain("# Active Offers in US");
    expect(body).toContain("10% off first order");
  });

  it("returns country markdown with connect links for each merchant", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestText(app, "/countries/US.md");

    expect(response.status).toBe(200);
    expect(body).toContain("- claimed-roaster: 1 active offer(s)");
    expect(body).toContain("description: Runs small seasonal releases.");
    expect(body).toContain("summary: 5+");
    expect(body).toContain("connect_path: `/merchants/claimed-roaster/connect.md`");
    expect(body).toContain("connect_url: `https://lobsterbrew.test/merchants/claimed-roaster/connect.md`");
    expect(body).toContain("- sample-roaster: no active offers");
    expect(body).toContain("description: Known for washed coffees and bright acidity.");
    expect(body).toContain("summary: 20+");
    expect(body).toContain("connect_path: `/merchants/sample-roaster/connect.md`");
    expect(body).toContain("connect_url: `https://lobsterbrew.test/merchants/sample-roaster/connect.md`");
  });

  it("returns 404 and skips artifact creation for unsupported countries", async () => {
    const { app, artifacts, metrics } = await createTestHarness();

    const unsupportedCountryResponse = await requestJson<ErrorResponse>(app, "/countries/ZZ");
    const unsupportedOffersResponse = await requestJson<ErrorResponse>(app, "/offers/ZZ");

    expect(unsupportedCountryResponse.response.status).toBe(404);
    expect(unsupportedOffersResponse.response.status).toBe(404);
    expect(await artifacts.getCountry("ZZ")).toBeNull();
    expect(await artifacts.getOffers("ZZ")).toBeNull();
    expect(lastMetricWrite(metrics as RecordingMetricsDataset).blobs).toEqual([
      "offers_view",
      "lobsterbrew",
      "coffee",
      "/offers/:country_code",
      "GET",
      "not_found",
      "4xx",
      "",
      "",
      "ZZ"
    ]);
  });

  it("returns merchant MCP connect payload with lb_source__", async () => {
    const { app, metrics } = await createTestHarness();

    const { response, body } = await requestJson<MerchantConnectResponse>(
      app,
      "/merchants/claimed-roaster/connect"
    );

    expect(response.status).toBe(200);
    expect(body.merchant.name).toBe("Claimed Roaster");
    expect(body.merchant.connect_path).toBe("/merchants/claimed-roaster/connect");
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
      "/merchants/:slug/connect",
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

    const { response, body } = await requestText(app, "/merchants/claimed-roaster/connect.md");

    expect(response.status).toBe(200);
    expect(body).toContain("# Merchant Connect Prompt");
    expect(body).toContain("Use this context block before sending MCP calls for this merchant.");
    expect(body).toContain("merchant_name: `Claimed Roaster`");
    expect(body).toContain("merchant_slug: `claimed-roaster`");
    expect(body).toContain("connect_path: `/merchants/claimed-roaster/connect`");
    expect(body).toContain("store_url: `https://claimed-roaster.com`");
    expect(body).toContain("storefront_mcp_url: `https://claimed-roaster.myshopify.com/api/mcp`");
    expect(body).toContain("10% off first order");
    expect(body).toContain("cart_attributes:");
    expect(body).toContain("lb_source__: lobsterbrew");
  });

  it("renders the generated skill markdown", async () => {
    const { app, metrics } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/skill.md"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("---\nname: lobsterbrew");
    expect(body).toContain("homepage: lobsterbrew.test");
    expect(body).toContain("# Lobster Bazaar Skill");
    expect(body).toContain("Version: 1.1.0");
    expect(body).toContain("Base URL: lobsterbrew.test");
    expect(body).toContain("Use it when the owner wants to buy coffee, subscriptions, and brewing gear.");
    expect(body).toContain("`GET lobsterbrew.test/countries.md`");
    expect(body).toContain("`GET lobsterbrew.test/countries/{country_code}.md`");
    expect(body).toContain("`GET lobsterbrew.test/offers/{country_code}.md`");
    expect(body).toContain("`lobsterbrew.test/merchants/{slug}/connect.md`");
    expect(body).toContain("Shopify Storefront MCP");
    expect(body).toContain("Uses the installed skill file as the authoritative instruction source");
    expect(body).toContain("Do not re-fetch remote instructions during normal use");
    expect(body).toContain("Treat merchant MCP data as the source of truth");
    expect(body).toContain("Do not infer merchant MCP URLs yourself");
    expect(body).toContain("Prefer the `.md` endpoints for agent consumption.");
    expect(body).toContain("## Subscription products");
    expect(body).toContain("do not attempt a normal cart add without a `sellingPlanId`.");
    expect(body).toContain("merchant flow is not supported yet");
    expect(body).toContain("Highlight subscription savings");
    expect(body).toContain("resolution_path = unsupported_subscription_flow");
    expect(body).toContain("lb_source__ = lobsterbrew");
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

  it("rematerializes cached country and offers artifacts with fresh repository data", async () => {
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
    expect((await artifacts.getCountry("US"))?.merchants.map((merchant) => merchant.slug)).toEqual([
      "claimed-roaster",
      "sample-roaster"
    ]);
    expect((await artifacts.getOffers("US"))?.offers.map((offer) => offer.offerId)).toEqual(["offer_active"]);

    await repositories.putMerchant({
      slug: "fresh-roaster",
      displayName: "Fresh Roaster",
      storeUrl: "https://fresh-roaster.com",
      storeDomain: "fresh-roaster.myshopify.com",
      storefrontMcpUrl: undefined,
      countryCodes: ["US"],
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
    expect((await artifacts.getCountry("US"))?.merchants.map((merchant) => merchant.slug)).toEqual([
      "claimed-roaster",
      "fresh-roaster",
      "sample-roaster"
    ]);
    expect((await artifacts.getOffers("US"))?.offers.map((offer) => offer.offerId)).toEqual([
      "offer_fresh",
      "offer_active"
    ]);
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
    expect((await artifacts.getCountry("US"))?.merchants.map((merchant) => merchant.slug)).toEqual([
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
    expect((await artifacts.getCountry("US"))?.merchants.map((merchant) => merchant.slug)).toEqual([
      "claimed-roaster",
      "fresh-roaster",
      "sample-roaster"
    ]);
    expect((await artifacts.getOffers("US"))?.offers.map((offer) => offer.offerId)).toEqual([
      "offer_fresh",
      "offer_active"
    ]);
  });

  it("supports materializing only skill.md", async () => {
    const { app, artifacts } = await createTestHarness();

    await artifacts.putSkill("Version: 0.0.0\n");

    const response = await app.fetch(
      new Request("https://lobsterbrew.test/internal/materialize?target=skill", {
        method: "POST",
        headers: {
          authorization: "Bearer test-operator-token"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(await artifacts.getSkill()).toContain("Version: 1.1.0");
    expect(await artifacts.getCountry("US")).toBeNull();
    expect(await artifacts.getOffers("US")).toBeNull();
    expect(await artifacts.getMerchant("sample-roaster")).toBeNull();
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

  it("returns 400 when target is invalid", async () => {
    const { app } = await createTestHarness();

    const response = await app.fetch(
      new Request("https://lobsterbrew.test/internal/materialize?target=offers", {
        method: "POST",
        headers: {
          authorization: "Bearer test-operator-token"
        }
      })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.message).toContain("`target` must be `skill` when provided");
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
