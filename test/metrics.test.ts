import { describe, expect, it } from "vitest";

import { prepareRequestMetric, recordRequestMetric } from "../src/metrics";
import { RecordingMetricsDataset } from "./helpers";

describe("metrics helpers", () => {
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
