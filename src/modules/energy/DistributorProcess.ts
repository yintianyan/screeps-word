import { Process } from "../../core/Process";
import { processRegistry } from "../../core/ProcessRegistry";
import { runTransfer } from "../../tasks/impl/transfer";
import { runWithdraw } from "../../tasks/impl/withdraw";

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) rooms.push(room);
  }
  return rooms;
}

function getCreeps(room: Room): Creep[] {
  return Object.values(Game.creeps).filter(
    (c) => c.memory.role === "distributor" && c.memory.homeRoom === room.name,
  );
}

function getLink(room: Room, key: "hub" | "controller"): StructureLink | null {
  const id = room.memory.links?.[key];
  if (!id) return null;
  const obj = Game.getObjectById(id as Id<StructureLink>);
  return obj instanceof StructureLink ? obj : null;
}

function pickFillTarget(room: Room): Id<Structure> | null {
  const spawn = room.find(FIND_MY_SPAWNS, {
    filter: (s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  })[0];
  if (spawn) return spawn.id;

  const tower = room.find(FIND_MY_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_TOWER &&
      (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  })[0] as StructureTower | undefined;
  if (tower) return tower.id;

  const extension = room.find(FIND_MY_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_EXTENSION &&
      (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  })[0] as StructureExtension | undefined;
  if (extension) return extension.id;

  return null;
}

function runDistributor(creep: Creep, room: Room): void {
  if (creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0)
    creep.memory.working = false;
  if (
    !creep.memory.working &&
    creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
  )
    creep.memory.working = true;

  const hub = getLink(room, "hub");
  const controller = getLink(room, "controller");
  const storage = room.storage;

  if (creep.memory.working) {
    const fillTarget = pickFillTarget(room);
    if (fillTarget) {
      runTransfer(creep, fillTarget);
      return;
    }

    if (storage) {
      runTransfer(creep, storage.id);
      return;
    }

    if (hub) {
      runTransfer(creep, hub.id);
      return;
    }
    return;
  }

  if (
    storage &&
    hub &&
    controller &&
    controller.store.getUsedCapacity(RESOURCE_ENERGY) < 200 &&
    hub.store.getUsedCapacity(RESOURCE_ENERGY) < 200 &&
    storage.store.getUsedCapacity(RESOURCE_ENERGY) > 5000
  ) {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      runWithdraw(creep, storage.id);
      return;
    }
    runTransfer(creep, hub.id);
    return;
  }

  if (hub && hub.store.getUsedCapacity(RESOURCE_ENERGY) >= 600) {
    runWithdraw(creep, hub.id);
    return;
  }

  if (storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    runWithdraw(creep, storage.id);
    return;
  }
}

export class DistributorProcess extends Process {
  public run(): void {
    for (const room of getMyRooms()) {
      const creeps = getCreeps(room);
      for (const creep of creeps) runDistributor(creep, room);
    }
  }
}

processRegistry.register(DistributorProcess, "DistributorProcess");
