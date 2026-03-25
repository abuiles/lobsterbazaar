import type {
  CategoriesArtifact,
  Category,
  CategoryDirectoryEntry,
  CountryArtifact,
  MerchantArtifact,
  OffersArtifact,
  RootSkillTemplateInput
} from "./domain";
import type { ArtifactStore, Repositories } from "./storage";
import { renderRootSkillTemplate } from "./skill";

interface SkillArtifactBaseInput {
  brandName: string;
  deployId: string;
  deployDomain: string;
  directorySummary: string;
  registerPath: string;
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

async function buildCategoriesArtifact(
  repositories: Repositories,
  now: string
): Promise<CategoriesArtifact> {
  const categories = await repositories.listCategories();
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
  const skill = renderRootSkillTemplate(buildRootSkillInput(input, categories));
  await artifacts.putRootSkill(skill);
  return skill;
}

export async function materializeSkillArtifacts(
  artifacts: ArtifactStore,
  categories: Category[],
  input: SkillArtifactBaseInput,
  now: string
): Promise<void> {
  await Promise.all([
    artifacts.putCategories({
      generatedAt: now,
      categories: categories.map(buildCategoryDirectoryEntry)
    }),
    artifacts.putRootSkill(renderRootSkillTemplate(buildRootSkillInput(input, categories)))
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
  await materializeSkillArtifacts(artifacts, categories, input, now);

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
