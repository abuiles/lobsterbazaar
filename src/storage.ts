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
  getMerchant(slug: string): Promise<Merchant | null>;
  listCountryMerchants(countryCode: string, now: string): Promise<CountryMerchantSummary[]>;
  listActiveOffers(countryCode: string, now: string): Promise<PublicOffer[]>;
  listMerchantArtifacts(now: string): Promise<MerchantArtifact[]>;
  listCountryCodes(): Promise<string[]>;
  putMerchant(input: CreateMerchantInput): Promise<void>;
  putOffer(input: CreateOfferInput): Promise<void>;
  putClaim(input: CreateClaimInput): Promise<void>;
  listClaws(): Promise<Claw[]>;
}
