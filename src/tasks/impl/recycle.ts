import { TaskRunResult } from "../types";
import { smartMove } from "../move/smartMove";

export function runRecycle(creep: Creep, targetId?: string): TaskRunResult {
  const target =
    typeof targetId === "string" ? Game.getObjectById(targetId) : null;

  const spawn =
    target instanceof StructureSpawn
      ? target
      : creep.room.find(FIND_MY_SPAWNS)[0];

  if (!spawn) return { status: "failed", reason: "targetInvalid" };

  const result = spawn.recycleCreep(creep);
  if (result === OK) return { status: "completed" };
  if (result === ERR_NOT_IN_RANGE) {
    const moveResult = smartMove(creep, spawn, { reusePath: 10, range: 1 });
    if (moveResult === ERR_NO_PATH) return { status: "running" };
    return { status: "running" };
  }
  if (result === ERR_BUSY) return { status: "running" };
  if (result === ERR_NOT_OWNER) return { status: "failed", reason: "targetInvalid" };
  return { status: "failed", reason: "unknown" };
}

