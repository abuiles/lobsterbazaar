import type { DeployPackage } from "./domain";
import type { ArtifactStore, Repositories } from "./storage";
import { materializePublicArtifacts } from "./artifacts";

async function deleteMissingRecords(
  repositories: Repositories,
  deployPackage: DeployPackage
): Promise<void> {
  const [existingMerchantSlugs, existingClaimIds, existingOfferIds] = await Promise.all([
    repositories.listMerchantSlugs(),
    repositories.listClaimIds(),
    repositories.listOfferIds()
  ]);

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
}

export async function importDeployPackage(
  repositories: Repositories,
  deployPackage: DeployPackage
): Promise<void> {
  await deleteMissingRecords(repositories, deployPackage);

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
    verticalSummary: deployPackage.config.verticalSummary,
    skillBuyingTargets: deployPackage.config.skillBuyingTargets,
    registerPath: "/claws/register",
    countriesPath: "/countries",
    offersPath: "/offers",
    merchantConnectPath: "/merchants/{slug}/connect"
  });
}
