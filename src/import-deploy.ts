import type { DeployPackage } from "./domain";
import type { ArtifactStore, Repositories } from "./storage";
import { materializePublicArtifacts } from "./artifacts";

export async function importDeployPackage(
  repositories: Repositories,
  deployPackage: DeployPackage
): Promise<void> {
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
    registerPath: "/claws/register",
    countriesPath: "/countries",
    offersPath: "/offers",
    merchantConnectPath: "/merchants/{slug}/connect"
  });
}
