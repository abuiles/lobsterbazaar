import type {
  Category,
  Claw,
  CountryArtifact,
  FeaturedMerchantSummary,
  CountryMerchantSummary,
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

export interface ArtifactStore {
  getCountry(countryCode: string): Promise<CountryArtifact | null>;
  putCountry(artifact: CountryArtifact): Promise<void>;
  getOffers(countryCode: string): Promise<OffersArtifact | null>;
  putOffers(artifact: OffersArtifact): Promise<void>;
  getMerchant(slug: string): Promise<MerchantArtifact | null>;
  putMerchant(artifact: MerchantArtifact): Promise<void>;
  getSkill(): Promise<string | null>;
  putSkill(skill: string): Promise<void>;
}

export interface CreateMerchantInput extends Omit<Merchant, "createdAt" | "updatedAt"> {
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateCategoryInput extends Omit<Category, "createdAt" | "updatedAt"> {
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateOfferInput extends Omit<Offer, "createdAt" | "updatedAt"> {
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateClaimInput extends Omit<MerchantClaim, "createdAt" | "updatedAt"> {
  createdAt?: string;
  updatedAt?: string;
}

export interface Repositories {
  createClaw(input: RegisterClawInput, deployId: string): Promise<RegisterClawResult>;
  getCategory(slug: string): Promise<Category | null>;
  getMerchant(slug: string): Promise<Merchant | null>;
  listCategories(): Promise<Category[]>;
  supportsCountry(countryCode: string): Promise<boolean>;
  supportsCategory(slug: string): Promise<boolean>;
  supportsCountryForCategory(categorySlug: string, countryCode: string): Promise<boolean>;
  listCountryMerchants(countryCode: string, now: string): Promise<CountryMerchantSummary[]>;
  listCountryMerchantsForCategory(categorySlug: string, countryCode: string, now: string): Promise<CountryMerchantSummary[]>;
  listFeaturedMerchants(now: string): Promise<FeaturedMerchantSummary[]>;
  listActiveOffers(countryCode: string, now: string): Promise<PublicOffer[]>;
  listActiveOffersForCategory(categorySlug: string, countryCode: string, now: string): Promise<PublicOffer[]>;
  listActiveOffersForMerchant(merchantSlug: string, now: string): Promise<PublicOffer[]>;
  listMerchantArtifacts(now: string, since?: string): Promise<MerchantArtifact[]>;
  listMerchantArtifactsForCategory(categorySlug: string, now: string, since?: string): Promise<MerchantArtifact[]>;
  listCountryCodes(): Promise<string[]>;
  listCountryCodesForCategory(categorySlug: string): Promise<string[]>;
  listCategorySlugs(): Promise<string[]>;
  listMerchantSlugs(since?: string): Promise<string[]>;
  listOfferIds(since?: string): Promise<string[]>;
  listClaimIds(): Promise<string[]>;
  listOfferMerchantSlugsForAddedSince(since: string): Promise<string[]>;
  listOfferCountryCodesForAddedSince(since: string): Promise<string[]>;
  getMetricsSnapshot(now: string): Promise<MetricsSnapshot>;
  putCategory(input: CreateCategoryInput): Promise<void>;
  putMerchant(input: CreateMerchantInput): Promise<void>;
  putOffer(input: CreateOfferInput): Promise<void>;
  putClaim(input: CreateClaimInput): Promise<void>;
  deleteCategory(slug: string): Promise<void>;
  deleteMerchant(slug: string): Promise<void>;
  deleteOffer(offerId: string): Promise<void>;
  deleteClaim(claimId: string): Promise<void>;
  listClaws(): Promise<Claw[]>;
}
