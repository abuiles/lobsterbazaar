import type { MaterializationTarget, MaterializationTargetStatus, MaterializationTargetType } from "./storage";

export const MATERIALIZATION_QUIET_WINDOW_MS = 2 * 60 * 1000;
export const MATERIALIZATION_MAX_WINDOW_MS = 5 * 60 * 1000;

export interface MaterializationMetadata {
  targetType: MaterializationTargetType;
  targetKey: string;
  status: MaterializationTargetStatus;
  desiredGeneration: number;
  processedGeneration: number;
  firstDirtyAt: string | null;
  lastDirtyAt: string | null;
}

export function buildMaterializationMetadata(target: MaterializationTarget): MaterializationMetadata {
  return {
    targetType: target.targetType,
    targetKey: target.targetKey,
    status: target.status,
    desiredGeneration: target.desiredGeneration,
    processedGeneration: target.processedGeneration,
    firstDirtyAt: target.firstDirtyAt,
    lastDirtyAt: target.lastDirtyAt,
  };
}

export function buildMaterializationWorkflowInstanceId(targetType: MaterializationTargetType, targetKey: string, generation: number): string {
  return `materialize-${targetType}-${targetKey}-${generation}`.slice(0, 100);
}

export function getMaterializationTargetKeyForMerchant(merchantSlug: string): string {
  return merchantSlug.trim();
}

export function getMaterializationTargetKeyForDirectory(): string {
  return "root";
}

export function getMaterializationDebounceDelayMs(target: Pick<MaterializationTarget, "firstDirtyAt" | "lastDirtyAt">, now: string): number {
  const firstDirtyAt = target.firstDirtyAt ? Date.parse(target.firstDirtyAt) : NaN;
  const lastDirtyAt = target.lastDirtyAt ? Date.parse(target.lastDirtyAt) : NaN;
  const nowMs = Date.parse(now);

  if (!Number.isFinite(nowMs)) {
    return 0;
  }

  const quietRemaining = Number.isFinite(lastDirtyAt)
    ? Math.max(0, (lastDirtyAt + MATERIALIZATION_QUIET_WINDOW_MS) - nowMs)
    : 0;
  const maxRemaining = Number.isFinite(firstDirtyAt)
    ? Math.max(0, (firstDirtyAt + MATERIALIZATION_MAX_WINDOW_MS) - nowMs)
    : 0;

  if (quietRemaining === 0 || maxRemaining === 0) {
    return 0;
  }

  return Math.min(quietRemaining, maxRemaining);
}
