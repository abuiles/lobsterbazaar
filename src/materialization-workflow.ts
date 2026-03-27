import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { materializeDirectoryArtifacts, materializeDirtyMerchantArtifacts } from "./artifacts";
import { readDeployConfig, type Env as ConfigEnv } from "./config";
import {
  getMaterializationDebounceDelayMs,
} from "./materialization";
import { R2ArtifactStore } from "./r2";
import { D1Repositories } from "./d1";
import type { MaterializationTargetType } from "./storage";
import type { MaterializationWorkflowParams } from "./materialization-scheduler";

function buildSkillArtifactInput(config: ReturnType<typeof readDeployConfig>) {
  return {
    brandName: config.brandName,
    deployId: config.deployId,
    deployDomain: config.deployDomain,
    directorySummary: config.verticalSummary,
    categoriesPath: "/categories",
    registerPath: "/claws/register",
  };
}

export interface MaterializationWorkflowEnv extends ConfigEnv {
  MATERIALIZATION_WORKFLOW: Workflow<MaterializationWorkflowParams>;
}

async function materializeTarget(env: MaterializationWorkflowEnv, params: MaterializationWorkflowParams, now: string): Promise<void> {
  const repositories = new D1Repositories(env.DB);
  const artifacts = new R2ArtifactStore(env.ARTIFACTS);
  const config = readDeployConfig(env);
  const target = await repositories.getMaterializationTarget(params.targetType, params.targetKey);

  if (!target) {
    return;
  }

  if (params.targetType === "directory") {
    await materializeDirectoryArtifacts(artifacts, repositories, now, buildSkillArtifactInput(config));
    return;
  }

  await materializeDirtyMerchantArtifacts(
    artifacts,
    repositories,
    params.targetKey,
    now,
    target.affectedCategorySlugs,
    target.affectedCountryCodes,
  );
}

export class LobsterbazaarMaterializationWorkflow extends WorkflowEntrypoint<MaterializationWorkflowEnv, MaterializationWorkflowParams> {
  override async run(event: WorkflowEvent<MaterializationWorkflowParams>, step: WorkflowStep) {
    const repositories = new D1Repositories(this.env.DB);

    for (let cycle = 0; cycle < 25; cycle += 1) {
      const target = await step.do(`load-target-${cycle}`, async () => {
        return repositories.getMaterializationTarget(event.payload.targetType, event.payload.targetKey);
      });

      if (!target) {
        return { ok: true, status: "missing" };
      }

      if (target.processedGeneration >= target.desiredGeneration) {
        return { ok: true, status: "ready", generation: target.processedGeneration };
      }

      const now = new Date().toISOString();
      const delayMs = getMaterializationDebounceDelayMs(target, now);
      if (delayMs > 0) {
        await step.sleep(`debounce-${cycle}`, delayMs);
        continue;
      }

      const runningTarget = await step.do(`mark-running-${cycle}`, async () => {
        return repositories.markMaterializationTargetRunning(event.payload.targetType, event.payload.targetKey, new Date().toISOString());
      });
      const targetGeneration = runningTarget?.desiredGeneration ?? target.desiredGeneration;

      try {
        await step.do(
          `materialize-${cycle}`,
          { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" } },
          async () => {
            await materializeTarget(this.env, event.payload, new Date().toISOString());
            return { generation: targetGeneration };
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Materialization failed.";
        await step.do(`mark-failed-${cycle}`, async () => {
          return repositories.markMaterializationTargetFailed(
            event.payload.targetType,
            event.payload.targetKey,
            message,
            new Date().toISOString(),
          );
        });
        throw error;
      }

      const completedTarget = await step.do(`mark-ready-${cycle}`, async () => {
        return repositories.markMaterializationTargetReady(
          event.payload.targetType,
          event.payload.targetKey,
          targetGeneration,
          new Date().toISOString(),
        );
      });

      if (!completedTarget || completedTarget.processedGeneration >= completedTarget.desiredGeneration) {
        return { ok: true, status: "ready", generation: targetGeneration };
      }
    }

    throw new Error("Materialization workflow exceeded the maximum debounce cycles.");
  }
}
