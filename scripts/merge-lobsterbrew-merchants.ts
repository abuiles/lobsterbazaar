import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseCsv } from "../src/deploy-package";
import { normalizeCountryCode } from "../src/merchant";

const BULK_SIZE = 2;

interface SourceMerchantRow {
  [key: string]: string | undefined;
  shopify_store?: string;
  name?: string;
  company?: string;
  url?: string;
  normalized_url?: string;
  host?: string;
  country?: string;
  state?: string;
  city?: string;
  neighborhood?: string;
  locations?: string;
  has_physical_locations?: string;
  physical_locations_count?: string;
  notes?: string;
}

const SOURCE_NAME_KEYS = [
  "name",
  "company"
];

const SOURCE_DOMAIN_KEYS = [
  "shopify_store",
  "url",
  "normalized_url",
  "host"
];

interface ParsedMerchantRow {
  slug: string;
  display_name: string;
  store_url: string;
  store_domain: string;
  storefront_mcp_url: string;
  country_codes: string;
  locations_summary: string;
  notes: string;
  tags: string;
  claim_contact: string;
  claim_status: string;
  vertical_metadata: string;
}

interface Candidate {
  slug: string;
  name: string;
  storeDomain: string;
  storeUrl: string;
  countryCodes: string[];
  locationsSummary: string;
  notes: string;
  tags: string[];
  metadata: Record<string, unknown>;
  needsShopifyDescribe: boolean;
  needsCountry: boolean;
}

type CsvRow = Record<string, string>;

interface ShopJsonResponse {
  shop?: {
    name?: string;
    currency?: string;
    country?: string;
    domain?: string;
  };
}

interface MergeReport {
  generatedAt: string;
  sourcePath: string;
  targetPath: string;
  added: string[];
  skipped: Array<{ shopify_store: string; name: string; reason: string }>;
  review: Array<{ shopify_store: string; name: string; reason: string; slug?: string }>;
  defaultCountries: string[];
}

const COUNTRY_BY_NAME: Record<string, string> = {
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  "UNITED KINGDOM": "GB",
  "UK": "GB",
  "U.K.": "GB",
  "CANADA": "CA",
  "MEXICO": "MX",
  "COLOMBIA": "CO",
  "HONG KONG": "HK",
  "JAPAN": "JP",
  "AUSTRALIA": "AU",
  "NEW ZEALAND": "NZ",
  "JORDAN": "JO",
  "ITALY": "IT",
  "FRANCE": "FR",
  "GERMANY": "DE",
  "SPAIN": "ES",
  "PORTUGAL": "PT",
};

function parseArgs(): {
  sourcePath: string;
  targetPath: string;
  reportPath: string;
  configPath?: string;
} {
  const args = process.argv.slice(2);
  const get = (key: string): string | undefined => {
    const index = args.findIndex((entry) => entry === `--${key}`);
    return index === -1 ? undefined : args[index + 1];
  };

  return {
    sourcePath: get("source") || "deploys/private/lobsterbrew/new_merchants.csv",
    targetPath: get("target") || "deploys/private/lobsterbrew/merchants.csv",
    reportPath: get("report") || "deploys/private/lobsterbrew/merge-report.json",
    configPath: get("config")
  };
}

function trim(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDomain(raw: string | undefined): string {
  const normalized = trim(raw);
  if (!normalized) {
    return "";
  }

  let next = normalized.toLowerCase();
  if (next.startsWith("https://")) {
    next = next.slice(8);
  } else if (next.startsWith("http://")) {
    next = next.slice(7);
  }
  if (next.startsWith("www.")) {
    next = next.slice(4);
  }
  const nextSlashIndex = next.indexOf("/");
  if (nextSlashIndex > -1) {
    next = next.slice(0, nextSlashIndex);
  }
  return next.trim();
}

function toUrl(rawDomain: string): string {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    return "";
  }

  const raw = trim(rawDomain);
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/$/, "");
  }

  return `https://${domain}`;
}

