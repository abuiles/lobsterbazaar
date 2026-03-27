import { createProductionApp } from "./app";
import { WorkflowMaterializationScheduler } from "./materialization-scheduler";
import { type MaterializationWorkflowEnv, LobsterbazaarMaterializationWorkflow } from "./materialization-workflow";

export { LobsterbazaarMaterializationWorkflow };

export default {
  fetch(request: Request, env: MaterializationWorkflowEnv): Promise<Response> {
    return createProductionApp(env, new WorkflowMaterializationScheduler(env.MATERIALIZATION_WORKFLOW)).fetch(request);
  }
};
