import type {
  Category,
  CategoriesArtifact,
  Claw,
  CountryArtifact,
  CountryMerchantSummary,
  FeaturedMerchantSummary,
  MetricsSnapshot,
  Merchant,
  MerchantArtifact,
  MerchantClaim,
  Offer,
  OffersArtifact,
  PublicOffer,
  RegisterClawInput,
  RegisterClawResult
} from "./domain";
import { hashSecret } from "./crypto";
import { conflict, notFound } from "./errors";
import { createApiKey, createId } from "./ids";
import {
  buildPublicMerchantDescription,
  buildPublicMerchantSummary,
  compareCountryMerchants,
  deriveStorefrontMcpUrl,
  isOfferActive,
  normalizeCountryCode
} from "./merchant";
import type {
  ArtifactStore,
  CreateCategoryInput,
  CreateClaimInput,
  CreateMerchantInput,
  CreateOfferInput,
  Repositories
} from "./storage";

export class MemoryArtifactStore implements ArtifactStore {
  private categories: CategoriesArtifact | null = null;
  private readonly countries = new Map<string, CountryArtifact>();
  private readonly offers = new Map<string, OffersArtifact>();
  private readonly merchants = new Map<string, MerchantArtifact>();
  private rootSkill: string | null = null;
  private readonly categorySkills = new Map<string, string>();

  async getCategories(): Promise<CategoriesArtifact | null> {
    return this.categories;
  }

  async putCategories(artifact: CategoriesArtifact): Promise<void> {
    this.categories = artifact;
  }

  async getCategoryCountry(categorySlug: string, countryCode: string): Promise<CountryArtifact | null> {
    return this.countries.get(`${categorySlug}:${countryCode}`) ?? null;
  }

  async putCategoryCountry(categorySlug: string, artifact: CountryArtifact): Promise<void> {
    this.countries.set(`${categorySlug}:${artifact.countryCode}`, artifact);
  }

  async getCategoryOffers(categorySlug: string, countryCode: string): Promise<OffersArtifact | null> {
    return this.offers.get(`${categorySlug}:${countryCode}`) ?? null;
  }

  async putCategoryOffers(categorySlug: string, artifact: OffersArtifact): Promise<void> {
    this.offers.set(`${categorySlug}:${artifact.countryCode}`, artifact);
  }

  async getCategoryMerchant(categorySlug: string, slug: string): Promise<MerchantArtifact | null> {
    return this.merchants.get(`${categorySlug}:${slug}`) ?? null;
  }

  async putCategoryMerchant(categorySlug: string, artifact: MerchantArtifact): Promise<void> {
    this.merchants.set(`${categorySlug}:${artifact.slug}`, artifact);
  }

  async getRootSkill(): Promise<string | null> {
    return this.rootSkill;
  }

  async putRootSkill(skill: string): Promise<void> {
    this.rootSkill = skill;
  }

  async getCategorySkill(categorySlug: string): Promise<string | null> {
    return this.categorySkills.get(categorySlug) ?? null;
  }

  async putCategorySkill(categorySlug: string, skill: string): Promise<void> {
    this.categorySkills.set(categorySlug, skill);
  }
}

export class MemoryRepositories implements Repositories {
  private readonly categories = new Map<string, Category>();
  private readonly merchants = new Map<string, Merchant>();
  private readonly offers = new Map<string, Offer>();
  private readonly claims = new Map<string, MerchantClaim>();
  private readonly claws = new Map<string, Claw>();

  async createClaw(input: RegisterClawInput, deployId: string): Promise<RegisterClawResult> {
    if (input.role === "merchant") {
      if (!input.merchantSlug) {
        throw notFound("Merchant not found");
      }

      const merchant = this.merchants.get(input.merchantSlug);
      if (!merchant) {
        throw notFound("Merchant not found");
      }

      if (merchant.claimStatus !== "claimed") {
        throw conflict("Merchant registration is not allowed");
      }

      if (!this.hasOperatorManagedAccess(merchant.slug)) {
        throw conflict("Merchant registration is not allowed");
      }
    }

    const apiKey = createApiKey(deployId);
    const claw: Claw = {
      clawId: createId("claw"),
      role: input.role,
      displayName: input.displayName,
      description: input.description,
      merchantSlug: input.merchantSlug,
      apiKeyHash: await hashSecret(apiKey),
      createdAt: new Date().toISOString()
    };

    this.claws.set(claw.clawId, claw);

    return { claw, apiKey };
  }

