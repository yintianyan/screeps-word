import { TaskRunResult } from "../types";
import { smartMove } from "../move/smartMove";

export function runRepair(creep: Creep, targetId?: string): TaskRunResult {
  if (!targetId) return { status: "failed", reason: "targetInvalid" };
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return { status: "completed" };

  const target = Game.getObjectById(targetId as Id<Structure>);
  if (!target) return { status: "failed", reason: "targetInvalid" };
  if (!(target instanceof Structure)) return { status: "failed", reason: "targetInvalid" };
  if (target.hits === target.hitsMax) return { status: "completed" };

  const result = creep.repair(target);
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
