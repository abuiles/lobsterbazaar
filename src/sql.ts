import type { Category, DeployPackage, Merchant, Offer } from "./domain";

interface BuildDeploySqlOptions {
  wrapInTransaction?: boolean;
}

function escapeSql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlNullable(value: string | undefined): string {
  return value ? escapeSql(value) : "NULL";
}

function sqlJson(value: unknown): string {
  return escapeSql(JSON.stringify(value));
}

const DELETE_MISSING_CHUNK_SIZE = 250;
const DELETE_MISSING_INLINE_LIMIT = 200;

function buildScratchTableName(table: string, column: string): string {
  return `_expected_${table}_${column}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

function deleteMissingSql(table: string, column: string, values: string[]): string[] {
  if (values.length === 0) {
    return [`DELETE FROM ${table};`];
  }

  if (values.length <= DELETE_MISSING_INLINE_LIMIT) {
    return [`DELETE FROM ${table} WHERE ${column} NOT IN (${values.map(escapeSql).join(", ")});`];
  }

  const tempTable = buildScratchTableName(table, column);
  const inserts = [];
  for (let index = 0; index < values.length; index += DELETE_MISSING_CHUNK_SIZE) {
    const chunk = values.slice(index, index + DELETE_MISSING_CHUNK_SIZE);
    inserts.push(`INSERT INTO ${tempTable} (value) VALUES ${chunk.map((value) => `(${escapeSql(value)})`).join(", ")};`);
  }

  return [
    `DROP TABLE IF EXISTS ${tempTable};`,
    `CREATE TABLE ${tempTable} (value TEXT PRIMARY KEY);`,
    `DELETE FROM ${tempTable};`,
    ...inserts,
    `DELETE FROM ${table} WHERE ${column} NOT IN (SELECT value FROM ${tempTable});`,
    `DROP TABLE ${tempTable};`
  ];
}

function categorySql(category: Category): string {
  return `INSERT INTO categories (slug, name, summary, subtitle, mascot_url, skill_buying_targets, created_at, updated_at)
VALUES (${escapeSql(category.slug)}, ${escapeSql(category.name)}, ${escapeSql(category.summary)}, ${sqlNullable(category.subtitle)}, ${sqlNullable(category.mascotUrl)}, ${sqlNullable(category.skillBuyingTargets)}, ${escapeSql(category.createdAt)}, ${escapeSql(category.updatedAt)})
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  summary = excluded.summary,
  subtitle = excluded.subtitle,
  mascot_url = excluded.mascot_url,
  skill_buying_targets = excluded.skill_buying_targets,
  updated_at = excluded.updated_at;`;
}

function merchantSql(merchant: Merchant): string[] {
  return [
    `INSERT INTO merchants (slug, display_name, store_url, store_domain, storefront_mcp_url, locations_summary, notes, tags_json, claim_contact, claim_status, vertical_metadata_json, created_at, updated_at)
VALUES (${escapeSql(merchant.slug)}, ${escapeSql(merchant.displayName)}, ${escapeSql(merchant.storeUrl)}, ${sqlNullable(merchant.storeDomain)}, ${sqlNullable(merchant.storefrontMcpUrl)}, ${sqlNullable(merchant.locationsSummary)}, ${escapeSql(merchant.notes)}, ${sqlJson(merchant.tags)}, ${sqlNullable(merchant.claimContact)}, ${escapeSql(merchant.claimStatus)}, ${sqlJson(merchant.verticalMetadata)}, ${escapeSql(merchant.createdAt)}, ${escapeSql(merchant.updatedAt)})
ON CONFLICT(slug) DO UPDATE SET
  display_name = excluded.display_name,
  store_url = excluded.store_url,
  store_domain = excluded.store_domain,
  storefront_mcp_url = excluded.storefront_mcp_url,
  locations_summary = excluded.locations_summary,
  notes = excluded.notes,
  tags_json = excluded.tags_json,
  claim_contact = excluded.claim_contact,
  claim_status = excluded.claim_status,
  vertical_metadata_json = excluded.vertical_metadata_json,
  updated_at = excluded.updated_at;`,
    `DELETE FROM merchant_categories WHERE merchant_slug = ${escapeSql(merchant.slug)};`,
    ...merchant.categorySlugs.map(
      (categorySlug) =>
        `INSERT INTO merchant_categories (merchant_slug, category_slug) VALUES (${escapeSql(merchant.slug)}, ${escapeSql(categorySlug)});`
    ),
    `DELETE FROM merchant_countries WHERE merchant_slug = ${escapeSql(merchant.slug)};`,
    ...merchant.countryCodes.map(
      (countryCode) =>
        `INSERT INTO merchant_countries (merchant_slug, country_code) VALUES (${escapeSql(merchant.slug)}, ${escapeSql(countryCode)});`
    )
  ];
}

function offerSql(offer: Offer): string[] {
  return [
    `INSERT INTO offers (offer_id, merchant_slug, title, summary, active_from, valid_through, offer_type, terms_text, priority, public_proof_url, offer_code, status, vertical_metadata_json, created_at, updated_at)
VALUES (${escapeSql(offer.offerId)}, ${escapeSql(offer.merchantSlug)}, ${escapeSql(offer.title)}, ${escapeSql(offer.summary)}, ${sqlNullable(offer.activeFrom)}, ${escapeSql(offer.validThrough)}, ${escapeSql(offer.offerType)}, ${escapeSql(offer.termsText)}, ${offer.priority}, ${sqlNullable(offer.publicProofUrl)}, ${sqlNullable(offer.offerCode)}, ${escapeSql(offer.status)}, ${sqlJson(offer.verticalMetadata)}, ${escapeSql(offer.createdAt)}, ${escapeSql(offer.updatedAt)})
ON CONFLICT(offer_id) DO UPDATE SET
  merchant_slug = excluded.merchant_slug,
  title = excluded.title,
  summary = excluded.summary,
  active_from = excluded.active_from,
  valid_through = excluded.valid_through,
  offer_type = excluded.offer_type,
  terms_text = excluded.terms_text,
  priority = excluded.priority,
  public_proof_url = excluded.public_proof_url,
  offer_code = excluded.offer_code,
  status = excluded.status,
  vertical_metadata_json = excluded.vertical_metadata_json,
  updated_at = excluded.updated_at;`,
    `DELETE FROM offer_countries WHERE offer_id = ${escapeSql(offer.offerId)};`,
    ...offer.countryCodes.map(
      (countryCode) =>
        `INSERT INTO offer_countries (offer_id, country_code) VALUES (${escapeSql(offer.offerId)}, ${escapeSql(countryCode)});`
    )
  ];
}

export function buildDeploySql(
  deployPackage: DeployPackage,
  options: BuildDeploySqlOptions = {}
): string {
  const statements = [
    "-- Generated by lobsterbazaar build-deploy-sql",
    ...deleteMissingSql("categories", "slug", deployPackage.categories.map((category) => category.slug)),
    ...deleteMissingSql("offers", "offer_id", deployPackage.offers.map((offer) => offer.offerId)),
    ...deleteMissingSql("merchant_claims", "claim_id", deployPackage.claims.map((claim) => claim.claimId)),
    ...deleteMissingSql("merchants", "slug", deployPackage.merchants.map((merchant) => merchant.slug)),
    ...deployPackage.categories.map(categorySql),
    ...deployPackage.merchants.flatMap(merchantSql),
    ...deployPackage.claims.map(
      (claim) =>
        `INSERT INTO merchant_claims (claim_id, merchant_slug, status, contact, note, created_at, updated_at)
VALUES (${escapeSql(claim.claimId)}, ${escapeSql(claim.merchantSlug)}, ${escapeSql(claim.status)}, ${sqlNullable(claim.contact)}, ${sqlNullable(claim.note)}, ${escapeSql(claim.createdAt)}, ${escapeSql(claim.updatedAt)})
ON CONFLICT(claim_id) DO UPDATE SET
  merchant_slug = excluded.merchant_slug,
  status = excluded.status,
  contact = excluded.contact,
  note = excluded.note,
  updated_at = excluded.updated_at;`
    ),
    ...deployPackage.offers.flatMap(offerSql)
  ];

  if (options.wrapInTransaction) {
    statements.splice(1, 0, "BEGIN TRANSACTION;");
    statements.push("COMMIT;");
  }

  return `${statements.join("\n\n")}\n`;
}