  async getMerchant(slug: string): Promise<Merchant | null> {
    return this.merchants.get(slug) ?? null;
  }

  async getCategory(slug: string): Promise<Category | null> {
    return this.categories.get(slug) ?? null;
  }

  async listCategories(): Promise<Category[]> {
    return Array.from(this.categories.values()).sort((left, right) => left.slug.localeCompare(right.slug));
  }

  async listCountryMerchants(countryCode: string, now: string): Promise<CountryMerchantSummary[]> {
    const normalized = normalizeCountryCode(countryCode);
    const activeCounts = await this.listActiveOfferCounts(normalized, now);

    return Array.from(this.merchants.values())
      .filter((merchant) => merchant.countryCodes.includes(normalized))
      .map((merchant) => ({
        slug: merchant.slug,
        displayName: merchant.displayName,
        storeUrl: merchant.storeUrl,
        summary: buildPublicMerchantSummary({
          locationsSummary: merchant.locationsSummary,
          verticalMetadata: merchant.verticalMetadata
        }),
        description: buildPublicMerchantDescription({
          notes: merchant.notes,
          verticalMetadata: merchant.verticalMetadata
        }),
        activeOffersCount: activeCounts.get(merchant.slug) ?? 0
      }))
      .sort(compareCountryMerchants);
  }

  async listCountryMerchantsForCategory(
    categorySlug: string,
    countryCode: string,
    now: string
  ): Promise<CountryMerchantSummary[]> {
    const normalizedCategory = categorySlug.trim();
    const normalizedCountry = normalizeCountryCode(countryCode);
    const activeCounts = await this.listActiveOfferCountsForCategory(normalizedCategory, normalizedCountry, now);

    return Array.from(this.merchants.values())
      .filter((merchant) => merchant.categorySlugs.includes(normalizedCategory))
      .filter((merchant) => merchant.countryCodes.includes(normalizedCountry))
      .map((merchant) => ({
        slug: merchant.slug,
        displayName: merchant.displayName,
        storeUrl: merchant.storeUrl,
        summary: buildPublicMerchantSummary({
          locationsSummary: merchant.locationsSummary,
          verticalMetadata: merchant.verticalMetadata
        }),
        description: buildPublicMerchantDescription({
          notes: merchant.notes,
          verticalMetadata: merchant.verticalMetadata
        }),
        activeOffersCount: activeCounts.get(merchant.slug) ?? 0
      }))
      .sort(compareCountryMerchants);
  }

  async listFeaturedMerchants(now: string): Promise<FeaturedMerchantSummary[]> {
    const activeCounts = await this.listActiveOfferCounts(undefined, now);

    return Array.from(this.merchants.values())
      .filter((merchant) => merchant.verticalMetadata.featured === true)
      .map((merchant) => ({
        slug: merchant.slug,
        displayName: merchant.displayName,
        storeUrl: merchant.storeUrl,
        summary: buildPublicMerchantSummary({
          locationsSummary: merchant.locationsSummary,
          verticalMetadata: merchant.verticalMetadata
        }),
        description: buildPublicMerchantDescription({
          notes: merchant.notes,
          verticalMetadata: merchant.verticalMetadata
        }),
        activeOffersCount: activeCounts.get(merchant.slug) ?? 0
      }))
      .sort(compareCountryMerchants);
  }

  async supportsCountry(countryCode: string): Promise<boolean> {
    const normalized = normalizeCountryCode(countryCode);
    return Array.from(this.merchants.values()).some((merchant) => merchant.countryCodes.includes(normalized));
  }

