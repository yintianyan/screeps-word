import { TaskRunResult } from "../types";
import { smartMove } from "../move/smartMove";

/**
 * 执行采集逻辑
 * 
 * @param creep 执行者
 * @param targetId 目标 Source ID (可选，如果为空则自动寻找最近的)
 */
export function runHarvest(creep: Creep, targetId?: string): TaskRunResult {
  const target = targetId ? Game.getObjectById<Source>(targetId as Id<Source>) : null;
  const source = target ?? creep.pos.findClosestByRange(FIND_SOURCES);
  if (!source) return { status: "failed", reason: "targetInvalid" };

  const result = creep.harvest(source);
  if (result === OK) {
    if (creep.store.getFreeCapacity() === 0) return { status: "completed" };
    return { status: "running" };
  }

  if (result === ERR_NOT_IN_RANGE) {
    const moveResult = smartMove(creep, source, { range: 1, reusePath: 10 });
    if (moveResult === ERR_NO_PATH) return { status: "running" };
    return { status: "running" };
  }

  if (result === ERR_NOT_ENOUGH_RESOURCES) return { status: "failed", reason: "notEnoughResources" };
  if (result === ERR_INVALID_TARGET) return { status: "failed", reason: "targetInvalid" };
  return { status: "failed", reason: "unknown" };
}
