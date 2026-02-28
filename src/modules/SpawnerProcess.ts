import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { config } from "../config";
import { isSourceKeeperRoom } from "../utils/roomName";

function bodyCost(body: BodyPartConstant[]): number {
  let cost = 0;
  for (const part of body) cost += BODYPART_COST[part];
  return cost;
}

function buildCarryMoveBody(
  energyCapacity: number,
  maxParts = 20,
): BodyPartConstant[] {
  const unit: BodyPartConstant[] = [CARRY, MOVE];
  const unitCost = bodyCost(unit);
  const body: BodyPartConstant[] = [];
  while (
    body.length + unit.length <= maxParts &&
    bodyCost(body) + unitCost <= energyCapacity
  ) {
    body.push(...unit);
  }
  return body.length > 0 ? body : [CARRY, MOVE];
}

function buildWorkerBody(energyCapacity: number): BodyPartConstant[] {
  const unit: BodyPartConstant[] = [WORK, CARRY, MOVE];
  const unitCost = bodyCost(unit);
  const maxParts = 15;

  const body: BodyPartConstant[] = [];
  while (
    body.length + unit.length <= maxParts &&
    bodyCost(body) + unitCost <= energyCapacity
  ) {
    body.push(...unit);
  }

  return body.length > 0 ? body : [WORK, CARRY, MOVE];
}

function buildRemoteHarvesterBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [CARRY, MOVE, MOVE];
  while (
    body.filter((p) => p === WORK).length < 5 &&
    bodyCost(body) + 100 <= energyCapacity
  ) {
    body.unshift(WORK);
  }
  if (
    body.filter((p) => p === WORK).length >= 5 &&
    bodyCost(body) <= energyCapacity
  )
    return body;

  const fallback: BodyPartConstant[] = [WORK, WORK, WORK, CARRY, MOVE, MOVE];
  if (bodyCost(fallback) <= energyCapacity) return fallback;
  return [WORK, CARRY, MOVE];
}

function buildReserverBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  const unit: BodyPartConstant[] = [CLAIM, MOVE];
  while (
    body.length + 2 <= 8 &&
    bodyCost(body) + bodyCost(unit) <= energyCapacity
  ) {
    body.push(...unit);
  }
  return body.length > 0 ? body : [CLAIM, MOVE];
}

function buildDefenderBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  const unit: BodyPartConstant[] = [MOVE, ATTACK];
  while (
    body.length + 2 <= 12 &&
    bodyCost(body) + bodyCost(unit) <= energyCapacity
  ) {
    body.push(...unit);
  }
  return body.length > 0 ? body : [MOVE, ATTACK];
}

function buildKeeperKillerBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  const unit: BodyPartConstant[] = [MOVE, RANGED_ATTACK];
  while (
    body.length + unit.length <= 20 &&
    bodyCost(body) + bodyCost(unit) <= energyCapacity
  ) {
    body.push(...unit);
  }
  if (
    bodyCost(body) + BODYPART_COST[HEAL] <= energyCapacity &&
    body.length + 1 <= 20
  ) {
    body.push(HEAL);
  }
  return body.length > 0 ? body : [MOVE, RANGED_ATTACK];
}

function buildKeeperHealerBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  const unit: BodyPartConstant[] = [MOVE, HEAL];
  while (
    body.length + unit.length <= 12 &&
    bodyCost(body) + bodyCost(unit) <= energyCapacity
  ) {
    body.push(...unit);
  }
  return body.length > 0 ? body : [MOVE, HEAL];
}

function desiredWorkerCount(room: Room): number {
  const rcl = room.controller?.level ?? 0;
  let target = 0;
  
  if (rcl <= 1) target = 6;
  else if (rcl <= 3) target = 8;
  else if (rcl <= 5) target = 6;
  else target = 4;

  const sites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
  if (sites > 0) target += 1;
  if (sites > 5 && rcl >= 4) target += 1;

  if (rcl >= 5) {
    const links = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LINK,
    }).length;
    const distributor = room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "distributor",
    }).length;
    if (links >= 2) target -= 2;
    if (distributor > 0) target -= 1;
  }

  const storageEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  if (room.storage) {
    if (storageEnergy < 2000) target += 1;
    if (rcl >= 5 && storageEnergy > 50000) target -= 1;
  }

  return Math.max(2, target);
}

function countRole(room: Room, role: string): number {
  return room.find(FIND_MY_CREEPS, { filter: (c) => c.memory.role === role })
    .length;
}

function shouldSpawnDefender(room: Room): boolean {
  const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
  const mem = room.memory as RoomMemory & { defenseLastHostile?: number };
  const recent =
    mem.defenseLastHostile != null && Game.time - mem.defenseLastHostile < 50;
  return hostiles > 0 || recent;
}

function hasKeeperHostile(room: Room): boolean {
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  return hostiles.some((c) => c.owner?.username === "Source Keeper");
}

