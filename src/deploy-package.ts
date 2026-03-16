import type { DeployFileConfig, DeployPackage, Merchant, MerchantClaim, Offer } from "./domain";
import { badRequest, conflict } from "./errors";
import { createId } from "./ids";
import { normalizeCountryCode } from "./merchant";

type FileReader = (path: string) => Promise<string>;

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
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
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

export function parseDeployConfig(text: string): DeployFileConfig {
  const data = parseJsonObject(text);

  for (const field of REQUIRED_CONFIG_FIELDS) {
    assertString(data[field], field);
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
    publicDirectory: parseBoolean(data.public_directory, true),
    offersEnabled: parseBoolean(data.offers_enabled, true),
    claimMode: "operator_managed"
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

  const [headers, ...entries] = rows.filter((entry) => entry.some((value) => value.trim() !== ""));
  if (!headers || headers.length === 0) {
    return [];
  }

  return entries.map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header.trim(), values[index]?.trim() ?? ""])
    )
  );
}

export function parseMerchantManifest(text: string, importedAt = "2026-03-15T00:00:00Z"): Merchant[] {
  return parseCsv(text).map((row) => {
    const slug = assertString(row.slug, "slug");
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
      claimStatus: row.claim_status === "claimed" ? "claimed" : "unclaimed",
      verticalMetadata: row.vertical_metadata ? parseJsonObject(row.vertical_metadata) : {},
      createdAt: importedAt,
      updatedAt: importedAt
    };
  });
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

  return data.map((entry, index) => {
    const record = entry as Record<string, unknown>;
    const merchantSlug = assertString(record.merchant_slug, `offers[${index}].merchant_slug`);
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
      offerId: typeof record.offer_id === "string" && record.offer_id.trim()
        ? record.offer_id.trim()
        : createId("offer"),
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
      status:
        record.status === "draft" || record.status === "expired" || record.status === "active"
          ? record.status
          : "draft",
      verticalMetadata:
        record.vertical_metadata && typeof record.vertical_metadata === "object"
          ? (record.vertical_metadata as Record<string, unknown>)
          : {},
      createdAt: importedAt,
      updatedAt: importedAt
    };
  });
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
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("ENOENT")) {
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
