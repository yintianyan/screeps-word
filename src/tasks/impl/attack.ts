import { TaskRunResult } from "../types";
import { smartMove } from "../move/smartMove";

export function runAttack(creep: Creep, targetId?: string): TaskRunResult {
  if (!targetId) return { status: "failed", reason: "targetInvalid" };

  const target = Game.getObjectById(targetId as Id<Creep | Structure>);
  if (!target) return { status: "failed", reason: "targetInvalid" };

  const result = creep.attack(target);
  if (result === OK) return { status: "running" };
  if (result === ERR_NOT_IN_RANGE) {
    const moveResult = smartMove(creep, target, { reusePath: 10, range: 1 });
    if (moveResult === ERR_NO_PATH) return { status: "running" };
    return { status: "running" };
  }
  if (result === ERR_INVALID_TARGET) return { status: "failed", reason: "targetInvalid" };
  return { status: "failed", reason: "unknown" };
}
