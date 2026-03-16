import type { Merchant } from "./domain";

export function normalizeCountryCode(countryCode: string): string {
  return countryCode.trim().toUpperCase();
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

