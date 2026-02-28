import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { runTowers } from "./Tower";
import { smartMove } from "../tasks/move/smartMove";

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) rooms.push(room);
  }
  return rooms;
}

function runDefenders(room: Room): void {
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const keeper = hostiles.find((c) => c.owner?.username === "Source Keeper") ?? null;
  const target = keeper ?? hostiles[0] ?? null;
  const hasTower =
    room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    }).length > 0;

  const defenders = Object.values(Game.creeps).filter(
    (c) => c.memory.role === "defender" && c.memory.homeRoom === room.name,
  );

  for (const creep of defenders) {
    if (keeper && !hasTower) {
      const spawn = room.find(FIND_MY_SPAWNS)[0];
      if (spawn) smartMove(creep, spawn, { reusePath: 20, range: 2 });
      continue;
    }
    if (target) {
      const r = creep.attack(target);
      if (r === ERR_NOT_IN_RANGE) smartMove(creep, target, { reusePath: 10, range: 1 });
      continue;
    }

    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (spawn) smartMove(creep, spawn, { reusePath: 20, range: 2 });
  }
}

function updateDefenseState(room: Room): void {
  const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }) as StructureTower[];
  const towerEnergy = towers.reduce(
    (sum, t) => sum + t.store.getUsedCapacity(RESOURCE_ENERGY),
    0,
  );

  const defenders = Object.values(Game.creeps).filter(
    (c) => c.memory.role === "defender" && c.memory.homeRoom === room.name,
  ).length;

  const canFight =
    (towers.length > 0 && towerEnergy >= 300) ||
    (towers.length === 0 && defenders > 0);

  if (hostiles > 0) room.memory.defenseLastHostile = Game.time;
  room.memory.defense = { hostiles, lastSeen: Game.time, canFight };
}

export class DefenseProcess extends Process {
  public run(): void {
    for (const room of getMyRooms()) {
      updateDefenseState(room);
      runTowers(room);
      runDefenders(room);
    }
  }
}

processRegistry.register(DefenseProcess, "DefenseProcess");
