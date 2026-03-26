import { hashSecret } from "./crypto";
import type {
  Category,
  Claw,
  CountryMerchantSummary,
  FeaturedMerchantSummary,
  MetricsSnapshot,
  Merchant,
  MerchantArtifact,
  MerchantClaim,
  Offer,
  PublicOffer,
  RegisterClawInput,
  RegisterClawResult
} from "./domain";
import { conflict, notFound } from "./errors";
import { createApiKey, createId } from "./ids";
import {
  buildPublicMerchantDescription,
  buildPublicMerchantSummary,
  compareCountryMerchants,
  deriveStorefrontMcpUrl,
  normalizeCountryCode
} from "./merchant";
import type {
  CreateCategoryInput,
  CreateClaimInput,
  CreateMerchantInput,
  CreateOfferInput,
  Repositories
} from "./storage";

interface CategoryRow {
  slug: string;
  name: string;
  summary: string;
  subtitle: string | null;
  mascot_url: string | null;
  skill_buying_targets: string | null;
  is_published: number | string;
  created_at: string;
  updated_at: string;
}

interface MerchantRow {
  slug: string;
  display_name: string;
  store_url: string;
  store_domain: string | null;
  storefront_mcp_url: string | null;
  locations_summary: string | null;
  notes: string;
  tags_json: string;
  claim_contact: string | null;
  claim_status: string;
  vertical_metadata_json: string;
  is_published: number | string;
  created_at: string;
  updated_at: string;
}

