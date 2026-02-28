import { TaskRunResult } from "../types";
import { smartMove } from "../move/smartMove";

type TransferTarget =
  | StructureSpawn
  | StructureExtension
  | StructureTower
  | StructureStorage
  | StructureContainer
  | StructureLink;

function pickEnergyTarget(creep: Creep): TransferTarget | null {
  const spawn = creep.room.find(FIND_MY_SPAWNS, {
    filter: (s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  })[0];
  if (spawn) return spawn;

  const tower = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_TOWER &&
      (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureTower | null;
  if (tower) return tower;

  const extension = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_EXTENSION &&
      (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureExtension | null;

  if (extension) return extension;

  const storage = creep.room.storage;
  if (storage) return storage;

  return null;
}

export function runTransfer(
  creep: Creep,
  targetId?: string,
): TaskRunResult {
  const target = targetId ? (Game.getObjectById(targetId as Id<Structure>) as unknown) : null;
  const typedTarget =
    target instanceof StructureSpawn ||
    target instanceof StructureExtension ||
    target instanceof StructureTower ||
    target instanceof StructureStorage ||
    target instanceof StructureContainer ||
    target instanceof StructureLink
      ? target
      : null;

  const actualTarget = typedTarget ?? pickEnergyTarget(creep);
  if (!actualTarget) return { status: "failed", reason: "targetInvalid" };

  const result = creep.transfer(actualTarget, RESOURCE_ENERGY);
  if (result === OK) {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return { status: "completed" };
    return { status: "running" };
  }

  if (result === ERR_NOT_IN_RANGE) {
    const moveResult = smartMove(creep, actualTarget, { reusePath: 10, range: 1 });
    if (moveResult === ERR_NO_PATH) return { status: "failed", reason: "pathBlocked" };
    return { status: "running" };
  }

  if (result === ERR_NOT_ENOUGH_RESOURCES) return { status: "failed", reason: "notEnoughResources" };
  if (result === ERR_INVALID_TARGET || result === ERR_FULL) return { status: "failed", reason: "targetInvalid" };
  if (result === ERR_NO_PATH) return { status: "failed", reason: "pathBlocked" };
  return { status: "failed", reason: "unknown" };
}
