import type { DeployConfig } from "./domain";

export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  ASSETS?: Fetcher;
  DEPLOY_ID: string;
  BRAND_NAME: string;
  DEPLOY_DOMAIN: string;
  VERTICAL_SUMMARY: string;
  DEPLOY_MASCOT_URL?: string;
  DEPLOY_EMOJI?: string;
  OPERATOR_TOKEN?: string;
}

export function readDeployConfig(env: Env): DeployConfig {
  const deployId = env.DEPLOY_ID?.trim();
  const brandName = env.BRAND_NAME?.trim();
  const deployDomain = env.DEPLOY_DOMAIN?.trim();
  const verticalSummary = env.VERTICAL_SUMMARY?.trim();
  const mascotUrl = env.DEPLOY_MASCOT_URL?.trim() || "/assets/mascots/lobsterbazaar-default.jpg";
  const emoji = env.DEPLOY_EMOJI?.trim() || "🦞";

  if (!deployId || !brandName || !deployDomain || !verticalSummary) {
    throw new Error("Missing required deploy configuration");
  }

  return {
    brandName,
    deployId,
    deployDomain,
    verticalSummary,
    mascotUrl,
    emoji
  };
}
