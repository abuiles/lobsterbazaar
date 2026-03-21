export type ClawRole = "buyer" | "merchant";

export type ClaimStatus = "unclaimed" | "claimed";

export type OfferStatus = "draft" | "active" | "expired";

export interface Category {
  slug: string;
  name: string;
  summary: string;
  skillBuyingTargets?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Merchant {
  slug: string;
  displayName: string;
  storeUrl: string;
  storeDomain?: string;
  storefrontMcpUrl?: string;
  countryCodes: string[];
  categorySlugs: string[];
  locationsSummary?: string;
  notes: string;
  tags: string[];
  claimContact?: string;
  claimStatus: ClaimStatus;
  verticalMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantClaim {
  claimId: string;
  merchantSlug: string;
  status: string;
  contact?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Offer {
  offerId: string;
  merchantSlug: string;
  title: string;
  summary: string;
  countryCodes: string[];
  activeFrom?: string;
  validThrough: string;
  offerType: string;
  termsText: string;
  priority: number;
  publicProofUrl?: string;
  offerCode?: string;
  status: OfferStatus;
  verticalMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Claw {
  clawId: string;
  role: ClawRole;
  displayName: string;
  description?: string;
  merchantSlug?: string;
  apiKeyHash: string;
  createdAt: string;
}

export interface RegisterClawInput {
  role: ClawRole;
  displayName: string;
  description?: string;
  merchantSlug?: string;
}

export interface RegisterClawResult {
  claw: Claw;
  apiKey: string;
}

export interface CountryMerchantSummary {
  slug: string;
  displayName: string;
  storeUrl: string;
  summary: string;
  description: string;
  activeOffersCount: number;
}

export interface FeaturedMerchantSummary {
  slug: string;
  displayName: string;
  storeUrl: string;
  summary: string;
  description: string;
  activeOffersCount: number;
}

export interface PublicOffer {
  offerId: string;
  merchantSlug: string;
  merchantDisplayName: string;
  title: string;
  summary: string;
  offerType: string;
  validThrough: string;
  termsText: string;
}

export interface MerchantConnectPayload {
  merchant: {
    name: string;
    slug: string;
    connectPath: string;
    storeUrl: string;
  };
  mcp: {
    url: string;
  };
  offers: Array<{
    offerId: string;
    title: string;
    summary: string;
    offerType: string;
    validThrough: string;
    termsText: string;
  }>;
  cartAttributes: Array<{
    key: string;
    value: string;
  }>;
}

export interface CountryArtifact {
  countryCode: string;
  generatedAt: string;
  merchants: CountryMerchantSummary[];
}

export interface OffersArtifact {
  countryCode: string;
  generatedAt: string;
  offers: PublicOffer[];
}

export interface MerchantArtifact {
  slug: string;
  displayName: string;
  storeUrl: string;
  countryCodes: string[];
  categorySlugs: string[];
  notes: string;
  storefrontMcpUrl: string;
  claimStatus: ClaimStatus;
  activeOffersCount: number;
}

export interface SkillTemplateInput {
  brandName: string;
  deployId: string;
  deployDomain: string;
  verticalSummary: string;
  skillBuyingTargets?: string;
  registerPath: string;
  countriesPath: string;
  offersPath: string;
  merchantConnectPath: string;
}

export interface DirectoryVertical {
  deployId: string;
  brandName: string;
  domain: string;
  url: string;
  verticalName?: string;
  directorySubtitle?: string;
  emoji?: string;
}

export interface DeployConfig {
  brandName: string;
  deployId: string;
  deployDomain: string;
  verticalId: string;
  verticalSummary: string;
  skillBuyingTargets?: string;
  mascotUrl: string;
  emoji: string;
  directoryVerticals: DirectoryVertical[];
}

export interface DeployFileConfig {
  brandName: string;
  deployId: string;
  deployDomain: string;
  brandDescription: string;
  directorySummary: string;
  skillBuyingTargets?: string;
  mascotUrl: string;
  emoji: string;
  defaultCountries: string[];
  publicDirectory: boolean;
  offersEnabled: boolean;
  claimMode: "operator_managed";
}

export interface DeployPackage {
  config: DeployFileConfig;
  categories: Category[];
  merchants: Merchant[];
  claims: MerchantClaim[];
  offers: Offer[];
}

export interface MetricsSnapshot {
  merchantCount: number;
  activeOfferCount: number;
  claimedMerchantCount: number;
  countryCount: number;
}
