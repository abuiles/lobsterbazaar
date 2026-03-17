import type { DeployConfig, DirectoryVertical } from "./domain";

export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  METRICS?: AnalyticsEngineDataset;
  ASSETS?: Fetcher;
  DEPLOY_ID: string;
  VERTICAL_ID?: string;
  BRAND_NAME: string;
  DEPLOY_DOMAIN: string;
  VERTICAL_SUMMARY: string;
  SKILL_BUYING_TARGETS?: string;
  DEPLOY_MASCOT_URL?: string;
  DEPLOY_EMOJI?: string;
  DIRECTORY_VERTICALS_JSON?: string;
  OPERATOR_TOKEN?: string;
}

function normalizeDirectoryDomain(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.host;
  } catch {
    return trimmed.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
  }
}

function buildDirectoryUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.includes("://") ? trimmed : `https://${trimmed}`;
}

function parseDirectoryVerticals(
  raw: string | undefined,
  fallback: Pick<DeployConfig, "brandName" | "deployId" | "deployDomain" | "emoji">
): DirectoryVertical[] {
  if (!raw?.trim()) {
    const fallbackDomain = normalizeDirectoryDomain(fallback.deployDomain);
    return fallbackDomain
      ? [
          {
            deployId: fallback.deployId,
            brandName: fallback.brandName,
            domain: fallbackDomain,
            url: buildDirectoryUrl(fallback.deployDomain),
            emoji: fallback.emoji
          }
        ]
      : [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DIRECTORY_VERTICALS_JSON must be valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("DIRECTORY_VERTICALS_JSON must be a JSON array");
  }

  const directoryVerticals: DirectoryVertical[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const deployId = typeof entry.deployId === "string" ? entry.deployId.trim() : "";
    const brandName = typeof entry.brandName === "string" ? entry.brandName.trim() : "";
    const deployDomain = typeof entry.domain === "string" ? entry.domain.trim() : "";
    const verticalName = typeof entry.verticalName === "string" && entry.verticalName.trim()
      ? entry.verticalName.trim()
      : undefined;
    const emoji = typeof entry.emoji === "string" && entry.emoji.trim() ? entry.emoji.trim() : undefined;
    const domain = normalizeDirectoryDomain(deployDomain);

    if (!deployId || !brandName || !domain) {
      continue;
    }

    directoryVerticals.push({
      deployId,
      brandName,
      domain,
      url: buildDirectoryUrl(deployDomain),
      verticalName,
      emoji
    });
  }

  return directoryVerticals;
}

export function readDeployConfig(env: Env): DeployConfig {
  const deployId = env.DEPLOY_ID?.trim();
  const verticalId = env.VERTICAL_ID?.trim() || deployId;
  const brandName = env.BRAND_NAME?.trim();
  const deployDomain = env.DEPLOY_DOMAIN?.trim();
  const verticalSummary = env.VERTICAL_SUMMARY?.trim();
  const skillBuyingTargets = env.SKILL_BUYING_TARGETS?.trim() || undefined;
  const mascotUrl = env.DEPLOY_MASCOT_URL?.trim() || "/assets/mascots/lobsterbazaar-default.jpg";
  const emoji = env.DEPLOY_EMOJI?.trim() || "🦞";

  if (!deployId || !brandName || !deployDomain || !verticalSummary) {
    throw new Error("Missing required deploy configuration");
  }

  const directoryVerticals = parseDirectoryVerticals(env.DIRECTORY_VERTICALS_JSON, {
    brandName,
    deployId,
    deployDomain,
    emoji
  });

  return {
    brandName,
    deployId,
    deployDomain,
    verticalId,
    verticalSummary,
    skillBuyingTargets,
    mascotUrl,
    emoji,
    directoryVerticals
  };
}
