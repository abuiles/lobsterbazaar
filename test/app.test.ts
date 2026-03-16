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
});