  async supportsCategory(slug: string): Promise<boolean> {
    return this.categories.has(slug.trim());
  }

  async supportsCountryForCategory(categorySlug: string, countryCode: string): Promise<boolean> {
    const normalizedCategory = categorySlug.trim();
    const normalizedCountry = normalizeCountryCode(countryCode);
    return Array.from(this.merchants.values()).some((merchant) =>
      merchant.categorySlugs.includes(normalizedCategory) && merchant.countryCodes.includes(normalizedCountry)
    );
  }

  async listActiveOffers(countryCode: string, now: string): Promise<PublicOffer[]> {
    const normalized = normalizeCountryCode(countryCode);

    return Array.from(this.offers.values())
      .filter((offer) => offer.countryCodes.includes(normalized))
      .filter((offer) => isOfferActive(offer, now))
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return right.priority - left.priority;
        }

        return left.title.localeCompare(right.title);
      })
      .map((offer) => {
        const merchant = this.merchants.get(offer.merchantSlug);
        if (!merchant) {
          throw notFound("Merchant not found");
        }

        return {
          offerId: offer.offerId,
          merchantSlug: offer.merchantSlug,
          merchantDisplayName: merchant.displayName,
          title: offer.title,
          summary: offer.summary,
          offerType: offer.offerType,
          validThrough: offer.validThrough,
          termsText: offer.termsText
        };
      });
  }

  async listActiveOffersForCategory(categorySlug: string, countryCode: string, now: string): Promise<PublicOffer[]> {
    const normalizedCategory = categorySlug.trim();
    const normalizedCountry = normalizeCountryCode(countryCode);

    return Array.from(this.offers.values())
      .filter((offer) => offer.countryCodes.includes(normalizedCountry))
      .filter((offer) => isOfferActive(offer, now))
      .filter((offer) => this.merchants.get(offer.merchantSlug)?.categorySlugs.includes(normalizedCategory) === true)
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return right.priority - left.priority;
        }

        return left.title.localeCompare(right.title);
      })
      .map((offer) => {
        const merchant = this.merchants.get(offer.merchantSlug);
        if (!merchant) {
          throw notFound("Merchant not found");
        }

        return {
          offerId: offer.offerId,
          merchantSlug: offer.merchantSlug,
          merchantDisplayName: merchant.displayName,
          title: offer.title,
          summary: offer.summary,
          offerType: offer.offerType,
          validThrough: offer.validThrough,
          termsText: offer.termsText
        };
      });
  }

  async listActiveOffersForMerchant(merchantSlug: string, now: string): Promise<PublicOffer[]> {
    const merchant = this.merchants.get(merchantSlug);
    if (!merchant) {
      return [];
    }

    return Array.from(this.offers.values())
      .filter((offer) => offer.merchantSlug === merchantSlug)
      .filter((offer) => isOfferActive(offer, now))
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return right.priority - left.priority;
        }

        return left.title.localeCompare(right.title);
      })
      .map((offer) => ({
        offerId: offer.offerId,
        merchantSlug: offer.merchantSlug,
        merchantDisplayName: merchant.displayName,
        title: offer.title,
        summary: offer.summary,
        offerType: offer.offerType,
        validThrough: offer.validThrough,
        termsText: offer.termsText
      }));
  }

  async listMerchantArtifacts(now: string, since?: string): Promise<MerchantArtifact[]> {
    const merchants = Array.from(this.merchants.values());
    const sourceMerchants = since
      ? merchants.filter((merchant) => merchant.createdAt > since)
      : merchants;

    const activeCounts = await this.listActiveOfferCounts(undefined, now);

    return sourceMerchants.map((merchant) => ({
      slug: merchant.slug,
      displayName: merchant.displayName,
      storeUrl: merchant.storeUrl,
      countryCodes: merchant.countryCodes,
      categorySlugs: merchant.categorySlugs,
      notes: merchant.notes,
      storefrontMcpUrl: deriveStorefrontMcpUrl(merchant),
      claimStatus: merchant.claimStatus,
      activeOffersCount: activeCounts.get(merchant.slug) ?? 0
    }));
  }

  async listMerchantArtifactsForCategory(categorySlug: string, now: string, since?: string): Promise<MerchantArtifact[]> {
    const normalizedCategory = categorySlug.trim();
    const merchants = Array.from(this.merchants.values()).filter((merchant) =>
      merchant.categorySlugs.includes(normalizedCategory)
    );
    const sourceMerchants = since
      ? merchants.filter((merchant) => merchant.createdAt > since)
      : merchants;
    const activeCounts = await this.listActiveOfferCountsForCategory(normalizedCategory, undefined, now);

    return sourceMerchants.map((merchant) => ({
      slug: merchant.slug,
      displayName: merchant.displayName,
      storeUrl: merchant.storeUrl,
      countryCodes: merchant.countryCodes,
      categorySlugs: merchant.categorySlugs,
      notes: merchant.notes,
      storefrontMcpUrl: deriveStorefrontMcpUrl(merchant),
      claimStatus: merchant.claimStatus,
      activeOffersCount: activeCounts.get(merchant.slug) ?? 0
    }));
  }

  async listCountryCodes(): Promise<string[]> {
    return Array.from(
      new Set(Array.from(this.merchants.values()).flatMap((merchant) => merchant.countryCodes))
    ).sort();
  }

  async listCountryCodesForCategory(categorySlug: string): Promise<string[]> {
    const normalizedCategory = categorySlug.trim();
    return Array.from(
      new Set(
        Array.from(this.merchants.values())
          .filter((merchant) => merchant.categorySlugs.includes(normalizedCategory))
          .flatMap((merchant) => merchant.countryCodes)
      )
    ).sort();
  }

  async listCategorySlugs(): Promise<string[]> {
    return Array.from(this.categories.keys()).sort();
  }

  async listMerchantSlugs(since?: string): Promise<string[]> {
    const merchants = Array.from(this.merchants.values());
    const filteredMerchants = since ? merchants.filter((merchant) => merchant.createdAt > since) : merchants;

    return filteredMerchants.map((merchant) => merchant.slug).sort();
  }

  async listOfferIds(since?: string): Promise<string[]> {
    const offers = Array.from(this.offers.values());
    const filteredOffers = since ? offers.filter((offer) => offer.createdAt > since) : offers;

    return filteredOffers.map((offer) => offer.offerId).sort();
  }

  async listClaimIds(): Promise<string[]> {
    return Array.from(this.claims.keys()).sort();
  }

  async listOfferMerchantSlugsForAddedSince(since: string): Promise<string[]> {
    const offerSlugs = Array.from(this.offers.values())
      .filter((offer) => offer.createdAt > since)
      .map((offer) => offer.merchantSlug)
      .sort();

    return Array.from(new Set(offerSlugs));
  }

  async listOfferCountryCodesForAddedSince(since: string): Promise<string[]> {
    const countryCodes = Array.from(this.offers.values())
      .filter((offer) => offer.createdAt > since)
      .flatMap((offer) => offer.countryCodes);

    return Array.from(new Set(countryCodes)).sort();
  }

  async getMetricsSnapshot(now: string): Promise<MetricsSnapshot> {
    const merchants = Array.from(this.merchants.values());

    return {
      merchantCount: merchants.length,
      activeOfferCount: Array.from(this.offers.values()).filter((offer) => isOfferActive(offer, now)).length,
      claimedMerchantCount: merchants.filter((merchant) => merchant.claimStatus === "claimed").length,
      countryCount: new Set(merchants.flatMap((merchant) => merchant.countryCodes)).size
    };
  }

  async putCategory(input: CreateCategoryInput): Promise<void> {
    const now = new Date().toISOString();
    this.categories.set(input.slug, {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    });
  }

  async putMerchant(input: CreateMerchantInput): Promise<void> {
    const now = new Date().toISOString();
    const categorySlugs = Array.from(new Set(input.categorySlugs.map((slug) => slug.trim()).filter(Boolean))).sort();

    if (categorySlugs.length === 0) {
      throw conflict("Merchants must belong to at least one category");
    }

    for (const categorySlug of categorySlugs) {
      if (!this.categories.has(categorySlug)) {
        throw notFound(`Category not found: ${categorySlug}`);
      }
    }

    this.merchants.set(input.slug, {
      ...input,
      countryCodes: input.countryCodes.map(normalizeCountryCode),
      categorySlugs,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    });
  }

  async putOffer(input: CreateOfferInput): Promise<void> {
    const merchant = this.merchants.get(input.merchantSlug);
    if (!merchant) {
      throw notFound("Merchant not found");
    }

    if (merchant.claimStatus !== "claimed" || !this.hasOperatorManagedAccess(input.merchantSlug)) {
      throw conflict("Only claimed merchants can publish offers");
    }

    const now = new Date().toISOString();
    this.offers.set(input.offerId, {
      ...input,
      countryCodes: input.countryCodes.map(normalizeCountryCode),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    });
  }

  async putClaim(input: CreateClaimInput): Promise<void> {
    const now = new Date().toISOString();
    this.claims.set(input.claimId, {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    });
  }

  async deleteCategory(slug: string): Promise<void> {
    this.categories.delete(slug);

    for (const merchant of Array.from(this.merchants.values())) {
      if (!merchant.categorySlugs.includes(slug)) {
        continue;
      }

      const nextCategorySlugs = merchant.categorySlugs.filter((categorySlug) => categorySlug !== slug);
      if (nextCategorySlugs.length === 0) {
        await this.deleteMerchant(merchant.slug);
        continue;
      }

      this.merchants.set(merchant.slug, {
        ...merchant,
        categorySlugs: nextCategorySlugs,
        updatedAt: new Date().toISOString()
      });
    }
  }

  async deleteMerchant(slug: string): Promise<void> {
    this.merchants.delete(slug);

    for (const [claimId, claim] of this.claims.entries()) {
      if (claim.merchantSlug === slug) {
        this.claims.delete(claimId);
      }
    }

    for (const [offerId, offer] of this.offers.entries()) {
      if (offer.merchantSlug === slug) {
        this.offers.delete(offerId);
      }
    }
  }

  async deleteOffer(offerId: string): Promise<void> {
    this.offers.delete(offerId);
  }

  async deleteClaim(claimId: string): Promise<void> {
    this.claims.delete(claimId);
  }

  async listClaws(): Promise<Claw[]> {
    return Array.from(this.claws.values());
  }

  private hasOperatorManagedAccess(merchantSlug: string): boolean {
    const latestClaim = Array.from(this.claims.values())
      .filter((claim) => claim.merchantSlug === merchantSlug)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

    return latestClaim?.status === "claimed" || latestClaim?.status === "approved";
  }

  private async listActiveOfferCounts(countryCode: string | undefined, now: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();

    for (const offer of this.offers.values()) {
      if (countryCode && !offer.countryCodes.includes(countryCode)) {
        continue;
      }

      if (!isOfferActive(offer, now)) {
        continue;
      }

      counts.set(offer.merchantSlug, (counts.get(offer.merchantSlug) ?? 0) + 1);
    }

    return counts;
  }

  private async listActiveOfferCountsForCategory(
    categorySlug: string,
    countryCode: string | undefined,
    now: string
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const normalizedCountry = typeof countryCode === "string" ? normalizeCountryCode(countryCode) : undefined;

    for (const offer of this.offers.values()) {
      if (normalizedCountry && !offer.countryCodes.includes(normalizedCountry)) {
        continue;
      }

      if (!isOfferActive(offer, now)) {
        continue;
      }

      const merchant = this.merchants.get(offer.merchantSlug);
      if (!merchant || !merchant.categorySlugs.includes(categorySlug)) {
        continue;
      }

      counts.set(offer.merchantSlug, (counts.get(offer.merchantSlug) ?? 0) + 1);
    }

    return counts;
  }
}
