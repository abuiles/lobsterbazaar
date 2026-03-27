import type {
  CategoriesArtifact,
  Category,
  CategoryDirectoryEntry,
  CountryArtifact,
  Merchant,
  MerchantArtifact,
  OffersArtifact,
  PublishedSkillsIndex,
  RootSkillTemplateInput
} from "./domain";
import type { ArtifactStore, Repositories } from "./storage";
import { renderRootSkillTemplate, ROOT_SKILL_DESCRIPTION, ROOT_SKILL_NAME } from "./skill";

interface SkillArtifactBaseInput {
  brandName: string;
  deployId: string;
  deployDomain: string;
  directorySummary: string;
  registerPath: string;
}

interface OfferRefreshInput {
  merchantSlug: string;
  countryCodes: string[];
}

function buildCategoryDirectoryEntry(
  category: Pick<Category, "slug" | "name" | "summary" | "subtitle" | "mascotUrl" | "skillBuyingTargets">
): CategoryDirectoryEntry {
  return {
    slug: category.slug,
    name: category.name,
    summary: category.summary,
    subtitle: category.subtitle,
    mascotUrl: category.mascotUrl,
    buyingTargets: category.skillBuyingTargets?.trim() || undefined,
    countriesPath: `/${category.slug}/countries`
  };
}

function buildRootSkillInput(
  input: SkillArtifactBaseInput,
  categories: Category[]
): RootSkillTemplateInput {
  return {
    brandName: input.brandName,
    deployId: input.deployId,
    deployDomain: input.deployDomain,
    directorySummary: input.directorySummary,
    categories: categories.map(buildCategoryDirectoryEntry),
    categoriesPath: "/categories",
    registerPath: input.registerPath
  };
}

function buildPublishedSkillsIndex(): PublishedSkillsIndex {
  return {
    skills: [
      {
        name: ROOT_SKILL_NAME,
        description: ROOT_SKILL_DESCRIPTION,
        files: ["SKILL.md"]
      }
    ]
  };
}

async function buildCategoriesArtifact(
  repositories: Repositories,
  now: string
): Promise<CategoriesArtifact> {
  const categories = (await repositories.listCategories()).filter((category) => category.isPublished !== false);
  return {
    generatedAt: now,
    categories: categories.map(buildCategoryDirectoryEntry)
  };
}

async function buildCategoryCountryArtifact(
  repositories: Repositories,
  categorySlug: string,
  countryCode: string,
  now: string
): Promise<CountryArtifact> {
  return {
    countryCode,
    generatedAt: now,
    merchants: await repositories.listCountryMerchantsForCategory(categorySlug, countryCode, now)
  };
}

async function buildCategoryOffersArtifact(
  repositories: Repositories,
  categorySlug: string,
  countryCode: string,
  now: string
): Promise<OffersArtifact> {
  return {
    countryCode,
    generatedAt: now,
    offers: await repositories.listActiveOffersForCategory(categorySlug, countryCode, now)
  };
}

async function refreshCategoryCountryArtifacts(
  artifacts: ArtifactStore,
  repositories: Repositories,
  categorySlug: string,
  countryCode: string,
  now: string
): Promise<void> {
  if (await repositories.supportsCountryForCategory(categorySlug, countryCode)) {
    const [countryArtifact, offersArtifact] = await Promise.all([
      buildCategoryCountryArtifact(repositories, categorySlug, countryCode, now),
      buildCategoryOffersArtifact(repositories, categorySlug, countryCode, now)
    ]);

    await Promise.all([
      artifacts.putCategoryCountry(categorySlug, countryArtifact),
      artifacts.putCategoryOffers(categorySlug, offersArtifact)
    ]);
    return;
  }

  await Promise.all([
    artifacts.deleteCategoryCountry(categorySlug, countryCode),
    artifacts.deleteCategoryOffers(categorySlug, countryCode)
  ]);
}

