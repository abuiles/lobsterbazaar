import type { DeployFileConfig, DeployPackage, Merchant, MerchantClaim, Offer } from "./domain";
import { badRequest, conflict } from "./errors";
import { normalizeCountryCode } from "./merchant";

type FileReader = (path: string) => Promise<string>;

const MERCHANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUPPORTED_CLAIM_MODE = "operator_managed";

const REQUIRED_CONFIG_FIELDS = [
  "deploy_id",
  "deploy_domain",
  "vertical_id",
  "vertical_name",
  "brand_name",
  "brand_description",
  "vertical_summary"
] as const;

function splitPipeList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "undefined") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  throw badRequest("Expected boolean config value");
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} is required`);
  }

  return value.trim();
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw badRequest("Deploy config must be valid JSON");
  }
}

function assertMerchantSlug(value: string, field: string): string {
  if (!MERCHANT_SLUG_PATTERN.test(value)) {
    throw badRequest(`${field} must be a lowercase URL-safe slug`);
  }

  return value;
}

function parseClaimMode(value: unknown): DeployFileConfig["claimMode"] {
  if (typeof value === "undefined") {
    return SUPPORTED_CLAIM_MODE;
  }

  if (value !== SUPPORTED_CLAIM_MODE) {
    throw badRequest(`claim_mode=${String(value)} is not supported in V0`);
  }

  return SUPPORTED_CLAIM_MODE;
}

function parseClaimStatus(value: string | undefined): Merchant["claimStatus"] {
  return value === "claimed" ? "claimed" : "unclaimed";
}

function parseOfferStatus(value: unknown): Offer["status"] {
  return value === "draft" || value === "expired" || value === "active" ? value : "draft";
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      throw badRequest(`Duplicate ${label}: ${value}`);
    }

    seen.add(value);
  }
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function parseDeployConfig(text: string): DeployFileConfig {
  const data = parseJsonObject(text);

  for (const field of REQUIRED_CONFIG_FIELDS) {
    assertString(data[field], field);
  }

  const publicDirectory = parseBoolean(data.public_directory, true);
  const offersEnabled = parseBoolean(data.offers_enabled, true);
  const claimMode = parseClaimMode(data.claim_mode);

  if (!publicDirectory) {
    throw badRequest("public_directory=false is not supported in V0");
  }

  if (!offersEnabled) {
    throw badRequest("offers_enabled=false is not supported in V0");
  }

  return {
    deployId: assertString(data.deploy_id, "deploy_id"),
    deployDomain: assertString(data.deploy_domain, "deploy_domain"),
    verticalId: assertString(data.vertical_id, "vertical_id"),
    verticalName: assertString(data.vertical_name, "vertical_name"),
    brandName: assertString(data.brand_name, "brand_name"),
    brandDescription: assertString(data.brand_description, "brand_description"),
    verticalSummary: assertString(data.vertical_summary, "vertical_summary"),
    defaultCountries: Array.isArray(data.default_countries)
      ? data.default_countries.map((value) => normalizeCountryCode(assertString(value, "default_countries")))
      : [],
    publicDirectory,
    offersEnabled,
    claimMode
  };
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\r") {
      continue;
    }

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  if (inQuotes) {
    throw badRequest("CSV contains an unterminated quoted field");
  }

  const [headers, ...entries] = rows.filter((entry) => entry.some((value) => value.trim() !== ""));
  if (!headers || headers.length === 0) {
    return [];
  }

  return entries.map((values, index) => {
    if (values.length !== headers.length) {
      throw badRequest(
        `CSV row ${index + 2} has ${values.length} columns; expected ${headers.length}`
      );
    }

    return Object.fromEntries(
      headers.map((header, headerIndex) => [header.trim(), values[headerIndex]?.trim() ?? ""])
    );
  });
}

export function parseMerchantManifest(text: string, importedAt = "2026-03-15T00:00:00Z"): Merchant[] {
  const merchants = parseCsv(text).map((row) => {
    const slug = assertMerchantSlug(assertString(row.slug, "slug"), "slug");
    const displayName = assertString(row.display_name, "display_name");
    const storeUrl = assertString(row.store_url, "store_url");
    const notes = assertString(row.notes, "notes");
    const countryCodes = splitPipeList(row.country_codes).map(normalizeCountryCode);

    if (countryCodes.length === 0) {
      throw badRequest(`country_codes is required for merchant ${slug}`);
    }

    return {
      slug,
      displayName,
      storeUrl,
      storeDomain: row.store_domain || undefined,
      storefrontMcpUrl: row.storefront_mcp_url || undefined,
      countryCodes,
      locationsSummary: row.locations_summary || undefined,
      notes,
      tags: splitPipeList(row.tags),
      claimContact: row.claim_contact || undefined,
      claimStatus: parseClaimStatus(row.claim_status),
      verticalMetadata: row.vertical_metadata ? parseJsonObject(row.vertical_metadata) : {},
      createdAt: importedAt,
      updatedAt: importedAt
    };
  });

  assertUnique(
    merchants.map((merchant) => merchant.slug),
    "merchant slug"
  );

  return merchants;
}

export function parseOffersFile(text: string, importedAt = "2026-03-15T00:00:00Z"): Offer[] {
  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    throw badRequest("Offers file must be valid JSON");
  }

  if (!Array.isArray(data)) {
    throw badRequest("Offers file must be a JSON array");
  }

  const offers = data.map((entry, index) => {
    const record = entry as Record<string, unknown>;
    const merchantSlug = assertMerchantSlug(
      assertString(record.merchant_slug, `offers[${index}].merchant_slug`),
      `offers[${index}].merchant_slug`
    );
    const title = assertString(record.title, `offers[${index}].title`);
    const summary = assertString(record.summary, `offers[${index}].summary`);
    const validThrough = assertString(record.valid_through, `offers[${index}].valid_through`);
    const offerType = assertString(record.offer_type, `offers[${index}].offer_type`);
    const termsText = assertString(record.terms_text, `offers[${index}].terms_text`);

    const countryCodes = Array.isArray(record.country_codes)
      ? record.country_codes.map((value) => normalizeCountryCode(assertString(value, `offers[${index}].country_codes`)))
      : [];

    if (countryCodes.length === 0) {
      throw badRequest(`offers[${index}].country_codes must include at least one country`);
    }

    return {
      offerId: assertString(record.offer_id, `offers[${index}].offer_id`),
      merchantSlug,
      title,
      summary,
      countryCodes,
      activeFrom: typeof record.active_from === "string" ? record.active_from : undefined,
      validThrough,
      offerType,
      termsText,
      priority: typeof record.priority === "number" ? record.priority : 0,
      publicProofUrl: typeof record.public_proof_url === "string" ? record.public_proof_url : undefined,
      offerCode: typeof record.offer_code === "string" ? record.offer_code : undefined,
      status: parseOfferStatus(record.status),
      verticalMetadata:
        record.vertical_metadata && typeof record.vertical_metadata === "object"
          ? (record.vertical_metadata as Record<string, unknown>)
          : {},
      createdAt: importedAt,
      updatedAt: importedAt
    };
  });

  assertUnique(
    offers.map((offer) => offer.offerId),
    "offer_id"
  );

  return offers;
}

export function buildImportedClaims(merchants: Merchant[]): MerchantClaim[] {
  return merchants
    .filter((merchant) => merchant.claimStatus === "claimed")
    .map((merchant) => ({
      claimId: `claim_import_${merchant.slug}`,
      merchantSlug: merchant.slug,
      status: "claimed",
      contact: merchant.claimContact,
      note: "Imported from deploy package",
      createdAt: merchant.createdAt,
      updatedAt: merchant.updatedAt
    }));
}

export async function loadDeployPackage(
  baseDir: string,
  readFile: FileReader,
  importedAt = "2026-03-15T00:00:00Z"
): Promise<DeployPackage> {
  const [configText, merchantsText] = await Promise.all([
    readFile(`${baseDir}/config.json`),
    readFile(`${baseDir}/merchants.csv`)
  ]);

  const config = parseDeployConfig(configText);
  const merchants = parseMerchantManifest(merchantsText, importedAt);
  const claims = buildImportedClaims(merchants);

  let offers: Offer[] = [];
  try {
    const offersText = await readFile(`${baseDir}/offers.json`);
    offers = parseOffersFile(offersText, importedAt);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }

  const claimedMerchants = new Set(merchants.filter((merchant) => merchant.claimStatus === "claimed").map((merchant) => merchant.slug));
  for (const offer of offers) {
    if (!claimedMerchants.has(offer.merchantSlug)) {
      throw conflict(`Offers can only be imported for claimed merchants: ${offer.merchantSlug}`);
    }
  }

  return {
    config,
    merchants,
    claims,
    offers
  };
}