function slugify(value: string): string {
  return trim(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function ensureUniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    return base;
  }

  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function normalizeCountry(input: string): string | null {
  const value = trim(input);
  if (!value) {
    return null;
  }

  const normalized = value.toUpperCase();
  if (/^[A-Z]{2,3}$/.test(normalized)) {
    try {
      return normalizeCountryCode(normalized);
    } catch {
      return null;
    }
  }

  if (COUNTRY_BY_NAME[normalized]) {
    return COUNTRY_BY_NAME[normalized];
  }

  const firstPart = normalized.split("/")[0]?.trim();
  if (firstPart && COUNTRY_BY_NAME[firstPart]) {
    return COUNTRY_BY_NAME[firstPart];
  }

  return null;
}

function pickFirst(row: CsvRow, keys: Array<keyof SourceMerchantRow>): string {
  for (const key of keys) {
    const value = trim((row as Record<string, string | undefined>)[key]);
    if (value) {
      return value;
    }
  }

  return "";
}

function inferHasPhysical(row: SourceMerchantRow): string {
  const hasPhysical = trim(row.has_physical_locations).toLowerCase();
  const count = Number.parseInt(inferCount(row), 10);

  if (hasPhysical === "yes" || hasPhysical === "no") {
    return hasPhysical;
  }

  if (!Number.isNaN(count) && count > 0) {
    return "yes";
  }

  return "";
}

function inferCount(row: SourceMerchantRow): string {
  const countFromPhysical = Number.parseInt(trim(row.physical_locations_count), 10);
  if (!Number.isNaN(countFromPhysical) && countFromPhysical >= 0) {
    return String(countFromPhysical);
  }

  const countFromLocations = Number.parseInt(trim(row.locations), 10);
  if (!Number.isNaN(countFromLocations) && countFromLocations >= 0) {
    return String(countFromLocations);
  }

  return trim(row.physical_locations_count);
}

function weakDescription(value: string): boolean {
  const text = trim(value).toLowerCase();
  if (!text) {
    return true;
  }

  if (text.length < 65) {
    return true;
  }

  const weakTokens = [
    "official site indicates",
    "source list",
    "rate-limited",
    "inferred as",
    "strong local roaster signals",
    "retained from",
    "travel guides"
  ];

  return weakTokens.some((token) => text.includes(token));
}

function inferLocations(row: SourceMerchantRow): string {
  const has = inferHasPhysical(row);
  const countRaw = inferCount(row);
  const count = Number.parseInt(countRaw, 10);

  if (has === "yes") {
    if (!Number.isNaN(count) && count > 0) {
      return `${count} cafes`;
    }

    return "physical cafes";
  }

  if (has === "no") {
    return "no physical cafes";
  }

  if (!Number.isNaN(count) && count > 0) {
    return `${count} cafes`;
  }

  return "unknown physical cafes";
}

function tagsFor(row: SourceMerchantRow, countryCode: string): string[] {
  const tags = new Set<string>(["coffee", countryCode.toLowerCase()]);
  if (trim(row.city)) {
    tags.add(`city-${slugify(trim(row.city))}`);
  }

  if (trim(row.neighborhood)) {
    tags.add(`neighborhood-${slugify(trim(row.neighborhood))}`);
  }

  if (trim(row.state)) {
    tags.add(`state-${slugify(trim(row.state))}`);
  }

  return [...tags];
}

function buildMetadata(row: SourceMerchantRow, countryCode: string): Record<string, unknown> {
  return {
    city: trim(row.city) || undefined,
    neighborhood: trim(row.neighborhood) || undefined,
    state: trim(row.state) || undefined,
    country: trim(row.country) || undefined,
    country_code: countryCode,
    source: "new_merchants.csv",
    source_country_raw: trim(row.country),
    has_physical_locations: trim(row.has_physical_locations),
    physical_locations_count: trim(row.physical_locations_count)
  };
}

function csvEscape(value: string): string {
  const needsQuotes = value.includes(",") || value.includes("\"") || value.includes("\n") || value.includes("\r");
  const safe = value.replace(/"/g, "\"\"");
  return needsQuotes ? `"${safe}"` : safe;
}

function toCsv(rows: ParsedMerchantRow[]): string {
  const header = "slug,display_name,store_url,store_domain,storefront_mcp_url,country_codes,locations_summary,notes,tags,claim_contact,claim_status,vertical_metadata";
  const body = rows.map((row) => [
    row.slug,
    row.display_name,
    row.store_url,
    row.store_domain,
    row.storefront_mcp_url,
    row.country_codes,
    row.locations_summary,
    row.notes,
    row.tags,
    row.claim_contact,
    row.claim_status,
    row.vertical_metadata
  ].map((value) => csvEscape(value)).join(","));

  return `${header}\n${body.join("\n")}\n`;
}

function buildMerchantRow(candidate: Candidate): ParsedMerchantRow {
  const shopDomain = trim(candidate.storeDomain);
  const storefrontMcpUrl = shopDomain.includes("myshopify.com") ? `https://${shopDomain}/api/mcp` : "";

  const metadata = {
    ...candidate.metadata,
    shopify_confirmed: storefrontMcpUrl.length > 0
  };

  return {
    slug: candidate.slug,
    display_name: candidate.name,
    store_url: candidate.storeUrl,
    store_domain: candidate.storeDomain,
    storefront_mcp_url: storefrontMcpUrl,
    country_codes: candidate.countryCodes.join("|"),
    locations_summary: candidate.locationsSummary,
    notes: candidate.notes,
    tags: candidate.tags.join("|"),
    claim_contact: "",
    claim_status: "unclaimed",
    vertical_metadata: JSON.stringify(metadata)
  };
}

function isSourceRow(row: CsvRow): boolean {
  const hasDomain = Boolean(trim(row.shopify_store) || trim(row.url) || trim(row.normalized_url) || trim(row.host));
  const hasName = Boolean(trim(row.name) || trim(row.company));
  return hasDomain && hasName;
}

async function fetchShopMetadata(domain: string): Promise<ShopJsonResponse["shop"] | null> {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    return null;
  }

  try {
    const response = await fetch(`https://${normalized}/shop.json`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as ShopJsonResponse;
    return data.shop ?? null;
  } catch {
    return null;
  }
}

function batch<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function main() {
  const { sourcePath, targetPath, reportPath, configPath } = parseArgs();

  const [sourceText, targetText] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(targetPath, "utf8")
  ]);

  const sourceRows = parseCsv(sourceText)
    .filter(isSourceRow)
    .map((row) => ({
      shopify_store: pickFirst(row, SOURCE_DOMAIN_KEYS),
      name: pickFirst(row, SOURCE_NAME_KEYS),
      country: row.country || "",
      state: row.state || "",
      city: row.city || "",
      neighborhood: row.neighborhood || "",
      locations: row.locations || "",
      has_physical_locations: row.has_physical_locations || "",
      physical_locations_count: row.physical_locations_count || "",
      notes: row.notes || ""
    }));
  const existingRows = parseCsv(targetText) as CsvRow[];

  const usedSlugs = new Set<string>();
  const usedHosts = new Set<string>();
  for (const row of existingRows) {
    if (trim(row.slug)) {
      usedSlugs.add(row.slug || "");
    }

    const domainFromUrl = row.store_domain || normalizeDomain(row.store_url || "");
    if (domainFromUrl) {
      usedHosts.add(domainFromUrl);
    }
  }

  const review: MergeReport["review"] = [];
  const skipped: MergeReport["skipped"] = [];
  const added: string[] = [];
  const candidates: Candidate[] = [];
  const needsShopify: Candidate[] = [];

  for (const row of sourceRows) {
    const storeDomain = normalizeDomain(row.shopify_store);
    if (!storeDomain) {
      skipped.push({ shopify_store: row.shopify_store, name: row.name, reason: "missing_shopify_store" });
      continue;
    }

    if (usedHosts.has(storeDomain)) {
      skipped.push({ shopify_store: row.shopify_store, name: row.name, reason: "already_exists_by_domain" });
      continue;
    }

    const rawSlug = slugify(row.name);
    if (!rawSlug) {
      review.push({ shopify_store: row.shopify_store, name: row.name, reason: "missing_name_slug", slug: undefined });
      continue;
    }

    const slug = ensureUniqueSlug(rawSlug, usedSlugs);
    usedSlugs.add(slug);
    usedHosts.add(storeDomain);

    const countryCode = normalizeCountry(row.country);
    const needsCountry = !countryCode;
    const countryCodes = countryCode ? [countryCode] : [];
    const effectiveCountryCode = countryCode || "US";
    const candidate: Candidate = {
      slug,
      name: trim(row.name),
      storeDomain,
      storeUrl: toUrl(storeDomain),
      countryCodes,
      locationsSummary: inferLocations(row),
      notes: trim(row.notes),
      tags: tagsFor(row, effectiveCountryCode),
      metadata: buildMetadata(row, effectiveCountryCode),
      needsShopifyDescribe: weakDescription(row.notes),
      needsCountry
    };

    candidates.push(candidate);
    if (!needsCountry) {
      added.push(slug);
    }

    if (candidate.needsShopifyDescribe || candidate.needsCountry) {
      needsShopify.push(candidate);
    }
  }

  for (const chunk of batch(needsShopify, BULK_SIZE)) {
    const lookups = await Promise.all(chunk.map(async (candidate) => ({
      candidate,
      shop: await fetchShopMetadata(candidate.storeDomain)
    })));

    for (const outcome of lookups) {
      const candidate = outcome.candidate;
      if (!outcome.shop) {
        review.push({
          shopify_store: candidate.storeDomain,
          name: candidate.name,
          reason: "shop_json_unavailable",
          slug: candidate.slug
        });
        candidate.needsCountry = false;
        continue;
      }

      const shop = outcome.shop;
      const shopDomain = normalizeDomain(shop.domain || "");
      if (shopDomain) {
        candidate.storeDomain = shopDomain;
        candidate.storeUrl = toUrl(shopDomain);
      }

      const shopCountry = shop.country ? normalizeCountry(shop.country) : null;
      if (shopCountry) {
        candidate.countryCodes = [shopCountry];
        candidate.metadata.country = shop.country;
        candidate.metadata.country_code = shopCountry;

        if (candidate.needsCountry) {
          candidate.needsCountry = false;
          added.push(candidate.slug);
          candidate.metadata.shopify_confirmed = true;
        }
      } else if (candidate.needsCountry) {
        review.push({
          shopify_store: candidate.storeDomain,
          name: candidate.name,
          reason: "unmapped_country",
          slug: candidate.slug
        });
        candidate.countryCodes = [];
      }

      candidate.metadata.shop_name = shop.name;
      if (shop.currency) {
        candidate.metadata.shop_currency = shop.currency;
      }

      if (!candidate.notes || weakDescription(candidate.notes)) {
        const source = candidate.name;
        candidate.notes = `Shopify storefront available for ${source}. ${trim(candidate.notes) || "Confirmed via /shop.json."}`;
      }

      candidate.metadata.shopify_confirmed = true;
    }
  }

  const finalCandidates = candidates.filter((candidate) => {
    if (candidate.countryCodes.length > 0) {
      return true;
    }

    if (candidate.needsCountry) {
      review.push({
        shopify_store: candidate.storeDomain,
        name: candidate.name,
        reason: "unmapped_country",
        slug: candidate.slug
      });
    }

    return false;
  });

  const existingByColumn = existingRows
    .filter((row) => Boolean(trim(row.slug)))
    .sort((left, right) => {
      const leftSlug = left.slug || "";
      const rightSlug = right.slug || "";
      return leftSlug.localeCompare(rightSlug);
    });
  const mergedCandidates = finalCandidates.map((candidate) => buildMerchantRow(candidate));
  const uniqueAdded = [...new Set(added)];
  const finalRows = [...existingByColumn, ...mergedCandidates].sort((left, right) => left.slug.localeCompare(right.slug));

  const defaultCountries = new Set<string>();
  for (const row of finalRows) {
    for (const countryCode of row.country_codes.split("|").map(trim).filter(Boolean)) {
      defaultCountries.add(countryCode);
    }
  }

  const report: MergeReport = {
    generatedAt: new Date().toISOString(),
    sourcePath,
    targetPath,
    added: uniqueAdded,
    skipped,
    review,
    defaultCountries: [...defaultCountries].sort()
  };

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, toCsv(finalRows as ParsedMerchantRow[]), "utf8");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (configPath) {
    const configText = await readFile(configPath, "utf8");
    const config = JSON.parse(configText) as { default_countries?: string[] };
    config.default_countries = [...defaultCountries].sort();
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  console.log(`added=${uniqueAdded.length}`);
  console.log(`review=${review.length}`);
  console.log(`default_countries=${[...defaultCountries].sort().join(",")}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