export async function materializeDirtyMerchantArtifacts(
  artifacts: ArtifactStore,
  repositories: Repositories,
  merchantSlug: string,
  now: string,
  affectedCategorySlugs: string[],
  affectedCountryCodes: string[],
): Promise<void> {
  const categorySlugs = Array.from(new Set(affectedCategorySlugs.map((value) => value.trim()).filter(Boolean)));
  const countryCodes = Array.from(new Set(affectedCountryCodes.map((value) => value.trim()).filter(Boolean)));

  for (const categorySlug of categorySlugs) {
    const currentArtifact = await repositories.getMerchantArtifactForCategory(merchantSlug, categorySlug, now);

    if (currentArtifact) {
      await artifacts.putCategoryMerchant(categorySlug, currentArtifact);
    } else {
      await artifacts.deleteCategoryMerchant(categorySlug, merchantSlug);
    }

    for (const countryCode of countryCodes) {
      await refreshCategoryCountryArtifacts(artifacts, repositories, categorySlug, countryCode, now);
    }
  }
}

export async function materializeDirectoryArtifacts(
  artifacts: ArtifactStore,
  repositories: Repositories,
  now: string,
  input: SkillArtifactBaseInput
): Promise<void> {
  const categories = await repositories.listCategories();
  await materializeSkillArtifacts(artifacts, categories.filter((category) => category.isPublished !== false), input, now);
}

export async function ensureCategoriesArtifact(
  artifacts: ArtifactStore,
  repositories: Repositories,
  now: string
): Promise<CategoriesArtifact> {
  const cached = await artifacts.getCategories();
  if (cached) {
    return cached;
  }

  const artifact = await buildCategoriesArtifact(repositories, now);
  await artifacts.putCategories(artifact);
  return artifact;
}

export async function ensureCategoryCountryArtifact(
  artifacts: ArtifactStore,
  repositories: Repositories,
  categorySlug: string,
  countryCode: string,
  now: string
): Promise<CountryArtifact> {
  const cached = await artifacts.getCategoryCountry(categorySlug, countryCode);
  if (cached) {
    return cached;
  }

  const artifact = await buildCategoryCountryArtifact(repositories, categorySlug, countryCode, now);
  await artifacts.putCategoryCountry(categorySlug, artifact);
  return artifact;
}

export async function ensureCategoryOffersArtifact(
  artifacts: ArtifactStore,
  repositories: Repositories,
  categorySlug: string,
  countryCode: string,
  now: string
): Promise<OffersArtifact> {
  const cached = await artifacts.getCategoryOffers(categorySlug, countryCode);
  if (cached) {
    return cached;
  }

  const artifact = await buildCategoryOffersArtifact(repositories, categorySlug, countryCode, now);
  await artifacts.putCategoryOffers(categorySlug, artifact);
  return artifact;
}

export async function ensureCategoryMerchantArtifact(
  artifacts: ArtifactStore,
  repositories: Repositories,
  categorySlug: string,
  slug: string,
  now: string
): Promise<MerchantArtifact | null> {
  const cached = await artifacts.getCategoryMerchant(categorySlug, slug);
  if (cached) {
    return cached;
  }

  const merchants = await repositories.listMerchantArtifactsForCategory(categorySlug, now);
  const merchant = merchants.find((entry) => entry.slug === slug) ?? null;
  if (!merchant) {
    return null;
  }

  await artifacts.putCategoryMerchant(categorySlug, merchant);
  return merchant;
}

export async function ensureRootSkillArtifact(
  artifacts: ArtifactStore,
  repositories: Repositories,
  now: string,
  input: SkillArtifactBaseInput
): Promise<string> {
  const cached = await artifacts.getRootSkill();
  if (cached) {
    return cached;
  }

  const categories = await repositories.listCategories();
  const skill = renderRootSkillTemplate(buildRootSkillInput(input, categories.filter((category) => category.isPublished !== false)));
  await artifacts.putRootSkill(skill);
  return skill;
}

export async function ensurePublishedSkillsIndexArtifact(
  artifacts: ArtifactStore
): Promise<PublishedSkillsIndex> {
  const cached = await artifacts.getPublishedSkillsIndex();
  if (cached) {
    return cached;
  }

  const index = buildPublishedSkillsIndex();
  await artifacts.putPublishedSkillsIndex(index);
  return index;
}

