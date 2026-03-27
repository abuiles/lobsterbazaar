import type { MaterializationTarget, MaterializationTargetType } from "./storage";
import { buildMaterializationWorkflowInstanceId } from "./materialization";

export interface MaterializationWorkflowParams {
  targetType: MaterializationTargetType;
  targetKey: string;
}

export interface MaterializationScheduler {
  scheduleTarget(target: MaterializationTarget): Promise<void>;
}

function isWorkflowAlreadyActive(error: unknown): boolean {
  return error instanceof Error && /already used/i.test(error.message);
}

export class NoopMaterializationScheduler implements MaterializationScheduler {
  async scheduleTarget(): Promise<void> {}
}

export class WorkflowMaterializationScheduler implements MaterializationScheduler {
  constructor(private readonly workflow: Workflow<MaterializationWorkflowParams>) {}

  async scheduleTarget(target: MaterializationTarget): Promise<void> {
    const instanceId = target.workflowInstanceId
      ?? buildMaterializationWorkflowInstanceId(target.targetType, target.targetKey, target.desiredGeneration);

    try {
      await this.workflow.create({
        id: instanceId,
        params: {
          targetType: target.targetType,
          targetKey: target.targetKey,
        },
      });
    } catch (error) {
      if (!isWorkflowAlreadyActive(error)) {
        throw error;
      }
    }
  }
}
