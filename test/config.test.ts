import { describe, expect, it } from "vitest";

import { readDeployConfig, type Env } from "../src/config";

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ARTIFACTS: {} as R2Bucket,
    DEPLOY_ID: "lobsterstores",
    VERTICAL_ID: "directory",
    BRAND_NAME: "Lobster Stores",
    DEPLOY_DOMAIN: "lobsterstores.com",
    VERTICAL_SUMMARY: "Category-first merchant discovery for OpenClaw and AI shoppers.",
    ROOT_SURFACE_JSON: JSON.stringify({
      sectionOrder: ["hero", "categories", "merchant_onboarding"],
      hero: {
        title: "Help OpenClaw discover the right Shopify store.",
        body: "Start with categories."
      },
      merchantOnboarding: {
        ctaLabel: "Install the Shopify app",
        ctaHref: "https://apps.shopify.com/store-agent-kit"
      }
    }),
    ...overrides
  };
}

describe("readDeployConfig", () => {
  it("parses optional root surface config from the environment", () => {
    const config = readDeployConfig(createEnv());

    expect(config.rootSurface?.sectionOrder).toEqual(["hero", "categories", "merchant_onboarding"]);
    expect(config.rootSurface?.hero?.title).toBe("Help OpenClaw discover the right Shopify store.");
    expect(config.rootSurface?.merchantOnboarding?.ctaHref).toBe("https://apps.shopify.com/store-agent-kit");
  });

  it("rejects invalid root surface json", () => {
    expect(() => readDeployConfig(createEnv({ ROOT_SURFACE_JSON: "{not json}" }))).toThrow(
      /ROOT_SURFACE_JSON must be valid JSON/
    );
  });
});
