import type {
  DeployConfig,
  DirectoryVertical,
  RootSurfaceConfig,
  RootSurfaceLink,
  RootSurfaceNetworkEntry,
  RootSurfaceSectionKind
} from "./domain";

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
  ROOT_SURFACE_JSON?: string;
  OPERATOR_TOKEN?: string;
}

const ROOT_SURFACE_SECTION_KINDS = new Set<RootSurfaceSectionKind>([
  "hero",
  "categories",
  "featured",
  "network",
  "merchant_onboarding"
]);

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseLink(value: unknown): RootSurfaceLink | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const label = parseString(record.label);
  const href = parseString(record.href);
  if (!label || !href) {
    return undefined;
  }

  return { label, href };
}

function parseSectionKindList(value: unknown): RootSurfaceSectionKind[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is RootSurfaceSectionKind => ROOT_SURFACE_SECTION_KINDS.has(entry as RootSurfaceSectionKind));

  return entries.length > 0 ? entries : undefined;
}

function parseSectionCopy(value: unknown): RootSurfaceConfig["categories"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const title = parseString(record.title);
  const body = parseString(record.body) ?? parseString(record.description);

  if (!title && !body) {
    return undefined;
  }

  return { title, body };
}

function parseMerchantOnboarding(value: unknown): RootSurfaceConfig["merchantOnboarding"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const title = parseString(record.title);
  const body = parseString(record.body) ?? parseString(record.description);
  const ctaHref = parseString(record.ctaHref) ?? parseString(record.appUrl);
  const ctaLabel = parseString(record.ctaLabel) ?? parseString(record.appLabel);
  const note = parseString(record.note);
  const bullets = Array.isArray(record.bullets)
    ? record.bullets.map((entry) => parseString(entry)).filter((entry): entry is string => Boolean(entry))
    : undefined;
  const supportLinks = Array.isArray(record.supportLinks)
    ? record.supportLinks.map((entry) => parseLink(entry)).filter((entry): entry is RootSurfaceLink => Boolean(entry))
    : undefined;
  const footerLines = Array.isArray(record.footerLines)
    ? record.footerLines.map((entry) => parseString(entry)).filter((entry): entry is string => Boolean(entry))
    : undefined;

  if (
    !title
    && !body
    && !ctaHref
    && !ctaLabel
    && !note
    && (!bullets || bullets.length === 0)
    && (!supportLinks || supportLinks.length === 0)
    && (!footerLines || footerLines.length === 0)
  ) {
    return undefined;
  }

  return {
    title,
    body,
    ctaHref,
    ctaLabel,
    note,
    bullets: bullets && bullets.length > 0 ? bullets : undefined,
    supportLinks: supportLinks && supportLinks.length > 0 ? supportLinks : undefined,
    footerLines: footerLines && footerLines.length > 0 ? footerLines : undefined
  };
}

function parseNetworkEntries(value: unknown): RootSurfaceNetworkEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const brandName = parseString(record.brandName);
      const href = parseString(record.href);
      if (!brandName || !href) {
        return null;
      }

      return {
        brandName,
        href,
        subtitle: parseString(record.subtitle),
        emoji: parseString(record.emoji)
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return entries.length > 0 ? entries : undefined;
}

function parseCategoryCards(value: unknown): RootSurfaceConfig["categoryCards"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const cards = Object.entries(value as Record<string, unknown>).flatMap(([slug, card]) => {
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      return [];
    }

    const record = card as Record<string, unknown>;
    return [[slug, {
      name: parseString(record.name),
      summary: parseString(record.summary),
      subtitle: parseString(record.subtitle),
      mascotUrl: parseString(record.mascotUrl),
      badge: parseString(record.badge),
      actionLabel: parseString(record.actionLabel),
      eyebrow: parseString(record.eyebrow),
      href: parseString(record.href)
    }] as const];
  });

  return cards.length > 0 ? Object.fromEntries(cards) : undefined;
}

export function parseRootSurfaceConfig(value: unknown): RootSurfaceConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const heroValue = record.hero;
  const hero =
    heroValue && typeof heroValue === "object" && !Array.isArray(heroValue)
      ? {
          eyebrow: parseString((heroValue as Record<string, unknown>).eyebrow),
          title: parseString((heroValue as Record<string, unknown>).title),
          body:
            parseString((heroValue as Record<string, unknown>).body)
            ?? parseString((heroValue as Record<string, unknown>).description),
          primaryCta: parseLink((heroValue as Record<string, unknown>).primaryCta),
          secondaryCta: parseLink((heroValue as Record<string, unknown>).secondaryCta),
          tertiaryCta: parseLink((heroValue as Record<string, unknown>).tertiaryCta)
        }
      : undefined;

  const featuredBase = parseSectionCopy(record.featured);
  const featuredMaxItems =
    record.featured && typeof record.featured === "object" && !Array.isArray(record.featured)
      && typeof (record.featured as Record<string, unknown>).maxItems === "number"
      ? Math.max(0, Math.trunc((record.featured as Record<string, unknown>).maxItems as number))
      : undefined;
  const featured =
    featuredBase || typeof featuredMaxItems !== "undefined"
      ? {
          ...featuredBase,
          maxItems: featuredMaxItems
        }
      : undefined;

  const networkBase = parseSectionCopy(record.network);
  const networkEntries =
    record.network && typeof record.network === "object" && !Array.isArray(record.network)
      ? parseNetworkEntries((record.network as Record<string, unknown>).entries)
      : undefined;
  const network =
    networkBase || networkEntries
      ? {
          ...networkBase,
          entries: networkEntries
        }
      : undefined;

  const rootSurface: RootSurfaceConfig = {
    hero,
    sectionOrder: parseSectionKindList(record.sectionOrder),
    categories: parseSectionCopy(record.categories),
    categoryOrder: Array.isArray(record.categoryOrder)
      ? record.categoryOrder.map((entry) => parseString(entry)).filter((entry): entry is string => Boolean(entry))
      : undefined,
    categoryCards: parseCategoryCards(record.categoryCards),
    featured,
    network,
    merchantOnboarding: parseMerchantOnboarding(record.merchantOnboarding)
  };

  if (
    !rootSurface.hero
    && !rootSurface.sectionOrder
    && !rootSurface.categories
    && !rootSurface.categoryOrder
    && !rootSurface.categoryCards
    && !rootSurface.featured
    && !rootSurface.network
    && !rootSurface.merchantOnboarding
  ) {
    return undefined;
  }

  return rootSurface;
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
    const directorySubtitle = typeof entry.directorySubtitle === "string" && entry.directorySubtitle.trim()
      ? entry.directorySubtitle.trim()
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
      directorySubtitle,
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
  const rootSurface = env.ROOT_SURFACE_JSON?.trim()
    ? (() => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(env.ROOT_SURFACE_JSON as string);
        } catch {
          throw new Error("ROOT_SURFACE_JSON must be valid JSON");
        }

        return parseRootSurfaceConfig(parsed);
      })()
    : undefined;

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
    directoryVerticals,
    rootSurface
  };
}
