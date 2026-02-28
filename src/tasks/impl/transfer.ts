import { TaskRunResult } from "../types";

function pickEnergyTarget(creep: Creep): StructureSpawn | StructureExtension | null {
  const spawn = creep.room.find(FIND_MY_SPAWNS, {
    filter: (s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  })[0];
  if (spawn) return spawn;

  const extension = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_EXTENSION &&
      (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureExtension | null;

  return extension ?? null;
}

export function runTransfer(
  creep: Creep,
  targetId?: string,
): TaskRunResult {
  const target = targetId
    ? (Game.getObjectById(targetId as Id<Structure>) as
        | StructureSpawn
        | StructureExtension
        | null)
    : null;

  const actualTarget = target ?? pickEnergyTarget(creep);
  if (!actualTarget) return { status: "failed", reason: "targetInvalid" };

  const result = creep.transfer(actualTarget, RESOURCE_ENERGY);
  if (result === OK) {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return { status: "completed" };
    return { status: "running" };
  }

  if (result === ERR_NOT_IN_RANGE) {
    const moveResult = creep.moveTo(actualTarget, { reusePath: 10 });
    if (moveResult === ERR_NO_PATH) return { status: "failed", reason: "pathBlocked" };
    return { status: "running" };
  }

  if (result === ERR_NOT_ENOUGH_RESOURCES) return { status: "failed", reason: "notEnoughResources" };
  if (result === ERR_INVALID_TARGET || result === ERR_FULL) return { status: "failed", reason: "targetInvalid" };
  if (result === ERR_NO_PATH) return { status: "failed", reason: "pathBlocked" };
  return { status: "failed", reason: "unknown" };
}