interface OfferRow {
  offer_id: string;
  merchant_slug: string;
  merchant_display_name?: string;
  title: string;
  summary: string;
  active_from: string | null;
  valid_through: string;
  offer_type: string;
  terms_text: string;
  priority: number;
  public_proof_url: string | null;
  offer_code: string | null;
  status: string;
  vertical_metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface ClaimRow {
  claim_id: string;
  merchant_slug: string;
  status: string;
  contact: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface ClawRow {
  claw_id: string;
  role: "buyer" | "merchant";
  display_name: string;
  description: string | null;
  merchant_slug: string | null;
  api_key_hash: string;
  created_at: string;
}

interface ClaimStatusRow {
  status: string;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseBoolean(value: number | string): boolean {
  return Number(value) === 1;
}

function mapMerchant(row: MerchantRow, countryCodes: string[], categorySlugs: string[]): Merchant {
  return {
    slug: row.slug,
    displayName: row.display_name,
    storeUrl: row.store_url,
    storeDomain: row.store_domain ?? undefined,
    storefrontMcpUrl: row.storefront_mcp_url ?? undefined,
    countryCodes,
    categorySlugs,
    locationsSummary: row.locations_summary ?? undefined,
    notes: row.notes,
    tags: parseJson<string[]>(row.tags_json),
    claimContact: row.claim_contact ?? undefined,
    claimStatus: row.claim_status as Merchant["claimStatus"],
    verticalMetadata: parseJson<Record<string, unknown>>(row.vertical_metadata_json),
    isPublished: parseBoolean(row.is_published),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCategory(row: CategoryRow): Category {
  return {
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    subtitle: row.subtitle ?? undefined,
    mascotUrl: row.mascot_url ?? undefined,
    skillBuyingTargets: row.skill_buying_targets ?? undefined,
    isPublished: parseBoolean(row.is_published),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapClaw(row: ClawRow): Claw {
  return {
    clawId: row.claw_id,
    role: row.role,
    displayName: row.display_name,
    description: row.description ?? undefined,
    merchantSlug: row.merchant_slug ?? undefined,
    apiKeyHash: row.api_key_hash,
    createdAt: row.created_at
  };
}

export class D1Repositories implements Repositories {
  constructor(private readonly db: D1Database) {}

  async getCategory(slug: string): Promise<Category | null> {
    const categoryRow = await this.db.prepare(`SELECT * FROM categories WHERE slug = ?1`).bind(slug).first<CategoryRow>();
    return categoryRow ? mapCategory(categoryRow) : null;
  }

  async createClaw(input: RegisterClawInput, deployId: string): Promise<RegisterClawResult> {
    if (input.role === "merchant") {
      if (!input.merchantSlug) {
        throw notFound("Merchant not found");
      }

      const merchant = await this.getMerchant(input.merchantSlug);
      if (!merchant) {
        throw notFound("Merchant not found");
      }

      if (merchant.claimStatus !== "claimed") {
        throw conflict("Merchant registration is not allowed");
      }

      if (!(await this.hasOperatorManagedAccess(merchant.slug))) {
        throw conflict("Merchant registration is not allowed");
      }
    }

    const apiKey = createApiKey(deployId);
    const claw = {
      clawId: createId("claw"),
      role: input.role,
      displayName: input.displayName,
      description: input.description,
      merchantSlug: input.merchantSlug,
      apiKeyHash: await hashSecret(apiKey),
      createdAt: new Date().toISOString()
    };

    await this.db
      .prepare(
        `INSERT INTO claws (claw_id, role, display_name, description, merchant_slug, api_key_hash, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      )
      .bind(
        claw.clawId,
        claw.role,
        claw.displayName,
        claw.description ?? null,
        claw.merchantSlug ?? null,
        claw.apiKeyHash,
        claw.createdAt
      )
      .run();

    return {
      claw,
      apiKey
    };
  }

  async getMerchant(slug: string): Promise<Merchant | null> {
    const merchantRow = await this.db.prepare(`SELECT * FROM merchants WHERE slug = ?1`).bind(slug).first<MerchantRow>();
    if (!merchantRow) {
      return null;
    }

    const [countries, categorySlugs] = await Promise.all([
      this.listCountryCodesForMerchant(slug),
      this.listCategorySlugsForMerchant(slug)
    ]);

    return mapMerchant(merchantRow, countries, categorySlugs);
  }

  async getOffer(offerId: string): Promise<Offer | null> {
    const offerRow = await this.db.prepare(`SELECT * FROM offers WHERE offer_id = ?1`).bind(offerId).first<OfferRow>();
    if (!offerRow) {
      return null;
    }

    return {
      offerId: offerRow.offer_id,
      merchantSlug: offerRow.merchant_slug,
      title: offerRow.title,
      summary: offerRow.summary,
      countryCodes: await this.listCountryCodesForOffer(offerId),
      activeFrom: offerRow.active_from ?? undefined,
      validThrough: offerRow.valid_through,
      offerType: offerRow.offer_type,
      termsText: offerRow.terms_text,
      priority: offerRow.priority,
      publicProofUrl: offerRow.public_proof_url ?? undefined,
      offerCode: offerRow.offer_code ?? undefined,
      status: offerRow.status as Offer["status"],
      verticalMetadata: parseJson<Record<string, unknown>>(offerRow.vertical_metadata_json),
      createdAt: offerRow.created_at,
      updatedAt: offerRow.updated_at
    };
  }

  async listCategories(): Promise<Category[]> {
    const result = await this.db.prepare(`SELECT * FROM categories ORDER BY slug ASC`).all<CategoryRow>();
    return (result.results ?? []).map(mapCategory);
  }

  async listMerchants(): Promise<Merchant[]> {
    const result = await this.db.prepare(`SELECT * FROM merchants ORDER BY slug ASC`).all<MerchantRow>();
    const rows = result.results ?? [];

    return Promise.all(
      rows.map(async (row) => {
        const [countryCodes, categorySlugs] = await Promise.all([
          this.listCountryCodesForMerchant(row.slug),
          this.listCategorySlugsForMerchant(row.slug)
        ]);

        return mapMerchant(row, countryCodes, categorySlugs);
      })
    );
  }

  async listOffers(): Promise<Offer[]> {
    const result = await this.db.prepare(`SELECT * FROM offers ORDER BY offer_id ASC`).all<OfferRow>();
    const rows = result.results ?? [];

    return Promise.all(
      rows.map(async (row) => ({
        offerId: row.offer_id,
        merchantSlug: row.merchant_slug,
        title: row.title,
        summary: row.summary,
        countryCodes: await this.listCountryCodesForOffer(row.offer_id),
        activeFrom: row.active_from ?? undefined,
        validThrough: row.valid_through,
        offerType: row.offer_type,
        termsText: row.terms_text,
        priority: row.priority,
        publicProofUrl: row.public_proof_url ?? undefined,
        offerCode: row.offer_code ?? undefined,
        status: row.status as Offer["status"],
        verticalMetadata: parseJson<Record<string, unknown>>(row.vertical_metadata_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    );
  }

  async supportsCategory(slug: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT 1 AS supported FROM categories WHERE slug = ?1 AND is_published = 1 LIMIT 1`)
      .bind(slug.trim())
      .first<{ supported: number }>();

    return row !== null;
  }

  async supportsCountryForCategory(categorySlug: string, countryCode: string): Promise<boolean> {
    const normalizedCategory = categorySlug.trim();
    const normalizedCountry = normalizeCountryCode(countryCode);
    const row = await this.db
      .prepare(
        `SELECT 1 AS supported
         FROM merchant_categories mc
         JOIN merchant_countries mco ON mco.merchant_slug = mc.merchant_slug
         JOIN merchants m ON m.slug = mc.merchant_slug
         JOIN categories c ON c.slug = mc.category_slug
         WHERE mc.category_slug = ?1
           AND mco.country_code = ?2
           AND m.is_published = 1
           AND c.is_published = 1
         LIMIT 1`
      )
      .bind(normalizedCategory, normalizedCountry)
      .first<{ supported: number }>();

    return row !== null;
  }

  async listCountryMerchants(countryCode: string, now: string): Promise<CountryMerchantSummary[]> {
    const normalized = normalizeCountryCode(countryCode);
    const result = await this.db
      .prepare(
        `SELECT
           m.slug,
           m.display_name,
           m.store_url,
           m.locations_summary,
           m.notes,
           m.vertical_metadata_json,
           COUNT(o.offer_id) AS active_offers_count
         FROM merchants m
         JOIN merchant_countries mc
           ON mc.merchant_slug = m.slug
         LEFT JOIN offer_countries oc
           ON oc.country_code = mc.country_code
         LEFT JOIN offers o
           ON o.offer_id = oc.offer_id
          AND o.merchant_slug = m.slug
          AND o.status = 'active'
          AND (o.active_from IS NULL OR o.active_from <= ?2)
          AND o.valid_through >= ?2
         WHERE mc.country_code = ?1
           AND m.is_published = 1
         GROUP BY m.slug, m.display_name, m.store_url, m.locations_summary, m.notes, m.vertical_metadata_json`
      )
      .bind(normalized, now)
      .all<{
        slug: string;
        display_name: string;
        store_url: string;
        locations_summary: string | null;
        notes: string;
        vertical_metadata_json: string;
        active_offers_count: number | string;
      }>();

    return (result.results ?? [])
      .map((row) => {
        const verticalMetadata = JSON.parse(row.vertical_metadata_json || "{}") as Record<string, unknown>;

        return {
          slug: row.slug,
          displayName: row.display_name,
          storeUrl: row.store_url,
          summary: buildPublicMerchantSummary({
            locationsSummary: row.locations_summary ?? undefined,
            verticalMetadata
          }),
          description: buildPublicMerchantDescription({
            notes: row.notes,
            verticalMetadata
          }),
          activeOffersCount: Number(row.active_offers_count ?? 0)
        };
      })
      .sort(compareCountryMerchants);
  }

  async listCountryMerchantsForCategory(
    categorySlug: string,
    countryCode: string,
    now: string
  ): Promise<CountryMerchantSummary[]> {
    const normalizedCategory = categorySlug.trim();
    const normalizedCountry = normalizeCountryCode(countryCode);
    const result = await this.db
      .prepare(
        `SELECT
           m.slug,
           m.display_name,
           m.store_url,
           m.locations_summary,
           m.notes,
           m.vertical_metadata_json,
           COUNT(o.offer_id) AS active_offers_count
         FROM merchants m
         JOIN merchant_countries mco
           ON mco.merchant_slug = m.slug
         JOIN merchant_categories mca
           ON mca.merchant_slug = m.slug
         LEFT JOIN offer_countries oc
           ON oc.country_code = mco.country_code
         LEFT JOIN offers o
           ON o.offer_id = oc.offer_id
          AND o.merchant_slug = m.slug
          AND o.status = 'active'
          AND (o.active_from IS NULL OR o.active_from <= ?3)
          AND o.valid_through >= ?3
         WHERE mco.country_code = ?1
           AND mca.category_slug = ?2
           AND m.is_published = 1
         GROUP BY m.slug, m.display_name, m.store_url, m.locations_summary, m.notes, m.vertical_metadata_json`
      )
      .bind(normalizedCountry, normalizedCategory, now)
      .all<{
        slug: string;
        display_name: string;
        store_url: string;
        locations_summary: string | null;
        notes: string;
        vertical_metadata_json: string;
        active_offers_count: number | string;
      }>();

    return (result.results ?? [])
      .map((row) => {
        const verticalMetadata = JSON.parse(row.vertical_metadata_json || "{}") as Record<string, unknown>;

        return {
          slug: row.slug,
          displayName: row.display_name,
          storeUrl: row.store_url,
          summary: buildPublicMerchantSummary({
            locationsSummary: row.locations_summary ?? undefined,
            verticalMetadata
          }),
          description: buildPublicMerchantDescription({
            notes: row.notes,
            verticalMetadata
          }),
          activeOffersCount: Number(row.active_offers_count ?? 0)
        };
      })
      .sort(compareCountryMerchants);
  }

  async listFeaturedMerchants(now: string): Promise<FeaturedMerchantSummary[]> {
    const result = await this.db
      .prepare(
        `SELECT
           m.slug,
           m.display_name,
           m.store_url,
           m.locations_summary,
           m.notes,
           m.vertical_metadata_json,
           COUNT(o.offer_id) AS active_offers_count
         FROM merchants m
         LEFT JOIN offers o
           ON o.merchant_slug = m.slug
          AND o.status = 'active'
          AND (o.active_from IS NULL OR o.active_from <= ?1)
          AND o.valid_through >= ?1
         WHERE COALESCE(json_extract(m.vertical_metadata_json, '$.featured'), 0) = 1
           AND m.is_published = 1
         GROUP BY m.slug, m.display_name, m.store_url, m.locations_summary, m.notes, m.vertical_metadata_json`
      )
      .bind(now)
      .all<{
        slug: string;
        display_name: string;
        store_url: string;
        locations_summary: string | null;
        notes: string;
        vertical_metadata_json: string;
        active_offers_count: number | string;
      }>();

    return (result.results ?? [])
      .map((row) => {
        const verticalMetadata = JSON.parse(row.vertical_metadata_json || "{}") as Record<string, unknown>;

        return {
          slug: row.slug,
          displayName: row.display_name,
          storeUrl: row.store_url,
          summary: buildPublicMerchantSummary({
            locationsSummary: row.locations_summary ?? undefined,
            verticalMetadata
          }),
          description: buildPublicMerchantDescription({
            notes: row.notes,
            verticalMetadata
          }),
          activeOffersCount: Number(row.active_offers_count ?? 0)
        };
      })
      .sort(compareCountryMerchants);
  }

  async supportsCountry(countryCode: string): Promise<boolean> {
    const normalized = normalizeCountryCode(countryCode);
    const row = await this.db
      .prepare(
        `SELECT 1 AS supported
         FROM merchant_countries mc
         JOIN merchants m ON m.slug = mc.merchant_slug
         WHERE mc.country_code = ?1
           AND m.is_published = 1
         LIMIT 1`
      )
      .bind(normalized)
      .first<{ supported: number }>();

    return row !== null;
  }

  async listActiveOffers(countryCode: string, now: string): Promise<PublicOffer[]> {
    const normalized = normalizeCountryCode(countryCode);
    const result = await this.db
      .prepare(
        `SELECT
           o.offer_id,
           o.merchant_slug,
           m.display_name AS merchant_display_name,
           o.title,
           o.summary,
           o.offer_type,
           o.valid_through,
           o.terms_text,
           o.priority
         FROM offers o
         JOIN offer_countries oc
           ON oc.offer_id = o.offer_id
         JOIN merchants m
           ON m.slug = o.merchant_slug
         WHERE oc.country_code = ?1
           AND o.status = 'active'
           AND m.is_published = 1
           AND (o.active_from IS NULL OR o.active_from <= ?2)
           AND o.valid_through >= ?2
         ORDER BY o.priority DESC, o.title ASC`
      )
      .bind(normalized, now)
      .all<{
        offer_id: string;
        merchant_slug: string;
        merchant_display_name: string;
        title: string;
        summary: string;
        offer_type: string;
        valid_through: string;
        terms_text: string;
      }>();

    return (result.results ?? []).map((row) => ({
      offerId: row.offer_id,
      merchantSlug: row.merchant_slug,
      merchantDisplayName: row.merchant_display_name,
      title: row.title,
      summary: row.summary,
      offerType: row.offer_type,
      validThrough: row.valid_through,
      termsText: row.terms_text
    }));
  }

  async listActiveOffersForCategory(categorySlug: string, countryCode: string, now: string): Promise<PublicOffer[]> {
    const normalizedCategory = categorySlug.trim();
    const normalizedCountry = normalizeCountryCode(countryCode);
    const result = await this.db
      .prepare(
        `SELECT
           o.offer_id,
           o.merchant_slug,
           m.display_name AS merchant_display_name,
           o.title,
           o.summary,
           o.offer_type,
           o.valid_through,
           o.terms_text,
           o.priority
         FROM offers o
         JOIN offer_countries oc
           ON oc.offer_id = o.offer_id
         JOIN merchants m
           ON m.slug = o.merchant_slug
         JOIN merchant_categories mc
           ON mc.merchant_slug = o.merchant_slug
         JOIN categories c
           ON c.slug = mc.category_slug
         WHERE oc.country_code = ?1
           AND mc.category_slug = ?2
           AND o.status = 'active'
           AND m.is_published = 1
           AND c.is_published = 1
           AND (o.active_from IS NULL OR o.active_from <= ?3)
           AND o.valid_through >= ?3
         ORDER BY o.priority DESC, o.title ASC`
      )
      .bind(normalizedCountry, normalizedCategory, now)
      .all<{
        offer_id: string;
        merchant_slug: string;
        merchant_display_name: string;
        title: string;
        summary: string;
        offer_type: string;
        valid_through: string;
        terms_text: string;
      }>();

    return (result.results ?? []).map((row) => ({
      offerId: row.offer_id,
      merchantSlug: row.merchant_slug,
      merchantDisplayName: row.merchant_display_name,
      title: row.title,
      summary: row.summary,
      offerType: row.offer_type,
      validThrough: row.valid_through,
      termsText: row.terms_text
    }));
  }

  async listActiveOffersForMerchant(merchantSlug: string, now: string): Promise<PublicOffer[]> {
    const result = await this.db
      .prepare(
        `SELECT
           o.offer_id,
           o.merchant_slug,
           m.display_name AS merchant_display_name,
           o.title,
           o.summary,
           o.offer_type,
           o.valid_through,
           o.terms_text,
           o.priority
         FROM offers o
         JOIN merchants m
           ON m.slug = o.merchant_slug
         WHERE o.merchant_slug = ?1
           AND o.status = 'active'
           AND m.is_published = 1
           AND (o.active_from IS NULL OR o.active_from <= ?2)
           AND o.valid_through >= ?2
         ORDER BY o.priority DESC, o.title ASC`
      )
      .bind(merchantSlug, now)
      .all<{
        offer_id: string;
        merchant_slug: string;
        merchant_display_name: string;
        title: string;
        summary: string;
        offer_type: string;
        valid_through: string;
        terms_text: string;
      }>();

    return (result.results ?? []).map((row) => ({
      offerId: row.offer_id,
      merchantSlug: row.merchant_slug,
      merchantDisplayName: row.merchant_display_name,
      title: row.title,
      summary: row.summary,
      offerType: row.offer_type,
      validThrough: row.valid_through,
      termsText: row.terms_text
    }));
  }

  async listMerchantArtifacts(now: string, since?: string): Promise<MerchantArtifact[]> {
    const merchantsQuery = since
      ? `SELECT * FROM merchants WHERE created_at > ? AND is_published = 1 ORDER BY slug ASC`
      : `SELECT * FROM merchants WHERE is_published = 1 ORDER BY slug ASC`;

    const merchantsResult = since
      ? await this.db.prepare(merchantsQuery).bind(since).all<MerchantRow>()
      : await this.db.prepare(merchantsQuery).all<MerchantRow>();

    const merchants = merchantsResult.results ?? [];

    return Promise.all(
      merchants.map(async (row) => {
        const [countryCodes, categorySlugs, activeOffersCount] = await Promise.all([
          this.listCountryCodesForMerchant(row.slug),
          this.listCategorySlugsForMerchant(row.slug),
          this.countActiveOffersForMerchant(row.slug, now)
        ]);

        return {
          slug: row.slug,
          displayName: row.display_name,
          storeUrl: row.store_url,
          countryCodes,
          categorySlugs,
          notes: row.notes,
          storefrontMcpUrl: deriveStorefrontMcpUrl(mapMerchant(row, countryCodes, categorySlugs)),
          claimStatus: row.claim_status as Merchant["claimStatus"],
          activeOffersCount
        };
      })
    );
  }

  async listMerchantArtifactsForCategory(categorySlug: string, now: string, since?: string): Promise<MerchantArtifact[]> {
    const merchantsQuery = since
      ? `SELECT DISTINCT m.*
         FROM merchants m
         JOIN merchant_categories mcat ON mcat.merchant_slug = m.slug
         WHERE mcat.category_slug = ?1
           AND m.created_at > ?2
           AND m.is_published = 1
         ORDER BY m.slug ASC`
      : `SELECT DISTINCT m.*
         FROM merchants m
         JOIN merchant_categories mcat ON mcat.merchant_slug = m.slug
         WHERE mcat.category_slug = ?1
           AND m.is_published = 1
         ORDER BY m.slug ASC`;

    const merchantsResult = since
      ? await this.db.prepare(merchantsQuery).bind(categorySlug, since).all<MerchantRow>()
      : await this.db.prepare(merchantsQuery).bind(categorySlug).all<MerchantRow>();

    const merchants = merchantsResult.results ?? [];

    return Promise.all(
      merchants.map(async (row) => {
        const [countryCodes, categorySlugs, activeOffersCount] = await Promise.all([
          this.listCountryCodesForMerchant(row.slug),
          this.listCategorySlugsForMerchant(row.slug),
          this.countActiveOffersForMerchantByCategory(row.slug, categorySlug, now)
        ]);

        return {
          slug: row.slug,
          displayName: row.display_name,
          storeUrl: row.store_url,
          countryCodes,
          categorySlugs,
          notes: row.notes,
          storefrontMcpUrl: deriveStorefrontMcpUrl(mapMerchant(row, countryCodes, categorySlugs)),
          claimStatus: row.claim_status as Merchant["claimStatus"],
          activeOffersCount
        };
      })
    );
  }

  async listCountryCodes(): Promise<string[]> {
    const result = await this.db
      .prepare(
        `SELECT DISTINCT mc.country_code
         FROM merchant_countries mc
         JOIN merchants m ON m.slug = mc.merchant_slug
         WHERE m.is_published = 1
         ORDER BY mc.country_code ASC`
      )
      .all<{ country_code: string }>();

    return (result.results ?? []).map((row) => row.country_code);
  }

  async listCountryCodesForCategory(categorySlug: string): Promise<string[]> {
    const result = await this.db
      .prepare(
        `SELECT DISTINCT mc.country_code
         FROM merchant_countries mc
         JOIN merchant_categories mcat
           ON mcat.merchant_slug = mc.merchant_slug
         JOIN merchants m
           ON m.slug = mc.merchant_slug
         JOIN categories c
           ON c.slug = mcat.category_slug
         WHERE mcat.category_slug = ?1
           AND m.is_published = 1
           AND c.is_published = 1
         ORDER BY mc.country_code ASC`
      )
      .bind(categorySlug)
      .all<{ country_code: string }>();

    return (result.results ?? []).map((row) => row.country_code);
  }

  async listCategorySlugs(): Promise<string[]> {
    const result = await this.db.prepare(`SELECT slug FROM categories WHERE is_published = 1 ORDER BY slug ASC`).all<{ slug: string }>();
    return (result.results ?? []).map((row) => row.slug);
  }

  async listMerchantSlugs(since?: string): Promise<string[]> {
    const query = since
      ? `SELECT slug FROM merchants WHERE created_at > ? AND is_published = 1 ORDER BY slug ASC`
      : `SELECT slug FROM merchants WHERE is_published = 1 ORDER BY slug ASC`;

    const result = since
      ? await this.db.prepare(query).bind(since).all<{ slug: string }>()
      : await this.db.prepare(query).all<{ slug: string }>();

    return (result.results ?? []).map((row) => row.slug);
  }

  async listOfferIds(since?: string): Promise<string[]> {
    const query = since
      ? `SELECT offer_id FROM offers WHERE created_at > ? ORDER BY offer_id ASC`
      : `SELECT offer_id FROM offers ORDER BY offer_id ASC`;

    const result = since
      ? await this.db.prepare(query).bind(since).all<{ offer_id: string }>()
      : await this.db.prepare(query).all<{ offer_id: string }>();

    return (result.results ?? []).map((row) => row.offer_id);
  }

  async listOfferMerchantSlugsForAddedSince(since: string): Promise<string[]> {
    const result = await this.db
      .prepare(`SELECT DISTINCT merchant_slug FROM offers WHERE created_at > ? ORDER BY merchant_slug ASC`)
      .bind(since)
      .all<{ merchant_slug: string }>();

    return (result.results ?? []).map((row) => row.merchant_slug);
  }

  async listOfferCountryCodesForAddedSince(since: string): Promise<string[]> {
    const result = await this.db
      .prepare(
        `SELECT DISTINCT oc.country_code
         FROM offers o
         JOIN offer_countries oc ON oc.offer_id = o.offer_id
         WHERE o.created_at > ?
         ORDER BY oc.country_code ASC`
      )
      .bind(since)
      .all<{ country_code: string }>();

    return (result.results ?? []).map((row) => row.country_code);
  }

  async listClaimIds(): Promise<string[]> {
    const result = await this.db
      .prepare(`SELECT claim_id FROM merchant_claims ORDER BY claim_id ASC`)
      .all<{ claim_id: string }>();

    return (result.results ?? []).map((row) => row.claim_id);
  }

  async getMetricsSnapshot(now: string): Promise<MetricsSnapshot> {
    const [merchantCountRow, activeOfferCountRow, claimedMerchantCountRow, countryCountRow] = await Promise.all([
      this.db.prepare(`SELECT COUNT(*) AS total FROM merchants`).first<{ total: number | string }>(),
      this.db
        .prepare(
          `SELECT COUNT(*) AS total
           FROM offers
           WHERE status = 'active'
             AND (active_from IS NULL OR active_from <= ?1)
             AND valid_through >= ?1`
        )
        .bind(now)
        .first<{ total: number | string }>(),
      this.db.prepare(`SELECT COUNT(*) AS total FROM merchants WHERE claim_status = 'claimed'`).first<{ total: number | string }>(),
      this.db.prepare(`SELECT COUNT(DISTINCT country_code) AS total FROM merchant_countries`).first<{ total: number | string }>()
    ]);

    return {
      merchantCount: Number(merchantCountRow?.total ?? 0),
      activeOfferCount: Number(activeOfferCountRow?.total ?? 0),
      claimedMerchantCount: Number(claimedMerchantCountRow?.total ?? 0),
      countryCount: Number(countryCountRow?.total ?? 0)
    };
  }

  async putCategory(input: CreateCategoryInput): Promise<void> {
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;

    await this.db
      .prepare(
        `INSERT INTO categories
           (slug, name, summary, subtitle, mascot_url, skill_buying_targets, is_published, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(slug) DO UPDATE SET
           name = excluded.name,
           summary = excluded.summary,
           subtitle = excluded.subtitle,
           mascot_url = excluded.mascot_url,
           skill_buying_targets = excluded.skill_buying_targets,
           is_published = excluded.is_published,
           updated_at = excluded.updated_at`
      )
      .bind(
        input.slug,
        input.name,
        input.summary,
        input.subtitle ?? null,
        input.mascotUrl ?? null,
        input.skillBuyingTargets ?? null,
        input.isPublished === false ? 0 : 1,
        createdAt,
        updatedAt
      )
      .run();
  }

  async putMerchant(input: CreateMerchantInput): Promise<void> {
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;
    const categorySlugs = Array.from(new Set(input.categorySlugs.map((slug) => slug.trim()).filter(Boolean))).sort();

    if (categorySlugs.length === 0) {
      throw conflict("Merchants must belong to at least one category");
    }

    for (const categorySlug of categorySlugs) {
      if (!(await this.getCategory(categorySlug))) {
        throw notFound(`Category not found: ${categorySlug}`);
      }
    }

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO merchants
             (slug, display_name, store_url, store_domain, storefront_mcp_url, locations_summary, notes, tags_json, claim_contact, claim_status, vertical_metadata_json, is_published, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
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
             is_published = excluded.is_published,
             updated_at = excluded.updated_at`
        )
        .bind(
          input.slug,
          input.displayName,
          input.storeUrl,
          input.storeDomain ?? null,
          input.storefrontMcpUrl ?? null,
          input.locationsSummary ?? null,
          input.notes,
          JSON.stringify(input.tags),
          input.claimContact ?? null,
          input.claimStatus,
          JSON.stringify(input.verticalMetadata),
          input.isPublished === false ? 0 : 1,
          createdAt,
          updatedAt
        ),
      this.db.prepare(`DELETE FROM merchant_countries WHERE merchant_slug = ?1`).bind(input.slug),
      this.db.prepare(`DELETE FROM merchant_categories WHERE merchant_slug = ?1`).bind(input.slug),
      ...input.countryCodes.map((countryCode) =>
        this.db
          .prepare(`INSERT INTO merchant_countries (merchant_slug, country_code) VALUES (?1, ?2)`)
          .bind(input.slug, normalizeCountryCode(countryCode))
      ),
      ...categorySlugs.map((categorySlug) =>
        this.db
          .prepare(`INSERT INTO merchant_categories (merchant_slug, category_slug) VALUES (?1, ?2)`)
          .bind(input.slug, categorySlug)
      )
    ]);
  }

  async putOffer(input: CreateOfferInput): Promise<void> {
    const merchant = await this.getMerchant(input.merchantSlug);
    if (!merchant) {
      throw notFound("Merchant not found");
    }

    if (merchant.claimStatus !== "claimed" || !(await this.hasOperatorManagedAccess(input.merchantSlug))) {
      throw conflict("Only claimed merchants can publish offers");
    }

    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;

    await this.db.batch([
      this.db
        .prepare(
          `INSERT OR REPLACE INTO offers
             (offer_id, merchant_slug, title, summary, active_from, valid_through, offer_type, terms_text, priority, public_proof_url, offer_code, status, vertical_metadata_json, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`
        )
        .bind(
          input.offerId,
          input.merchantSlug,
          input.title,
          input.summary,
          input.activeFrom ?? null,
          input.validThrough,
          input.offerType,
          input.termsText,
          input.priority,
          input.publicProofUrl ?? null,
          input.offerCode ?? null,
          input.status,
          JSON.stringify(input.verticalMetadata),
          createdAt,
          updatedAt
        ),
      this.db.prepare(`DELETE FROM offer_countries WHERE offer_id = ?1`).bind(input.offerId),
      ...input.countryCodes.map((countryCode) =>
        this.db
          .prepare(`INSERT INTO offer_countries (offer_id, country_code) VALUES (?1, ?2)`)
          .bind(input.offerId, normalizeCountryCode(countryCode))
      )
    ]);
  }

  async putClaim(input: CreateClaimInput): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO merchant_claims
           (claim_id, merchant_slug, status, contact, note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      )
      .bind(
        input.claimId,
        input.merchantSlug,
        input.status,
        input.contact ?? null,
        input.note ?? null,
        input.createdAt ?? now,
        input.updatedAt ?? now
      )
      .run();
  }

  async deleteCategory(slug: string): Promise<void> {
    await this.db.prepare(`DELETE FROM categories WHERE slug = ?1`).bind(slug).run();
  }

  async deleteMerchant(slug: string): Promise<void> {
    await this.db.prepare(`DELETE FROM merchants WHERE slug = ?1`).bind(slug).run();
  }

  async deleteOffer(offerId: string): Promise<void> {
    await this.db.prepare(`DELETE FROM offers WHERE offer_id = ?1`).bind(offerId).run();
  }

  async deleteClaim(claimId: string): Promise<void> {
    await this.db.prepare(`DELETE FROM merchant_claims WHERE claim_id = ?1`).bind(claimId).run();
  }

  async listClaws(): Promise<Claw[]> {
    const result = await this.db.prepare(`SELECT * FROM claws ORDER BY created_at ASC`).all<ClawRow>();
    return (result.results ?? []).map(mapClaw);
  }

  private async countActiveOffersForMerchant(merchantSlug: string, now: string): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM offers
         WHERE merchant_slug = ?1
           AND status = 'active'
           AND (active_from IS NULL OR active_from <= ?2)
           AND valid_through >= ?2`
      )
      .bind(merchantSlug, now)
      .first<{ total: number | string }>();

    return Number(row?.total ?? 0);
  }

  private async countActiveOffersForMerchantByCategory(
    merchantSlug: string,
    categorySlug: string,
    now: string
  ): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM offers o
         JOIN merchant_categories mcat
           ON mcat.merchant_slug = o.merchant_slug
         WHERE o.merchant_slug = ?1
           AND mcat.category_slug = ?2
           AND o.status = 'active'
           AND (o.active_from IS NULL OR o.active_from <= ?3)
           AND o.valid_through >= ?3`
      )
      .bind(merchantSlug, categorySlug, now)
      .first<{ total: number | string }>();

    return Number(row?.total ?? 0);
  }

  private async listCountryCodesForMerchant(merchantSlug: string): Promise<string[]> {
    const result = await this.db
      .prepare(`SELECT country_code FROM merchant_countries WHERE merchant_slug = ?1 ORDER BY country_code ASC`)
      .bind(merchantSlug)
      .all<{ country_code: string }>();

    return (result.results ?? []).map((row) => row.country_code);
  }

  private async listCategorySlugsForMerchant(merchantSlug: string): Promise<string[]> {
    const result = await this.db
      .prepare(`SELECT category_slug FROM merchant_categories WHERE merchant_slug = ?1 ORDER BY category_slug ASC`)
      .bind(merchantSlug)
      .all<{ category_slug: string }>();

    return (result.results ?? []).map((row) => row.category_slug);
  }

  private async listCountryCodesForOffer(offerId: string): Promise<string[]> {
    const result = await this.db
      .prepare(`SELECT country_code FROM offer_countries WHERE offer_id = ?1 ORDER BY country_code ASC`)
      .bind(offerId)
      .all<{ country_code: string }>();

    return (result.results ?? []).map((row) => row.country_code);
  }

  private async hasOperatorManagedAccess(merchantSlug: string): Promise<boolean> {
    const latestClaim = await this.db
      .prepare(
        `SELECT status
         FROM merchant_claims
         WHERE merchant_slug = ?1
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`
      )
      .bind(merchantSlug)
      .first<ClaimStatusRow>();

    return latestClaim?.status === "claimed" || latestClaim?.status === "approved";
  }
}
