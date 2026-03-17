import { badRequest } from "./errors";
import type { Merchant } from "./domain";

const COUNTRY_CODE_PATTERN = /^[A-Z]{2,3}$/;

export function normalizeCountryCode(countryCode: string): string {
  const normalized = countryCode.trim().toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(normalized)) {
    throw badRequest(`Invalid country code: ${countryCode}`);
  }

  return normalized;
}

export function deriveStorefrontMcpUrl(merchant: Pick<Merchant, "storeDomain" | "storeUrl" | "storefrontMcpUrl">): string {
  if (merchant.storefrontMcpUrl) {
    return merchant.storefrontMcpUrl;
  }

  if (merchant.storeDomain) {
    return `https://${merchant.storeDomain}/api/mcp`;
  }

  const url = new URL(merchant.storeUrl);
  return `${url.origin}/api/mcp`;
}

export function buildPublicMerchantSummary(input: {
  locationsSummary?: string;
  verticalMetadata?: Record<string, unknown>;
}): string {
  const verticalMetadata = input.verticalMetadata ?? {};
  const parts = [
    typeof verticalMetadata.city === "string" ? verticalMetadata.city : undefined,
    typeof verticalMetadata.neighborhood === "string" ? verticalMetadata.neighborhood : undefined,
    typeof verticalMetadata.type === "string" ? verticalMetadata.type : undefined,
    input.locationsSummary && input.locationsSummary !== "unknown physical cafes"
      ? input.locationsSummary
      : undefined
  ].filter((value): value is string => Boolean(value));

  return parts.join(" · ");
}

export function buildPublicMerchantDescription(input: {
  notes?: string;
  verticalMetadata?: Record<string, unknown>;
}): string {
  const verticalMetadata = input.verticalMetadata ?? {};
  const shopDescription = typeof verticalMetadata.shop_description === "string"
    ? verticalMetadata.shop_description.trim()
    : "";
  if (shopDescription) {
    return shopDescription;
  }

  return input.notes?.trim() ?? "";
}

export function compareCountryMerchants(
  left: { activeOffersCount: number; displayName: string; slug: string },
  right: { activeOffersCount: number; displayName: string; slug: string }
): number {
  if (left.activeOffersCount !== right.activeOffersCount) {
    return right.activeOffersCount - left.activeOffersCount;
  }

  const nameOrder = left.displayName.localeCompare(right.displayName);
  if (nameOrder !== 0) {
    return nameOrder;
  }

  return left.slug.localeCompare(right.slug);
}

export function isOfferActive(
  offer: { status: string; activeFrom?: string; validThrough: string },
  now: string
): boolean {
  if (offer.status !== "active") {
    return false;
  }

  if (offer.activeFrom && offer.activeFrom > now) {
    return false;
  }

  return offer.validThrough >= now;
}
