import { TaskRunResult } from "../types";
import { smartMove } from "../move/smartMove";

/**
 * 执行建造逻辑
 * 
 * @param creep 执行者
 * @param targetId 目标工地 ID
 */
export function runBuild(creep: Creep, targetId?: string): TaskRunResult {
  if (!targetId) return { status: "failed", reason: "targetInvalid" };
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return { status: "completed" };

  const target = Game.getObjectById(targetId);
  if (!target) return { status: "failed", reason: "targetInvalid" };
  if (!(target instanceof ConstructionSite)) return { status: "failed", reason: "targetInvalid" };

  const result = creep.build(target);
  if (result === OK) return { status: "running" };
  if (result === ERR_NOT_IN_RANGE) {
    const moveResult = smartMove(creep, target, { reusePath: 10, range: 3 });
    if (moveResult === ERR_NO_PATH) return { status: "running" };
    return { status: "running" };
  }
  if (result === ERR_NOT_ENOUGH_RESOURCES) return { status: "completed" };
  if (result === ERR_INVALID_TARGET) return { status: "failed", reason: "targetInvalid" };
  return { status: "failed", reason: "unknown" };
}