function canFightKeeperInRoom(room: Room): boolean {
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }) as StructureTower[];
  if (towers.length === 0) return false;
  const towerEnergy = towers.reduce(
    (sum, t) => sum + t.store.getUsedCapacity(RESOURCE_ENERGY),
    0,
  );
  return towerEnergy >= 500;
}

function isOffenseBlocked(room: Room): boolean {
  const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
  if (hostiles === 0) return false;
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }) as StructureTower[];
  if (towers.length > 0) return false;
  const defenders = room.find(FIND_MY_CREEPS, {
    filter: (c) => c.memory.role === "defender",
  }).length;
  return defenders === 0;
}

function countAssigned(
  role: string,
  homeRoom: string,
  targetRoom: string,
): number {
  return Object.values(Game.creeps).filter(
    (c) =>
      c.memory.role === role &&
      c.memory.homeRoom === homeRoom &&
      c.memory.targetRoom === targetRoom,
  ).length;
}

function isKeeperSquadReady(homeRoom: string, targetRoom: string): boolean {
  const killers = Object.values(Game.creeps).filter(
    (c) =>
      c.memory.role === "keeperKiller" &&
      c.memory.homeRoom === homeRoom &&
      c.memory.targetRoom === targetRoom &&
      c.room.name === targetRoom,
  ).length;
  const healers = Object.values(Game.creeps).filter(
    (c) =>
      c.memory.role === "keeperHealer" &&
      c.memory.homeRoom === homeRoom &&
      c.memory.targetRoom === targetRoom &&
      c.room.name === targetRoom,
  ).length;
  return (
    killers >= config.REMOTE_MINING.KEEPER_SQUAD.KILLERS &&
    healers >= config.REMOTE_MINING.KEEPER_SQUAD.HEALERS
  );
}

function getRemoteTargets(room: Room): string[] {
  return room.memory.remotes ?? [];
}

function canRunSkRemote(home: Room): boolean {
  const rcl = home.controller?.level ?? 0;
  if (rcl < config.REMOTE_MINING.SK_MIN_RCL) return false;
  const energy = home.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  if (energy < config.REMOTE_MINING.SK_MIN_STORAGE_ENERGY) return false;
  return true;
}

function getAllowedRemoteTargets(room: Room): string[] {
  const remotes = getRemoteTargets(room);
  if (remotes.length === 0) return remotes;
  return remotes.filter((r) => {
    if (isSourceKeeperRoom(r) && !canRunSkRemote(room)) return false;
    const hasKeeper = room.memory.remote?.[r]?.threat?.hasKeeper ?? false;
    if (hasKeeper && !isKeeperSquadReady(room.name, r)) return false;
    return true;
  });
}

export class SpawnerProcess extends Process {
  public run(): void {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller?.my) continue;

      const creeps = room.find(FIND_MY_CREEPS);
      const workerCount = creeps.filter((c) => c.memory.role === "worker").length;
      const spawns = room.find(FIND_MY_SPAWNS);
      const spawn = spawns.find((s) => !s.spawning);
      if (!spawn) continue;

      if (creeps.length < 2) {
        const body = [WORK, CARRY, MOVE];
        if (room.energyAvailable < bodyCost(body)) continue;
        const name = `W_${room.name}_${Game.time}`;
        spawn.spawnCreep(body, name, {
          memory: { role: "worker", room: room.name, working: false },
        });
        continue;
      }

      if (hasKeeperHostile(room) && !canFightKeeperInRoom(room)) {
        continue;
      }

      if (shouldSpawnDefender(room)) {
        const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
        const desiredDefenders =
          hostiles > 0 ? Math.min(3, Math.max(1, hostiles)) : 1;
        if (countRole(room, "defender") < desiredDefenders) {
          const body = buildDefenderBody(room.energyCapacityAvailable);
          const cost = bodyCost(body);
          if (room.energyAvailable < cost) continue;
          const name = `D_${room.name}_${Game.time}`;
          spawn.spawnCreep(body, name, {
            memory: {
              role: "defender",
              room: room.name,
              working: false,
              homeRoom: room.name,
            },
          });
          continue;
        }
      }

      if (
        room.controller.level >= 4 &&
        room.storage &&
        countRole(room, "distributor") < 1
      ) {
        const body = buildCarryMoveBody(room.energyCapacityAvailable);
        const cost = bodyCost(body);
        if (room.energyAvailable < cost) continue;
        const name = `DI_${room.name}_${Game.time}`;
        spawn.spawnCreep(body, name, {
          memory: {
            role: "distributor",
            room: room.name,
            working: false,
            homeRoom: room.name,
          },
        });
        continue;
      }

