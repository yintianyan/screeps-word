import { TaskRunResult } from "../types";
import { smartMove } from "../move/smartMove";

/**
 * 执行升级逻辑
 * 
 * @param creep 执行者
 */
export function runUpgrade(creep: Creep): TaskRunResult {
  const controller = creep.room.controller;
  if (!controller || !controller.my)
    return { status: "failed", reason: "targetInvalid" };
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0)
    return { status: "completed" };

  const result = creep.upgradeController(controller);
  if (result === OK) return { status: "running" };
  if (result === ERR_NOT_IN_RANGE) {
    const moveResult = smartMove(creep, controller, { reusePath: 10, range: 3 });
    if (moveResult === ERR_NO_PATH)
      return { status: "failed", reason: "pathBlocked" };
    return { status: "running" };
  }
  if (result === ERR_NOT_ENOUGH_RESOURCES) return { status: "completed" };
  if (result === ERR_INVALID_TARGET)
    return { status: "failed", reason: "targetInvalid" };
  return { status: "failed", reason: "unknown" };
}
