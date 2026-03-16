import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface DeployConfigFile {
  deploy_id: string;
  deploy_domain: string;
  brand_name: string;
  vertical_summary: string;
  skill_buying_targets?: string;
  emoji?: string;
  deploy_mascot_url?: string;
}

type JsonObject = Record<string, unknown>;

function resolveRelativeConfigPath(baseDir: string, value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) {
    return value;
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  if (value.startsWith(".")) {
    return path.resolve(baseDir, value);
  }

  return value;
}

function expandEnvPlaceholders(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
      const replacement = process.env[name];
      if (typeof replacement !== "string" || !replacement) {
        throw new Error(`Missing required environment variable: ${name}`);
      }
      return replacement;
    });
  }

  if (Array.isArray(value)) {
    return value.map((entry) => expandEnvPlaceholders(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, entry]) => [key, expandEnvPlaceholders(entry)])
    );
  }

  return value;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }

  return value.trim();
}

function parseJsonObject(text: string, label: string): JsonObject {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed as JsonObject;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

async function main() {
  const verticalDir = process.argv[2];
  const outputPath = process.argv[3];

  if (!verticalDir || !outputPath) {
    throw new Error("Usage: node scripts/render-vertical-wrangler.ts <vertical-dir> <output-path>");
  }

  const resolvedVerticalDir = path.resolve(verticalDir);
  const [wranglerText, deployConfigText] = await Promise.all([
    readFile(path.join(resolvedVerticalDir, "wrangler.jsonc"), "utf8"),
    readFile(path.join(resolvedVerticalDir, "deploy.config.json"), "utf8")
  ]);

  const wranglerConfig = expandEnvPlaceholders(parseJsonObject(wranglerText, "wrangler.jsonc")) as JsonObject;
  const deployConfig = parseJsonObject(deployConfigText, "deploy.config.json") as unknown as DeployConfigFile;

  const vars: JsonObject = {
    ...(typeof wranglerConfig.vars === "object" && wranglerConfig.vars !== null && !Array.isArray(wranglerConfig.vars)
      ? (wranglerConfig.vars as JsonObject)
      : {}),
    DEPLOY_ID: assertString(deployConfig.deploy_id, "deploy_id"),
    BRAND_NAME: assertString(deployConfig.brand_name, "brand_name"),
    DEPLOY_DOMAIN: assertString(deployConfig.deploy_domain, "deploy_domain"),
    VERTICAL_SUMMARY: assertString(deployConfig.vertical_summary, "vertical_summary"),
    DEPLOY_EMOJI:
      typeof deployConfig.emoji === "string" && deployConfig.emoji.trim() ? deployConfig.emoji.trim() : "🦞"
  };

  if (typeof deployConfig.skill_buying_targets === "string" && deployConfig.skill_buying_targets.trim()) {
    vars.SKILL_BUYING_TARGETS = deployConfig.skill_buying_targets.trim();
  } else {
    delete vars.SKILL_BUYING_TARGETS;
  }

  if (typeof deployConfig.deploy_mascot_url === "string" && deployConfig.deploy_mascot_url.trim()) {
    vars.DEPLOY_MASCOT_URL = deployConfig.deploy_mascot_url.trim();
  } else {
    delete vars.DEPLOY_MASCOT_URL;
  }

  wranglerConfig.$schema = resolveRelativeConfigPath(resolvedVerticalDir, wranglerConfig.$schema);
  wranglerConfig.main = resolveRelativeConfigPath(resolvedVerticalDir, wranglerConfig.main);
  if (typeof wranglerConfig.assets === "object" && wranglerConfig.assets !== null && !Array.isArray(wranglerConfig.assets)) {
    const assets = wranglerConfig.assets as JsonObject;
    assets.directory = resolveRelativeConfigPath(resolvedVerticalDir, assets.directory);
  }
  wranglerConfig.vars = vars;

  const resolvedOutput = path.resolve(outputPath);
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(wranglerConfig, null, 2)}\n`, "utf8");
  process.stdout.write(`${resolvedOutput}\n`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
