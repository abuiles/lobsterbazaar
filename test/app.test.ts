import { describe, expect, it } from "vitest";

import { createTestHarness, requestJson, requestText } from "./helpers";

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

describe("lobsterbazaar worker", () => {
  it("registers buyer claws and returns a one-time api key", async () => {
    const { app, repositories } = await createTestHarness();

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
    expect(secondMerchant?.slug).toBe("sample-roaster");
    expect(secondMerchant?.summary).toBe("20+");
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

  it("includes no share section in skill.md when no X handle is configured", async () => {
    const { app } = await createTestHarness();

    const { response, body } = await requestText(app, "/skill.md");

    expect(response.status).toBe(200);
    expect(body).not.toContain("## Optional Share");
    expect(body).not.toContain("Human-approved, lobster-assembled.");
  });

  it("includes an owner-controlled X share suggestion when configured", async () => {
    const { app } = await createTestHarness({
      ownerShareXHandle: "@lobsterbrew"
    });

    const { response, body } = await requestText(app, "/skill.md");

    expect(response.status).toBe(200);
    expect(body).toContain("## Optional Share");
    expect(body).toContain("@lobsterbrew");
    expect(body).toContain("Do not post automatically");
    expect(body).toContain("Do not imply that checkout is completed");
    expect(body).toContain("Human-approved, lobster-assembled.");
  });

  it("uses a custom share tagline when configured", async () => {
    const { app } = await createTestHarness({
      ownerShareXHandle: "lobsterbrew",
      ownerShareTagline: "Cart built by claw, approved by human."
    });

    const { body } = await requestText(app, "/skill.md");

    expect(body).toContain("Cart built by claw, approved by human.");
    expect(body).not.toContain("Human-approved, lobster-assembled.");
  });

  it("renders the landing page with an explicit agent setup prompt", async () => {
    const { app } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Send your AI agent to Lobster Bazaar");
    expect(body).toContain("Prompt to send to your AI agent");
    expect(body).toContain("https://lobsterbrew.test/skill.md");
    expect(body).toContain("Setup flow");
    expect(body).toContain("toggle theme");
    expect(body).toContain('/assets/mascots/lobsterbazaar-default.jpg');
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
    expect(body).toContain("summary: 5+");
    expect(body).toContain("connect_path: `/merchants/claimed-roaster/connect.md`");
    expect(body).toContain("connect_url: `https://lobsterbrew.test/merchants/claimed-roaster/connect.md`");
    expect(body).toContain("- sample-roaster: no active offers");
    expect(body).toContain("summary: 20+");
    expect(body).toContain("connect_path: `/merchants/sample-roaster/connect.md`");
    expect(body).toContain("connect_url: `https://lobsterbrew.test/merchants/sample-roaster/connect.md`");
  });

  it("returns 404 and skips artifact creation for unsupported countries", async () => {
    const { app, artifacts } = await createTestHarness();

    const unsupportedCountryResponse = await requestJson<ErrorResponse>(app, "/countries/ZZ");
    const unsupportedOffersResponse = await requestJson<ErrorResponse>(app, "/offers/ZZ");

    expect(unsupportedCountryResponse.response.status).toBe(404);
    expect(unsupportedOffersResponse.response.status).toBe(404);
    expect(await artifacts.getCountry("ZZ")).toBeNull();
    expect(await artifacts.getOffers("ZZ")).toBeNull();
  });

  it("returns merchant MCP connect payload with lb_source__", async () => {
    const { app } = await createTestHarness();

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
    const { app } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/skill.md"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("---\nname: lobsterbrew");
    expect(body).toContain("homepage: lobsterbrew.test");
    expect(body).toContain("# Lobster Bazaar Skill");
    expect(body).toContain("Base URL: lobsterbrew.test");
    expect(body).toContain("Use it when the owner wants to buy coffee.");
    expect(body).toContain("POST to `lobsterbrew.test/claws/register`");
    expect(body).toContain("`GET lobsterbrew.test/countries.md`");
    expect(body).toContain("`GET lobsterbrew.test/countries/{country_code}.md`");
    expect(body).toContain("`GET lobsterbrew.test/offers/{country_code}.md`");
    expect(body).toContain("`lobsterbrew.test/merchants/{slug}/connect.md`");
    expect(body).toContain("Shopify Storefront MCP");
    expect(body).toContain("Treat merchant MCP data as the source of truth");
    expect(body).toContain("Do not infer merchant MCP URLs yourself");
    expect(body).toContain("Prefer the `.md` endpoints for agent consumption.");
    expect(body).toContain("## Subscription products");
    expect(body).toContain("do not attempt a normal cart add without a `sellingPlanId`.");
    expect(body).toContain("Shopify Storefront GraphQL `cartCreate` as the subscription-only fallback.");
    expect(body).toContain("Highlight subscription savings");
    expect(body).toContain("resolution_path = storefront_graphql_fallback");
    expect(body).toContain("lb_source__ = lobsterbrew");
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
});
