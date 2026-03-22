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
    VERTICAL_SUMMARY: "Category-first merchant discovery for AI shoppers.",
    LANDING_FOOTER_MARKDOWN: "# Merchant onboarding\n\nInstall the Shopify app to manage your listing.",
    ...overrides
  };
}

describe("readDeployConfig", () => {
  it("reads optional landing footer markdown from the environment", () => {
    const config = readDeployConfig(createEnv());

    expect(config.landingFooterMarkdown).toBe(
      "# Merchant onboarding\n\nInstall the Shopify app to manage your listing."
    );
  });

  it("trims empty landing footer markdown to undefined", () => {
    const config = readDeployConfig(createEnv({ LANDING_FOOTER_MARKDOWN: "   " }));

    expect(config.landingFooterMarkdown).toBeUndefined();
  });
});
