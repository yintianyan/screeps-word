import { TaskRunResult } from "../types";
import { smartMove } from "../move/smartMove";

export function runWithdraw(
  creep: Creep,
  targetId?: string,
  resource: ResourceConstant = RESOURCE_ENERGY,
): TaskRunResult {
  if (!targetId) return { status: "failed", reason: "targetInvalid" };
  if (creep.store.getFreeCapacity() === 0) return { status: "completed" };

  const target = Game.getObjectById(targetId);
  if (!target) return { status: "failed", reason: "targetInvalid" };
  if (
    !(target instanceof StructureContainer) &&
    !(target instanceof StructureStorage) &&
    !(target instanceof StructureLink) &&
    !(target instanceof Tombstone) &&
    !(target instanceof Ruin)
  )
    return { status: "failed", reason: "targetInvalid" };

  const result = creep.withdraw(target, resource);
  if (result === OK) return { status: "running" };
  if (result === ERR_NOT_IN_RANGE) {
    const moveResult = smartMove(creep, target, { reusePath: 10, range: 1 });
    if (moveResult === ERR_NO_PATH)
      return { status: "failed", reason: "pathBlocked" };
    return { status: "running" };
  }
  if (result === ERR_NOT_ENOUGH_RESOURCES) return { status: "completed" };
  if (result === ERR_INVALID_TARGET) return { status: "failed", reason: "targetInvalid" };
  return { status: "failed", reason: "unknown" };
}
