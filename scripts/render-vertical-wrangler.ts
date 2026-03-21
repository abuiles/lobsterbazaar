import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface DeployConfigFile {
  deploy_id: string;
  deploy_domain: string;
  vertical_id: string;
  brand_name: string;
  vertical_name?: string;
  directory_subtitle?: string;
  vertical_summary: string;
  skill_buying_targets?: string;
  emoji?: string;
  deploy_mascot_url?: string;
  root_surface?: unknown;
}

interface DirectoryDeployEntry {
  deployId: string;
  brandName: string;
  domain: string;
  verticalName?: string;
  directorySubtitle?: string;
  emoji?: string;
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

async function loadDirectoryDeploys(resolvedDeployDir: string): Promise<DirectoryDeployEntry[]> {
  const deploysRoot = path.dirname(resolvedDeployDir);
  const entries = await readdir(deploysRoot, { withFileTypes: true });
  const directoryDeploys: DirectoryDeployEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const deployConfigPath = path.join(deploysRoot, entry.name, "deploy.config.json");
    let deployConfigText = "";
    try {
      deployConfigText = await readFile(deployConfigPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }

    const deployConfig = parseJsonObject(deployConfigText, deployConfigPath) as unknown as DeployConfigFile;
    const domain = typeof deployConfig.deploy_domain === "string"
      ? normalizeDirectoryDomain(deployConfig.deploy_domain)
      : "";
    const deployId = typeof deployConfig.deploy_id === "string" ? deployConfig.deploy_id.trim() : "";
    const brandName = typeof deployConfig.brand_name === "string" ? deployConfig.brand_name.trim() : "";

    if (!deployId || !brandName || !domain) {
      continue;
    }

    directoryDeploys.push({
      deployId,
      brandName,
      domain,
      verticalName:
        typeof deployConfig.vertical_name === "string" && deployConfig.vertical_name.trim()
          ? deployConfig.vertical_name.trim()
          : undefined,
      directorySubtitle:
        typeof deployConfig.directory_subtitle === "string" && deployConfig.directory_subtitle.trim()
          ? deployConfig.directory_subtitle.trim()
          : undefined,
      emoji: typeof deployConfig.emoji === "string" && deployConfig.emoji.trim() ? deployConfig.emoji.trim() : undefined
    });
  }

  return directoryDeploys.sort((left, right) => left.brandName.localeCompare(right.brandName));
}

async function main() {
  const deployDir = process.argv[2];
  const outputPath = process.argv[3];

  if (!deployDir || !outputPath) {
    throw new Error("Usage: node scripts/render-vertical-wrangler.ts <deploy-dir> <output-path>");
  }

  const resolvedDeployDir = path.resolve(deployDir);
  const [wranglerText, deployConfigText] = await Promise.all([
    readFile(path.join(resolvedDeployDir, "wrangler.jsonc"), "utf8"),
    readFile(path.join(resolvedDeployDir, "deploy.config.json"), "utf8")
  ]);

  const wranglerConfig = expandEnvPlaceholders(parseJsonObject(wranglerText, "wrangler.jsonc")) as JsonObject;
  const deployConfig = parseJsonObject(deployConfigText, "deploy.config.json") as unknown as DeployConfigFile;
  const directoryDeploys = await loadDirectoryDeploys(resolvedDeployDir);

  const vars: JsonObject = {
    ...(typeof wranglerConfig.vars === "object" && wranglerConfig.vars !== null && !Array.isArray(wranglerConfig.vars)
      ? (wranglerConfig.vars as JsonObject)
      : {}),
    DEPLOY_ID: assertString(deployConfig.deploy_id, "deploy_id"),
    VERTICAL_ID: assertString(deployConfig.vertical_id, "vertical_id"),
    BRAND_NAME: assertString(deployConfig.brand_name, "brand_name"),
    DEPLOY_DOMAIN: assertString(deployConfig.deploy_domain, "deploy_domain"),
    VERTICAL_SUMMARY: assertString(deployConfig.vertical_summary, "vertical_summary"),
    DEPLOY_EMOJI:
      typeof deployConfig.emoji === "string" && deployConfig.emoji.trim() ? deployConfig.emoji.trim() : "🦞"
  };
  vars.DIRECTORY_VERTICALS_JSON = JSON.stringify(directoryDeploys);

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

  if (typeof deployConfig.root_surface !== "undefined") {
    vars.ROOT_SURFACE_JSON = JSON.stringify(deployConfig.root_surface);
  } else {
    delete vars.ROOT_SURFACE_JSON;
  }

  wranglerConfig.$schema = resolveRelativeConfigPath(resolvedDeployDir, wranglerConfig.$schema);
  wranglerConfig.main = resolveRelativeConfigPath(resolvedDeployDir, wranglerConfig.main);
  if (typeof wranglerConfig.assets === "object" && wranglerConfig.assets !== null && !Array.isArray(wranglerConfig.assets)) {
    const assets = wranglerConfig.assets as JsonObject;
    assets.directory = resolveRelativeConfigPath(resolvedDeployDir, assets.directory);
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
