import { hashSecret } from "./crypto";
import type {
  Claw,
  CountryMerchantSummary,
  Merchant,
  MerchantArtifact,
  MerchantClaim,
  PublicOffer,
  RegisterClawInput,
  RegisterClawResult
} from "./domain";
import { conflict, notFound } from "./errors";
import { createApiKey, createId } from "./ids";
import { compareCountryMerchants, deriveStorefrontMcpUrl, normalizeCountryCode } from "./merchant";
import type { CreateClaimInput, CreateMerchantInput, CreateOfferInput, Repositories } from "./storage";

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

function mapMerchant(row: MerchantRow, countryCodes: string[]): Merchant {
  return {
    slug: row.slug,
    displayName: row.display_name,
    storeUrl: row.store_url,
    storeDomain: row.store_domain ?? undefined,
    storefrontMcpUrl: row.storefront_mcp_url ?? undefined,
    countryCodes,
    locationsSummary: row.locations_summary ?? undefined,
    notes: row.notes,
    tags: parseJson<string[]>(row.tags_json),
    claimContact: row.claim_contact ?? undefined,
    claimStatus: row.claim_status as Merchant["claimStatus"],
    verticalMetadata: parseJson<Record<string, unknown>>(row.vertical_metadata_json),
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

    const countries = await this.listCountryCodesForMerchant(slug);
    return mapMerchant(merchantRow, countries);
  }

  async listCountryMerchants(countryCode: string, now: string): Promise<CountryMerchantSummary[]> {
    const normalized = normalizeCountryCode(countryCode);
    const result = await this.db
      .prepare(
        `SELECT
           m.slug,
           m.display_name,
           m.store_url,
           m.notes,
           m.claim_status,
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
         GROUP BY m.slug, m.display_name, m.store_url, m.notes, m.claim_status`
      )
      .bind(normalized, now)
      .all<{
        slug: string;
        display_name: string;
        store_url: string;
        notes: string;
        claim_status: Merchant["claimStatus"];
        active_offers_count: number | string;
      }>();

    return (result.results ?? [])
      .map((row) => ({
        slug: row.slug,
        displayName: row.display_name,
        storeUrl: row.store_url,
        notes: row.notes,
        claimStatus: row.claim_status,
        activeOffersCount: Number(row.active_offers_count ?? 0)
      }))
      .sort(compareCountryMerchants);
  }

  async supportsCountry(countryCode: string): Promise<boolean> {
    const normalized = normalizeCountryCode(countryCode);
    const row = await this.db
      .prepare(
        `SELECT 1 AS supported
         FROM merchant_countries
         WHERE country_code = ?1
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

  async listMerchantArtifacts(now: string): Promise<MerchantArtifact[]> {
    const merchantsResult = await this.db.prepare(`SELECT * FROM merchants ORDER BY slug ASC`).all<MerchantRow>();
    const merchants = merchantsResult.results ?? [];

    return Promise.all(
      merchants.map(async (row) => {
        const [countryCodes, activeOffersCount] = await Promise.all([
          this.listCountryCodesForMerchant(row.slug),
          this.countActiveOffersForMerchant(row.slug, now)
        ]);

        return {
          slug: row.slug,
          displayName: row.display_name,
          storeUrl: row.store_url,
          countryCodes,
          notes: row.notes,
          storefrontMcpUrl: deriveStorefrontMcpUrl(mapMerchant(row, countryCodes)),
          claimStatus: row.claim_status as Merchant["claimStatus"],
          activeOffersCount
        };
      })
    );
  }

  async listCountryCodes(): Promise<string[]> {
    const result = await this.db
      .prepare(`SELECT DISTINCT country_code FROM merchant_countries ORDER BY country_code ASC`)
      .all<{ country_code: string }>();

    return (result.results ?? []).map((row) => row.country_code);
  }

  async listMerchantSlugs(): Promise<string[]> {
    const result = await this.db
      .prepare(`SELECT slug FROM merchants ORDER BY slug ASC`)
      .all<{ slug: string }>();

    return (result.results ?? []).map((row) => row.slug);
  }

  async listOfferIds(): Promise<string[]> {
    const result = await this.db
      .prepare(`SELECT offer_id FROM offers ORDER BY offer_id ASC`)
      .all<{ offer_id: string }>();

    return (result.results ?? []).map((row) => row.offer_id);
  }

  async listClaimIds(): Promise<string[]> {
    const result = await this.db
      .prepare(`SELECT claim_id FROM merchant_claims ORDER BY claim_id ASC`)
      .all<{ claim_id: string }>();

    return (result.results ?? []).map((row) => row.claim_id);
  }

  async putMerchant(input: CreateMerchantInput): Promise<void> {
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO merchants
             (slug, display_name, store_url, store_domain, storefront_mcp_url, locations_summary, notes, tags_json, claim_contact, claim_status, vertical_metadata_json, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
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
          createdAt,
          updatedAt
        ),
      this.db.prepare(`DELETE FROM merchant_countries WHERE merchant_slug = ?1`).bind(input.slug),
      ...input.countryCodes.map((countryCode) =>
        this.db
          .prepare(`INSERT INTO merchant_countries (merchant_slug, country_code) VALUES (?1, ?2)`)
          .bind(input.slug, normalizeCountryCode(countryCode))
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

  private async listCountryCodesForMerchant(merchantSlug: string): Promise<string[]> {
    const result = await this.db
      .prepare(`SELECT country_code FROM merchant_countries WHERE merchant_slug = ?1 ORDER BY country_code ASC`)
      .bind(merchantSlug)
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
