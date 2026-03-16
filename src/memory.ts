import type {
  Claw,
  CountryArtifact,
  CountryMerchantSummary,
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
import { compareCountryMerchants, deriveStorefrontMcpUrl, isOfferActive, normalizeCountryCode } from "./merchant";
import type { ArtifactStore, CreateClaimInput, CreateMerchantInput, CreateOfferInput, Repositories } from "./storage";

export class MemoryArtifactStore implements ArtifactStore {
  private readonly countries = new Map<string, CountryArtifact>();
  private readonly offers = new Map<string, OffersArtifact>();
  private readonly merchants = new Map<string, MerchantArtifact>();
  private skill: string | null = null;

  async getCountry(countryCode: string): Promise<CountryArtifact | null> {
    return this.countries.get(countryCode) ?? null;
  }

  async putCountry(artifact: CountryArtifact): Promise<void> {
    this.countries.set(artifact.countryCode, artifact);
  }

  async getOffers(countryCode: string): Promise<OffersArtifact | null> {
    return this.offers.get(countryCode) ?? null;
  }

  async putOffers(artifact: OffersArtifact): Promise<void> {
    this.offers.set(artifact.countryCode, artifact);
  }

  async getMerchant(slug: string): Promise<MerchantArtifact | null> {
    return this.merchants.get(slug) ?? null;
  }

  async putMerchant(artifact: MerchantArtifact): Promise<void> {
    this.merchants.set(artifact.slug, artifact);
  }

  async getSkill(): Promise<string | null> {
    return this.skill;
  }

  async putSkill(skill: string): Promise<void> {
    this.skill = skill;
  }
}

export class MemoryRepositories implements Repositories {
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

  async listCountryMerchants(countryCode: string, now: string): Promise<CountryMerchantSummary[]> {
    const normalized = normalizeCountryCode(countryCode);
    const activeCounts = await this.listActiveOfferCounts(normalized, now);

    return Array.from(this.merchants.values())
      .filter((merchant) => merchant.countryCodes.includes(normalized))
      .map((merchant) => ({
        slug: merchant.slug,
        displayName: merchant.displayName,
        storeUrl: merchant.storeUrl,
        notes: merchant.notes,
        claimStatus: merchant.claimStatus,
        activeOffersCount: activeCounts.get(merchant.slug) ?? 0
      }))
      .sort(compareCountryMerchants);
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

  async listMerchantArtifacts(now: string): Promise<MerchantArtifact[]> {
    const activeCounts = await this.listActiveOfferCounts(undefined, now);

    return Array.from(this.merchants.values()).map((merchant) => ({
      slug: merchant.slug,
      displayName: merchant.displayName,
      storeUrl: merchant.storeUrl,
      countryCodes: merchant.countryCodes,
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

  async putMerchant(input: CreateMerchantInput): Promise<void> {
    const now = new Date().toISOString();
    this.merchants.set(input.slug, {
      ...input,
      countryCodes: input.countryCodes.map(normalizeCountryCode),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    });
  }

  async putOffer(input: CreateOfferInput): Promise<void> {
    if (!this.merchants.has(input.merchantSlug)) {
      throw notFound("Merchant not found");
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

  async listClaws(): Promise<Claw[]> {
    return Array.from(this.claws.values());
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
}
