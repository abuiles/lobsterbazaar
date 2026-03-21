import type { DeployPackage } from "./domain";
import type { ArtifactStore, Repositories } from "./storage";
import { materializePublicArtifacts } from "./artifacts";

async function deleteMissingRecords(
  repositories: Repositories,
  deployPackage: DeployPackage
): Promise<void> {
  const [existingCategorySlugs, existingMerchantSlugs, existingClaimIds, existingOfferIds] = await Promise.all([
    repositories.listCategorySlugs(),
    repositories.listMerchantSlugs(),
    repositories.listClaimIds(),
    repositories.listOfferIds()
  ]);

  const categorySlugs = new Set(deployPackage.categories.map((category) => category.slug));
  const merchantSlugs = new Set(deployPackage.merchants.map((merchant) => merchant.slug));
  const claimIds = new Set(deployPackage.claims.map((claim) => claim.claimId));
  const offerIds = new Set(deployPackage.offers.map((offer) => offer.offerId));

  for (const offerId of existingOfferIds) {
    if (!offerIds.has(offerId)) {
      await repositories.deleteOffer(offerId);
    }
  }

  for (const claimId of existingClaimIds) {
    if (!claimIds.has(claimId)) {
      await repositories.deleteClaim(claimId);
    }
  }

  for (const merchantSlug of existingMerchantSlugs) {
    if (!merchantSlugs.has(merchantSlug)) {
      await repositories.deleteMerchant(merchantSlug);
    }
  }

  for (const categorySlug of existingCategorySlugs) {
    if (!categorySlugs.has(categorySlug)) {
      await repositories.deleteCategory(categorySlug);
    }
  }
}

export async function importDeployPackage(
  repositories: Repositories,
  deployPackage: DeployPackage
): Promise<void> {
  await deleteMissingRecords(repositories, deployPackage);

  for (const category of deployPackage.categories) {
    await repositories.putCategory(category);
  }

  for (const merchant of deployPackage.merchants) {
    await repositories.putMerchant(merchant);
  }

  for (const claim of deployPackage.claims) {
    await repositories.putClaim(claim);
  }

  for (const offer of deployPackage.offers) {
    await repositories.putOffer(offer);
  }
}

export async function materializeDeployPackage(
  repositories: Repositories,
  artifacts: ArtifactStore,
  deployPackage: DeployPackage,
  now: string
): Promise<void> {
  await materializePublicArtifacts(artifacts, repositories, now, {
    brandName: deployPackage.config.brandName,
    deployId: deployPackage.config.deployId,
    deployDomain: deployPackage.config.deployDomain,
    directorySummary: deployPackage.config.directorySummary,
    registerPath: "/claws/register"
  });
}
