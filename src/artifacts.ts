import type {
  CountryArtifact,
  MerchantArtifact,
  OffersArtifact,
  SkillTemplateInput
} from "./domain";
import type { ArtifactStore, Repositories } from "./storage";
import { renderSkillTemplate } from "./skill";

async function buildCountryArtifact(
  repositories: Repositories,
  countryCode: string,
  now: string
): Promise<CountryArtifact> {
  return {
    countryCode,
    generatedAt: now,
    merchants: await repositories.listCountryMerchants(countryCode, now)
  };
}

async function buildOffersArtifact(
  repositories: Repositories,
  countryCode: string,
  now: string
): Promise<OffersArtifact> {
  return {
    countryCode,
    generatedAt: now,
    offers: await repositories.listActiveOffers(countryCode, now)
  };
}

export async function ensureCountryArtifact(
  artifacts: ArtifactStore,
  repositories: Repositories,
  countryCode: string,
  now: string
): Promise<CountryArtifact> {
  const cached = await artifacts.getCountry(countryCode);
  if (cached) {
    return cached;
  }

  const artifact = await buildCountryArtifact(repositories, countryCode, now);
  await artifacts.putCountry(artifact);
  return artifact;
}

export async function ensureOffersArtifact(
  artifacts: ArtifactStore,
  repositories: Repositories,
  countryCode: string,
  now: string
): Promise<OffersArtifact> {
  const cached = await artifacts.getOffers(countryCode);
  if (cached) {
    return cached;
  }

  const artifact = await buildOffersArtifact(repositories, countryCode, now);
  await artifacts.putOffers(artifact);
  return artifact;
}

export async function ensureMerchantArtifact(
  artifacts: ArtifactStore,
  repositories: Repositories,
  slug: string,
  now: string
): Promise<MerchantArtifact | null> {
  const cached = await artifacts.getMerchant(slug);
  if (cached) {
    return cached;
  }

  const merchants = await repositories.listMerchantArtifacts(now);
  const merchant = merchants.find((entry) => entry.slug === slug) ?? null;
  if (!merchant) {
    return null;
  }

  await artifacts.putMerchant(merchant);
  return merchant;
}

export async function ensureSkillArtifact(
  artifacts: ArtifactStore,
  templateInput: SkillTemplateInput
): Promise<string> {
  const cached = await artifacts.getSkill();
  if (cached) {
    return cached;
  }

  const skill = renderSkillTemplate(templateInput);
  await artifacts.putSkill(skill);
  return skill;
}

export async function materializePublicArtifacts(
  artifacts: ArtifactStore,
  repositories: Repositories,
  now: string,
  templateInput: SkillTemplateInput,
  options: {
    since?: string;
  } = {}
): Promise<void> {
  const { since } = options;

  if (!since) {
    const [countryCodes, merchantArtifacts] = await Promise.all([
      repositories.listCountryCodes(),
      repositories.listMerchantArtifacts(now)
    ]);

    await Promise.all([
      ...countryCodes.flatMap((countryCode) => [
        buildCountryArtifact(repositories, countryCode, now).then((artifact) => artifacts.putCountry(artifact)),
        buildOffersArtifact(repositories, countryCode, now).then((artifact) => artifacts.putOffers(artifact))
      ]),
      ...merchantArtifacts.map((merchant) => artifacts.putMerchant(merchant)),
      artifacts.putSkill(renderSkillTemplate(templateInput))
    ]);

    return;
  }

  const [newMerchantArtifacts, allMerchantArtifacts, offerCountryCodes, merchantSlugsFromOffers] = await Promise.all([
    repositories.listMerchantArtifacts(now, since),
    repositories.listMerchantArtifacts(now),
    repositories.listOfferCountryCodesForAddedSince(since),
    repositories.listOfferMerchantSlugsForAddedSince(since)
  ]);

  const touchedMerchantSlugs = new Set<string>([
    ...newMerchantArtifacts.map((merchant) => merchant.slug),
    ...merchantSlugsFromOffers
  ]);
  const touchedCountries = new Set<string>();
  for (const merchant of newMerchantArtifacts) {
    for (const countryCode of merchant.countryCodes) {
      touchedCountries.add(countryCode);
    }
  }

  for (const countryCode of offerCountryCodes) {
    touchedCountries.add(countryCode);
  }

  const merchantsToMaterialize = allMerchantArtifacts.filter((merchant) => touchedMerchantSlugs.has(merchant.slug));
  const countryCodesToMaterialize = touchedCountries.size > 0
    ? Array.from(touchedCountries).sort()
    : [];

  if (countryCodesToMaterialize.length === 0 && merchantsToMaterialize.length === 0) {
    await artifacts.putSkill(renderSkillTemplate(templateInput));
    return;
  }

  await Promise.all([
    ...countryCodesToMaterialize.map((countryCode) => [
      buildCountryArtifact(repositories, countryCode, now).then((artifact) => artifacts.putCountry(artifact)),
      buildOffersArtifact(repositories, countryCode, now).then((artifact) => artifacts.putOffers(artifact))
    ]).flat(),
    ...merchantsToMaterialize.map((merchant) => artifacts.putMerchant(merchant)),
    artifacts.putSkill(renderSkillTemplate(templateInput))
  ]);
}
