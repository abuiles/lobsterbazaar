import { describe, expect, it } from "vitest";

import { createTestHarness, requestJson } from "./helpers";

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
    notes: string;
    claim_status: string;
    active_offers_count: number;
  }>;
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
    slug: string;
    display_name: string;
    store_url: string;
  };
  mcp: {
    url: string;
  };
  cart_attributes: Array<{
    key: string;
    value: string;
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
    expect(secondMerchant?.slug).toBe("sample-roaster");
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
    expect(body.merchant.slug).toBe("claimed-roaster");
    expect(body.mcp.url).toBe("https://claimed-roaster.myshopify.com/api/mcp");
    expect(body.cart_attributes).toEqual([
      {
        key: "lb_source__",
        value: "lobsterbrew"
      }
    ]);
  });

  it("renders the generated skill markdown", async () => {
    const { app } = await createTestHarness();

    const response = await app.fetch(new Request("https://lobsterbrew.test/skill.md"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("# Lobster Bazaar Skill");
    expect(body).toContain("POST to `https://lobsterbrew.test/claws/register`");
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
