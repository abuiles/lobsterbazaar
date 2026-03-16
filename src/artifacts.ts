import type {
  CountryArtifact,
  MerchantArtifact,
  OffersArtifact,
  SkillTemplateInput
} from "./domain";
import type { ArtifactStore, Repositories } from "./storage";
import { renderSkillTemplate } from "./skill";

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

  const artifact: CountryArtifact = {
    countryCode,
    generatedAt: now,
    merchants: await repositories.listCountryMerchants(countryCode, now)
  };

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

  const artifact: OffersArtifact = {
    countryCode,
    generatedAt: now,
    offers: await repositories.listActiveOffers(countryCode, now)
  };

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
  templateInput: SkillTemplateInput
): Promise<void> {
  const [countryCodes, merchants] = await Promise.all([
    repositories.listCountryCodes(),
    repositories.listMerchantArtifacts(now)
  ]);

  await Promise.all([
    ...countryCodes.flatMap((countryCode) => [
      ensureCountryArtifact(artifacts, repositories, countryCode, now),
      ensureOffersArtifact(artifacts, repositories, countryCode, now)
    ]),
    ...merchants.map((merchant) => artifacts.putMerchant(merchant)),
    artifacts.putSkill(renderSkillTemplate(templateInput))
  ]);
}