      const scoutTarget =
        room.memory.scout?.status === "active" ? room.memory.scout.targetRoom : undefined;
      if (scoutTarget && countRole(room, "scout") < 1) {
        const body: BodyPartConstant[] = [MOVE];
        const cost = bodyCost(body);
        if (room.energyAvailable < cost) continue;
        const name = `S_${room.name}_${Game.time}`;
        spawn.spawnCreep(body, name, {
          memory: {
            role: "scout",
            room: room.name,
            working: false,
            homeRoom: room.name,
            targetRoom: scoutTarget,
          },
        });
        continue;
      }

      if (!isOffenseBlocked(room)) {
        const remotesAll = getRemoteTargets(room);
        const needsKeeperSquad = remotesAll.find(
          (r) => room.memory.remote?.[r]?.threat?.hasKeeper,
        );
        if (
          needsKeeperSquad &&
          canRunSkRemote(room) &&
          !isKeeperSquadReady(room.name, needsKeeperSquad)
        ) {
           const killers = countAssigned("keeperKiller", room.name, needsKeeperSquad);
           const healers = countAssigned("keeperHealer", room.name, needsKeeperSquad);
           
           if (killers < config.REMOTE_MINING.KEEPER_SQUAD.KILLERS) {
              const body = buildKeeperKillerBody(room.energyCapacityAvailable);
              if (room.energyAvailable >= bodyCost(body)) {
                 spawn.spawnCreep(body, `KK_${room.name}_${Game.time}`, {
                    memory: { role: "keeperKiller", room: room.name, working: false, homeRoom: room.name, targetRoom: needsKeeperSquad }
                 });
              }
              continue;
           }
           if (healers < config.REMOTE_MINING.KEEPER_SQUAD.HEALERS) {
              const body = buildKeeperHealerBody(room.energyCapacityAvailable);
              if (room.energyAvailable >= bodyCost(body)) {
                 spawn.spawnCreep(body, `KH_${room.name}_${Game.time}`, {
                    memory: { role: "keeperHealer", room: room.name, working: false, homeRoom: room.name, targetRoom: needsKeeperSquad }
                 });
              }
              continue;
           }
        }
        
        const remotes = getAllowedRemoteTargets(room);
        let spawnedRemote = false;
        
        for (const remote of remotes) {
           if (room.controller.level >= 3) {
              const reservers = countAssigned("reserver", room.name, remote);
              if (reservers < 1) {
                 const body = buildReserverBody(room.energyCapacityAvailable);
                 if (room.energyAvailable >= bodyCost(body)) {
                    spawn.spawnCreep(body, `R_${room.name}_${Game.time}`, {
                       memory: { role: "reserver", room: room.name, working: false, homeRoom: room.name, targetRoom: remote }
                    });
                    spawnedRemote = true;
                    break;
                 }
              }
           }
           
           const harvesters = countAssigned("remoteHarvester", room.name, remote);
           const sourceCount = room.memory.remote?.[remote]?.stats?.sourceCount ?? 1;
           if (harvesters < sourceCount) {
              const body = buildRemoteHarvesterBody(room.energyCapacityAvailable);
              if (room.energyAvailable >= bodyCost(body)) {
                 spawn.spawnCreep(body, `RH_${room.name}_${Game.time}`, {
                    memory: { role: "remoteHarvester", room: room.name, working: false, homeRoom: room.name, targetRoom: remote }
                 });
                 spawnedRemote = true;
                 break;
              }
           }
           
           const haulers = countAssigned("remoteHauler", room.name, remote);
           const stats = room.memory.remote?.[remote]?.stats;
           let desiredHaulers = 1;
           if (stats && stats.neededCarryParts > 0) {
              const sampleBody = buildCarryMoveBody(room.energyCapacityAvailable);
              const carryParts = sampleBody.filter(p => p === CARRY).length;
              if (carryParts > 0) {
                 desiredHaulers = Math.ceil(stats.neededCarryParts / carryParts);
              }
           }
           desiredHaulers = Math.min(desiredHaulers, 5); 
           
           if (haulers < desiredHaulers) {
               const body = buildCarryMoveBody(room.energyCapacityAvailable);
               if (room.energyAvailable >= bodyCost(body)) {
                  spawn.spawnCreep(body, `RHl_${room.name}_${Game.time}`, {
                     memory: { role: "remoteHauler", room: room.name, working: false, homeRoom: room.name, targetRoom: remote, hauling: false }
                  });
                  spawnedRemote = true;
                  break;
               }
           }
        }
        
        if (spawnedRemote) continue;
      }

      const target = desiredWorkerCount(room);
      if (workerCount >= target) continue;
      const body = buildWorkerBody(room.energyCapacityAvailable);
      const cost = bodyCost(body);
      if (room.energyAvailable < cost) continue;

      const name = `W_${room.name}_${Game.time}`;
      spawn.spawnCreep(body, name, {
        memory: { role: "worker", room: room.name, working: false },
      });
    }
  }
}

processRegistry.register(SpawnerProcess, "SpawnerProcess");
