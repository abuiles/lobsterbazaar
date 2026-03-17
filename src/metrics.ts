import type { DeployConfig, MetricsSnapshot, RegisterClawInput } from "./domain";
import { normalizeCountryCode } from "./merchant";

const COUNTRIES_ROUTE_PATTERN = /^\/countries\/([A-Za-z]{2,3})$/;
const OFFERS_ROUTE_PATTERN = /^\/offers\/([A-Za-z]{2,3})$/;
const MERCHANT_CONNECT_ROUTE_PATTERN = /^\/merchants\/([^/]+)\/connect$/;

type TrackedEventName =
  | "landing_view"
  | "skill_view"
  | "countries_index_view"
  | "country_view"
  | "offers_view"
  | "merchant_connect_view"
  | "claw_register_success"
  | "claw_register_failure"
  | "materialize_success"
  | "materialize_failure";

interface RouteMetricDefinition {
  eventName: Exclude<TrackedEventName, "claw_register_success" | "claw_register_failure" | "materialize_success" | "materialize_failure">;
  routeId: string;
  merchantSlug?: string;
  countryCode?: string;
  actorRole?: RegisterClawInput["role"];
}

export interface PreparedRequestMetric extends RouteMetricDefinition {
  method: string;
}

interface RecordRequestMetricInput {
  dataset?: AnalyticsEngineDataset;
  config: Pick<DeployConfig, "deployId" | "verticalId">;
  metric: PreparedRequestMetric | null;
  response: Response;
  durationMs: number;
  error?: unknown;
  snapshot?: MetricsSnapshot;
}

function normalizeStatusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

function normalizeOutcome(error: unknown, status: number): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }

  if (status >= 500) {
    return "internal_error";
  }

  if (status === 404) {
    return "not_found";
  }

  if (status === 409) {
    return "conflict";
  }

  if (status === 403) {
    return "forbidden";
  }

  if (status === 401) {
    return "unauthorized";
  }

  if (status === 400) {
    return "bad_request";
  }

  return "ok";
}

function resolveEventName(routeMetric: PreparedRequestMetric, response: Response): TrackedEventName {
  if (routeMetric.routeId === "/claws/register") {
    return response.status < 400 ? "claw_register_success" : "claw_register_failure";
  }

  if (routeMetric.routeId === "/internal/materialize") {
    return response.status < 400 ? "materialize_success" : "materialize_failure";
  }

  return routeMetric.eventName;
}

async function parseRegisterMetricPayload(request: Request): Promise<Pick<RouteMetricDefinition, "actorRole" | "merchantSlug">> {
  try {
    const body = await request.clone().json() as Partial<Record<keyof RegisterClawInput | "merchant_slug", unknown>>;
    const actorRole = body.role === "buyer" || body.role === "merchant" ? body.role : undefined;
    const merchantSlug =
      typeof body.merchant_slug === "string"
        ? body.merchant_slug.trim()
        : typeof body.merchantSlug === "string"
          ? body.merchantSlug.trim()
          : undefined;

    return {
      actorRole,
      merchantSlug: merchantSlug || undefined
    };
  } catch {
    return {};
  }
}

export async function prepareRequestMetric(request: Request, normalizedPath: string): Promise<PreparedRequestMetric | null> {
  const method = request.method.toUpperCase();

  if (normalizedPath === "/") {
    return {
      eventName: "landing_view",
      routeId: "/",
      method
    };
  }

  if (normalizedPath === "/skill") {
    return {
      eventName: "skill_view",
      routeId: "/skill",
      method
    };
  }

  if (normalizedPath === "/countries") {
    return {
      eventName: "countries_index_view",
      routeId: "/countries",
      method
    };
  }

  const countryMatch = normalizedPath.match(COUNTRIES_ROUTE_PATTERN);
  if (countryMatch) {
    return {
      eventName: "country_view",
      routeId: "/countries/:country_code",
      countryCode: normalizeCountryCode(countryMatch[1] ?? ""),
      method
    };
  }

  const offersMatch = normalizedPath.match(OFFERS_ROUTE_PATTERN);
  if (offersMatch) {
    return {
      eventName: "offers_view",
      routeId: "/offers/:country_code",
      countryCode: normalizeCountryCode(offersMatch[1] ?? ""),
      method
    };
  }

  const merchantConnectMatch = normalizedPath.match(MERCHANT_CONNECT_ROUTE_PATTERN);
  if (merchantConnectMatch) {
    return {
      eventName: "merchant_connect_view",
      routeId: "/merchants/:slug/connect",
      merchantSlug: merchantConnectMatch[1] ?? "",
      method
    };
  }

  if (normalizedPath === "/claws/register") {
    const payload = await parseRegisterMetricPayload(request);
    return {
      eventName: "landing_view",
      routeId: "/claws/register",
      actorRole: payload.actorRole,
      merchantSlug: payload.merchantSlug,
      method
    };
  }

  if (normalizedPath === "/internal/materialize") {
    return {
      eventName: "landing_view",
      routeId: "/internal/materialize",
      method
    };
  }

  return null;
}

export function recordRequestMetric({
  dataset,
  config,
  metric,
  response,
  durationMs,
  error,
  snapshot
}: RecordRequestMetricInput): void {
  if (!dataset || !metric) {
    return;
  }

  const eventName = resolveEventName(metric, response);
  dataset.writeDataPoint({
    blobs: [
      eventName,
      config.deployId,
      config.verticalId,
      metric.routeId,
      metric.method,
      normalizeOutcome(error, response.status),
      normalizeStatusClass(response.status),
      metric.actorRole ?? "",
      metric.merchantSlug ?? "",
      metric.countryCode ?? ""
    ],
    doubles: [
      1,
      Math.max(0, Math.round(durationMs)),
      response.status,
      snapshot?.merchantCount ?? 0,
      snapshot?.activeOfferCount ?? 0,
      snapshot?.claimedMerchantCount ?? 0,
      snapshot?.countryCount ?? 0
    ],
    indexes: [config.verticalId || config.deployId]
  });
}
