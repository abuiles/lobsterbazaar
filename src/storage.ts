import type {
  Category,
  CategoriesArtifact,
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
  PublishedSkillsIndex,
  PublicOffer,
  RegisterClawInput,
  RegisterClawResult
} from "./domain";

export interface ArtifactStore {
  getCategories(): Promise<CategoriesArtifact | null>;
  putCategories(artifact: CategoriesArtifact): Promise<void>;
  getCategoryCountry(categorySlug: string, countryCode: string): Promise<CountryArtifact | null>;
  putCategoryCountry(categorySlug: string, artifact: CountryArtifact): Promise<void>;
  deleteCategoryCountry(categorySlug: string, countryCode: string): Promise<void>;
  getCategoryOffers(categorySlug: string, countryCode: string): Promise<OffersArtifact | null>;
  putCategoryOffers(categorySlug: string, artifact: OffersArtifact): Promise<void>;
  deleteCategoryOffers(categorySlug: string, countryCode: string): Promise<void>;
  getCategoryMerchant(categorySlug: string, slug: string): Promise<MerchantArtifact | null>;
  putCategoryMerchant(categorySlug: string, artifact: MerchantArtifact): Promise<void>;
  deleteCategoryMerchant(categorySlug: string, slug: string): Promise<void>;
  getRootSkill(): Promise<string | null>;
  putRootSkill(skill: string): Promise<void>;
  getPublishedSkillsIndex(): Promise<PublishedSkillsIndex | null>;
  putPublishedSkillsIndex(index: PublishedSkillsIndex): Promise<void>;
  getPublishedSkill(name: string): Promise<string | null>;
  putPublishedSkill(name: string, skill: string): Promise<void>;
  getCategorySkill(categorySlug: string): Promise<string | null>;
  putCategorySkill(categorySlug: string, skill: string): Promise<void>;
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
  getOffer(offerId: string): Promise<Offer | null>;
  listCategories(): Promise<Category[]>;
  listMerchants(): Promise<Merchant[]>;
  listOffers(): Promise<Offer[]>;
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
