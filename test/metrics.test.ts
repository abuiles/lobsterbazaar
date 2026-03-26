import { describe, expect, it } from "vitest";

import { prepareRequestMetric, recordRequestMetric } from "../src/metrics";
import { RecordingMetricsDataset } from "./helpers";

describe("metrics helpers", () => {
  it("parses category-aware public routes", async () => {
    const categoriesMetric = await prepareRequestMetric(
      new Request("https://lobsterbrew.test/categories", {
        method: "GET"
      }),
      "/categories"
    );

    expect(categoriesMetric).toEqual({
      eventName: "categories_index_view",
      routeId: "/categories",
      method: "GET"
    });

    const categorySkillMetric = await prepareRequestMetric(
      new Request("https://lobsterbrew.test/coffee/skill.md", {
        method: "GET"
      }),
      "/coffee/skill"
    );

    expect(categorySkillMetric).toBeNull();

    const categoryCountryMetric = await prepareRequestMetric(
      new Request("https://lobsterbrew.test/coffee/countries/US", {
        method: "GET"
      }),
      "/coffee/countries/US"
    );

    expect(categoryCountryMetric).toEqual({
      eventName: "country_view",
      routeId: "/:category/countries/:country_code",
      categorySlug: "coffee",
      countryCode: "US",
      method: "GET"
    });

    const categoryConnectMetric = await prepareRequestMetric(
      new Request("https://lobsterbrew.test/bread/merchants/claimed-roaster/connect", {
        method: "GET"
      }),
      "/bread/merchants/claimed-roaster/connect"
    );

    expect(categoryConnectMetric).toEqual({
      eventName: "merchant_connect_view",
      routeId: "/:category/merchants/:slug/connect",
      categorySlug: "bread",
      merchantSlug: "claimed-roaster",
      method: "GET"
    });
  });

  it("uses category slug as the metric scope when available", () => {
    const dataset = new RecordingMetricsDataset();

    recordRequestMetric({
      dataset: dataset as unknown as AnalyticsEngineDataset,
      config: {
        deployId: "lobsterbrew",
        verticalId: "directory"
      },
      metric: {
        eventName: "offers_view",
        routeId: "/:category/offers/:country_code",
        categorySlug: "coffee",
        countryCode: "US",
        method: "GET"
      },
      response: new Response(null, { status: 200 }),
      durationMs: 8
    });

    expect(dataset.writes[0]?.blobs).toEqual([
      "offers_view",
      "lobsterbrew",
      "coffee",
      "/:category/offers/:country_code",
      "GET",
      "ok",
      "2xx",
      "",
      "",
      "US"
    ]);
    expect(dataset.writes[0]?.indexes).toEqual(["coffee"]);
  });

  it("parses register request context and uses vertical_id as the index", async () => {
    const metric = await prepareRequestMetric(
      new Request("https://lobsterbrew.test/claws/register", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          role: "merchant",
          merchant_slug: "claimed-roaster"
        })
      }),
      "/claws/register"
    );

    expect(metric).toEqual({
      eventName: "landing_view",
      routeId: "/claws/register",
      actorRole: "merchant",
      merchantSlug: "claimed-roaster",
      method: "POST"
    });

    const dataset = new RecordingMetricsDataset();
    recordRequestMetric({
      dataset: dataset as unknown as AnalyticsEngineDataset,
      config: {
        deployId: "lobsterbrew",
        verticalId: "coffee"
      },
      metric,
      response: new Response(null, { status: 201 }),
      durationMs: 12
    });

    expect(dataset.writes[0]?.indexes).toEqual(["coffee"]);
    expect(dataset.writes[0]?.blobs).toEqual([
      "claw_register_success",
      "lobsterbrew",
      "coffee",
      "/claws/register",
      "POST",
      "ok",
      "2xx",
      "merchant",
      "claimed-roaster",
      ""
    ]);
  });

  it("does nothing when the dataset binding is absent", () => {
    expect(() =>
      recordRequestMetric({
        config: {
          deployId: "lobsterbrew",
          verticalId: "coffee"
        },
        metric: {
          eventName: "skill_view",
          routeId: "/skill",
          method: "GET"
        },
        response: new Response(null, { status: 200 }),
        durationMs: 5
      })
    ).not.toThrow();
  });
});
