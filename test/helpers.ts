import { createApp } from "../src/app";
import { MemoryArtifactStore, MemoryRepositories } from "../src/memory";

export async function createTestHarness() {
  const artifacts = new MemoryArtifactStore();
  const repositories = new MemoryRepositories();

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

  await repositories.putMerchant({
    slug: "claimed-roaster",
    displayName: "Claimed Roaster",
    storeUrl: "https://claimed-roaster.com",
    storeDomain: "claimed-roaster.myshopify.com",
    storefrontMcpUrl: undefined,
    countryCodes: ["US", "CA"],
    locationsSummary: "5+",
    notes: "Runs small seasonal releases.",
    tags: ["coffee"],
    claimContact: "ops@claimed-roaster.com",
    claimStatus: "claimed",
    verticalMetadata: {}
  });

  await repositories.putOffer({
    offerId: "offer_active",
    merchantSlug: "claimed-roaster",
    title: "10% off first order",
    summary: "First-time buyers get 10% off selected coffees.",
    countryCodes: ["US"],
    activeFrom: "2026-03-01T00:00:00Z",
    validThrough: "2026-04-01T00:00:00Z",
    offerType: "discount_code",
    termsText: "Valid on the first order only.",
    priority: 50,
    publicProofUrl: undefined,
    offerCode: "FIRST10",
    status: "active",
    verticalMetadata: {}
  });

  await repositories.putOffer({
    offerId: "offer_expired",
    merchantSlug: "sample-roaster",
    title: "Expired intro offer",
    summary: "This should not be shown.",
    countryCodes: ["US"],
    activeFrom: "2026-02-01T00:00:00Z",
    validThrough: "2026-02-15T00:00:00Z",
    offerType: "discount_code",
    termsText: "Expired.",
    priority: 100,
    publicProofUrl: undefined,
    offerCode: "OLD",
    status: "active",
    verticalMetadata: {}
  });

  const app = createApp({
    artifacts,
    repositories,
    config: {
      brandName: "Lobster Bazaar",
      deployId: "lobsterbrew",
      deployDomain: "lobsterbrew.test",
      verticalSummary: "Coffee-oriented merchant discovery for lobsters."
    },
    operatorToken: "test-operator-token",
    now: () => "2026-03-15T12:00:00Z"
  });

  return { app, artifacts, repositories };
}

export async function requestJson<T>(app: ReturnType<typeof createApp>, input: string, init?: RequestInit) {
  const response = await app.fetch(new Request(`https://lobsterbrew.test${input}`, init));
  const body = (await response.json()) as T;
  return { response, body };
}