export async function ensurePublishedSkillArtifact(
  artifacts: ArtifactStore,
  repositories: Repositories,
  now: string,
  input: SkillArtifactBaseInput
): Promise<string> {
  const cached = await artifacts.getPublishedSkill(ROOT_SKILL_NAME);
  if (cached) {
    return cached;
  }

  const skill = await ensureRootSkillArtifact(artifacts, repositories, now, input);
  await artifacts.putPublishedSkill(ROOT_SKILL_NAME, skill);
  return skill;
}

export async function materializeSkillArtifacts(
  artifacts: ArtifactStore,
  categories: Category[],
  input: SkillArtifactBaseInput,
  now: string
): Promise<void> {
  const rootSkill = renderRootSkillTemplate(buildRootSkillInput(input, categories));
  const publishedSkillsIndex = buildPublishedSkillsIndex();

  await Promise.all([
    artifacts.putCategories({
      generatedAt: now,
      categories: categories.map(buildCategoryDirectoryEntry)
    }),
    artifacts.putRootSkill(rootSkill),
    artifacts.putPublishedSkillsIndex(publishedSkillsIndex),
    artifacts.putPublishedSkill(ROOT_SKILL_NAME, rootSkill)
  ]);
}

export async function materializePublicArtifacts(
  artifacts: ArtifactStore,
  repositories: Repositories,
  now: string,
  input: SkillArtifactBaseInput,
  since?: string
): Promise<void> {
  const categories = await repositories.listCategories();
  await materializeSkillArtifacts(artifacts, categories.filter((category) => category.isPublished !== false), input, now);

  await Promise.all(
    categories.map(async (category) => {
      const [countryCodes, merchants] = await Promise.all([
        repositories.listCountryCodesForCategory(category.slug),
        repositories.listMerchantArtifactsForCategory(category.slug, now, since)
      ]);

      await Promise.all([
        ...countryCodes.flatMap((countryCode) => [
          buildCategoryCountryArtifact(repositories, category.slug, countryCode, now)
            .then((artifact) => artifacts.putCategoryCountry(category.slug, artifact)),
          buildCategoryOffersArtifact(repositories, category.slug, countryCode, now)
            .then((artifact) => artifacts.putCategoryOffers(category.slug, artifact))
        ]),
        ...merchants.map((merchant) => artifacts.putCategoryMerchant(category.slug, merchant))
      ]);
    })
  );
}

export async function materializeMerchantArtifacts(
  artifacts: ArtifactStore,
  repositories: Repositories,
  merchantSlug: string,
  now: string,
  previousMerchant?: Merchant | null
): Promise<void> {
  const currentMerchant = await repositories.getMerchant(merchantSlug);
  const affectedCategories = new Set([
    ...(previousMerchant?.categorySlugs ?? []),
    ...(currentMerchant?.categorySlugs ?? [])
  ]);
  const affectedCountries = new Set([
    ...(previousMerchant?.countryCodes ?? []),
    ...(currentMerchant?.countryCodes ?? [])
  ]);

  await materializeDirtyMerchantArtifacts(
    artifacts,
    repositories,
    merchantSlug,
    now,
    Array.from(affectedCategories),
    Array.from(affectedCountries),
  );
}

export async function materializeOfferArtifacts(
  artifacts: ArtifactStore,
  repositories: Repositories,
  offer: OfferRefreshInput,
  now: string,
  previousOffer?: OfferRefreshInput | null
): Promise<void> {
  const [merchant, previousMerchant] = await Promise.all([
    repositories.getMerchant(offer.merchantSlug),
    previousOffer ? repositories.getMerchant(previousOffer.merchantSlug) : Promise.resolve(null)
  ]);

  const affectedCountries = new Set([
    ...(previousOffer?.countryCodes ?? []),
    ...offer.countryCodes
  ]);
  const affectedCategories = new Set([
    ...(merchant?.categorySlugs ?? []),
    ...(previousMerchant?.categorySlugs ?? [])
  ]);

  await Promise.all(
    Array.from(affectedCategories).map((categorySlug) =>
      Promise.all(
        Array.from(affectedCountries).map((countryCode) =>
          refreshCategoryCountryArtifacts(artifacts, repositories, categorySlug, countryCode, now)
        )
      )
    )
  );
}
