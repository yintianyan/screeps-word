import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { config } from "../config";
import { isSourceKeeperRoom } from "../utils/roomName";
import { HarvestTask } from "../tasks/HarvestTask";
import { TransferTask } from "../tasks/TransferTask";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { PickupTask } from "../tasks/PickupTask";
import { BuildTask } from "../tasks/BuildTask";
import { RepairTask } from "../tasks/RepairTask";
import { AttackTask } from "../tasks/AttackTask";
import { RangedAttackTask } from "../tasks/RangedAttackTask";
import { HealTask } from "../tasks/HealTask";
import { ClaimTask } from "../tasks/ClaimTask";
import { MoveTask } from "../tasks/MoveTask";
import { smartMove } from "../tasks/move/smartMove";

type HomeRemotePair = { home: Room; remoteName: string };
type SourcePlan = {
  containerPos?: { x: number; y: number };
  containerId?: string;
  lastPlan?: number;
};

function canRunSkRemote(home: Room): boolean {
  const rcl = home.controller?.level ?? 0;
  if (rcl < config.REMOTE_MINING.SK_MIN_RCL) return false;
  const energy = home.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  if (energy < config.REMOTE_MINING.SK_MIN_STORAGE_ENERGY) return false;
  return true;
}

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) rooms.push(room);
  }
  return rooms;
}

function getPairs(): HomeRemotePair[] {
  const pairs: HomeRemotePair[] = [];
  for (const home of getMyRooms()) {
    const remotes = home.memory.remotes ?? [];
    for (const remoteName of remotes) pairs.push({ home, remoteName });
  }
  return pairs;
}

function desiredRemoteCount(home: Room): number {
  const rcl = home.controller?.level ?? 0;
  if (rcl < 4) return 0;
  if (rcl === 4) return 1;
  if (rcl === 5) return 2;
  return 3;
}

function isRoomName(roomName: string | undefined): roomName is string {
  return typeof roomName === "string" && roomName.length > 0;
}

function getNeighborRooms(homeRoomName: string): string[] {
  const exits = Game.map.describeExits(homeRoomName);
  if (!exits) return [];
  const out: string[] = [];
  for (const k in exits) {
    const name = (exits as Record<string, string | undefined>)[k];
    if (isRoomName(name)) out.push(name);
  }
  return Array.from(new Set(out));
}

function evaluateRemote(home: Room, remote: Room): boolean {
  if (Game.map.getRoomLinearDistance(home.name, remote.name) > 1) return false;
  const sources = remote.find(FIND_SOURCES);
  if (sources.length < 2) return false;

  const controller = remote.controller;
  if (controller?.owner) return false;
  if (
    controller?.reservation &&
    controller.reservation.username !== "Invader" &&
    controller.reservation.username !== home.controller?.owner?.username
  )
    return false;

  const invaderCore = remote.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_INVADER_CORE,
  });
  if (invaderCore.length > 0) return false;

  const hostiles = remote.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length > 0) return false;
  return true;
}

function ensureScoutState(room: Room): NonNullable<RoomMemory["scout"]> {
  if (!room.memory.scout) room.memory.scout = { lastScan: 0, status: "pending" };
  return room.memory.scout;
}

function runRemoteDiscovery(home: Room): void {
  const target = desiredRemoteCount(home);
  if (target <= 0) return;

  if (!home.memory.remotes) home.memory.remotes = [];
  if (home.memory.remotes.length >= target) return;

  const scout = ensureScoutState(home);
  if (scout.status === "active" && scout.targetRoom) return;
  if (Game.time - scout.lastScan < 250) return;

  scout.lastScan = Game.time;
  scout.status = "pending";
  delete scout.targetRoom;

  const neighbors = getNeighborRooms(home.name);
  const unseen: string[] = [];

  for (const name of neighbors) {
    if (home.memory.remotes.includes(name)) continue;
    const visible = Game.rooms[name];
    if (visible) {
      if (evaluateRemote(home, visible)) {
        home.memory.remotes.push(name);
        if (home.memory.remotes.length >= target) return;
      }
      continue;
    }
    unseen.push(name);
  }

  if (home.memory.remotes.length < target && unseen.length > 0) {
    scout.status = "active";
    scout.targetRoom = unseen[0];
  } else {
    scout.status = "completed";
  }
}

function ensureRemoteEntry(
  home: Room,
  remoteName: string,
): NonNullable<RoomMemory["remote"]>[string] {
  if (!home.memory.remote) home.memory.remote = {};
  if (!home.memory.remote[remoteName]) home.memory.remote[remoteName] = {};
  return home.memory.remote[remoteName];
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

function isRemoteSafe(home: Room, remoteName: string): boolean {
  if (isSourceKeeperRoom(remoteName) && !canRunSkRemote(home)) return false;
  const entry = home.memory.remote?.[remoteName];
  const threat = entry?.threat;
  if (!threat) return true;
  if (Game.time - threat.lastSeen > 1500) return true;
  if (threat.hasKeeper && !isKeeperSquadReady(home.name, remoteName))
    return false;
  return threat.hostiles === 0;
}

function updateThreat(home: Room, remoteName: string): void {
  const remote = Game.rooms[remoteName];
  if (!remote) return;
  const hostiles = remote.find(FIND_HOSTILE_CREEPS);
  const hasKeeper =
    hostiles.some((c) => c.owner?.username === "Source Keeper") ||
    remote.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_KEEPER_LAIR,
    }).length > 0;
  const entry = ensureRemoteEntry(home, remoteName);
  entry.threat = {
    level: hostiles.length > 0 ? 1 : 0,
    lastSeen: Game.time,
    hostiles: hostiles.length,
    hasKeeper,
  };
}

function isInsideRoom(x: number, y: number): boolean {
  return x >= 2 && x <= 47 && y >= 2 && y <= 47;
}

function pickContainerPosForSource(
  room: Room,
  source: Source,
): { x: number; y: number } | null {
  const terrain = room.getTerrain();
  let best: { x: number; y: number } | null = null;
  let bestScore = -999999;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = source.pos.x + dx;
      const y = source.pos.y + dy;
      if (!isInsideRoom(x, y)) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

      const pos = new RoomPosition(x, y, room.name);
      const structures = pos.lookFor(LOOK_STRUCTURES);
      if (structures.some((s) => s.structureType !== STRUCTURE_ROAD)) continue;
      const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
      if (sites.length > 0) continue;

      const score = -Math.abs(x - 25) - Math.abs(y - 25);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }

  return best;
}

function getContainerAt(
  room: Room,
  x: number,
  y: number,
): StructureContainer | null {
  const pos = new RoomPosition(x, y, room.name);
  const structures = pos.lookFor(LOOK_STRUCTURES);
  for (const s of structures) {
    if (s.structureType === STRUCTURE_CONTAINER) return s as StructureContainer;
  }
  return null;
}

function getContainerSiteAt(
  room: Room,
  x: number,
  y: number,
): ConstructionSite | null {
  const pos = new RoomPosition(x, y, room.name);
  const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  for (const s of sites) {
    if (s.structureType === STRUCTURE_CONTAINER) return s;
  }
  return null;
}

function planRemoteStaticHarvesting(home: Room, remoteName: string): void {
  const remote = Game.rooms[remoteName];
  if (!remote) return;
  if (!isRemoteSafe(home, remoteName)) return;

  const entry = ensureRemoteEntry(home, remoteName);
  if (!entry.sources) entry.sources = {};

  const sources = remote.find(FIND_SOURCES);
  for (const source of sources) {
    const key = source.id;
    const plan = (entry.sources[key] ?? {}) as SourcePlan;
    entry.sources[key] = plan as never;

    if (plan.lastPlan != null && Game.time - plan.lastPlan < 200) continue;
    plan.lastPlan = Game.time;

    if (!plan.containerPos) {
      const p = pickContainerPosForSource(remote, source);
      if (!p) continue;
      plan.containerPos = p;
    }

    const cp = plan.containerPos;
    const existing = getContainerAt(remote, cp.x, cp.y);
    if (existing) {
      plan.containerId = existing.id;
      continue;
    }

    const site = getContainerSiteAt(remote, cp.x, cp.y);
    if (site) continue;

    remote.createConstructionSite(cp.x, cp.y, STRUCTURE_CONTAINER);
    return;
  }
}

function updateRemoteStats(home: Room, remoteName: string): void {
  const entry = ensureRemoteEntry(home, remoteName);
  if (entry.stats && Game.time - entry.stats.lastCalc < 1000) return;

  const remote = Game.rooms[remoteName];
  if (!remote) return;

  const sources = remote.find(FIND_SOURCES);
  let totalDist = 0;
  let sourceCount = 0;

  const storagePos = home.storage?.pos ?? home.find(FIND_MY_SPAWNS)[0]?.pos;
  if (!storagePos) return;

  for (const source of sources) {
    const ret = PathFinder.search(
      storagePos,
      { pos: source.pos, range: 1 },
      {
        plainCost: 2,
        swampCost: 10,
        maxOps: 4000,
      }
    );
    if (!ret.incomplete) {
      totalDist += ret.path.length;
      sourceCount++;
    }
  }

  if (sourceCount === 0) return;

  const avgDist = totalDist / sourceCount;
  const energyPerTick = 10 * sourceCount;
  const roundTripTime = 2 * avgDist + 20;
  const neededCarryParts = (energyPerTick * roundTripTime) / 50;

  entry.stats = {
    lastCalc: Game.time,
    distance: avgDist,
    neededCarryParts: Math.ceil(neededCarryParts),
    sourceCount,
  };
}

// Helpers for task assignment
function pickHomeEnergyTargetId(room: Room): string | null {
  const storage = room.storage;
  if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
    return storage.id;

  const spawn = room.find(FIND_MY_SPAWNS, {
    filter: (s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  })[0];
  if (spawn) return spawn.id;

  const extension = room.find(FIND_MY_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_EXTENSION &&
      (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  })[0] as StructureExtension | undefined;

  if (extension) return extension.id;

  const containers = room.find(FIND_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_CONTAINER &&
      (s as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureContainer[];
  return containers[0]?.id ?? null;
}

function pickDroppedEnergyId(room: Room): string | null {
  const drops = room.find(FIND_DROPPED_RESOURCES, {
    filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
  });
  drops.sort((a, b) => b.amount - a.amount);
  return drops[0]?.id ?? null;
}

function pickContainerWithEnergyId(room: Room): string | null {
  const containers = room.find(FIND_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_CONTAINER &&
      (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureContainer[];
  containers.sort(
    (a, b) =>
      b.store.getUsedCapacity(RESOURCE_ENERGY) -
      a.store.getUsedCapacity(RESOURCE_ENERGY),
  );
  return containers[0]?.id ?? null;
}

function pickKeeperTarget(room: Room): Creep | null {
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  return (
    hostiles.find((c) => c.owner?.username === "Source Keeper") ??
    hostiles[0] ??
    null
  );
}

/**
 * 外矿 (Remote Mining) 进程
 * 
 * 负责管理所有外矿房间的运作。
 * 
 * 主要职责：
 * 1. 侦查 (Scouting): 发现并评估邻近房间是否适合作为外矿。
 * 2. 威胁评估 (Threat Assessment): 监控外矿的安全状况 (入侵者、Source Keeper)。
 * 3. 设施规划 (Planning): 规划 Container 位置。
 * 4. 任务分配 (Task Assignment):
 *    - Scout: 侦查新房间。
 *    - RemoteHarvester: 移动到外矿 Source 处采集。
 *    - RemoteHauler: 在外矿和主房之间搬运能量。
 *    - Reserver: 预订外矿控制器。
 *    - KeeperKiller/Healer: 清理 Source Keeper。
 */
export class RemoteMiningProcess extends Process {
  public run(): void {
    for (const home of getMyRooms()) runRemoteDiscovery(home);
    const pairs = getPairs();
    for (const { home, remoteName } of pairs) {
      updateThreat(home, remoteName);
      planRemoteStaticHarvesting(home, remoteName);
      updateRemoteStats(home, remoteName);
    }

    const creeps = Object.values(Game.creeps);
    for (const creep of creeps) {
      if (creep.memory.taskId) {
          const taskPid = creep.memory.taskId;
          if (!this.kernel.getProcessType(taskPid)) {
              delete creep.memory.taskId;
          } else {
              continue;
          }
      }

      const role = creep.memory.role;
      const homeRoom = creep.memory.homeRoom;
      const targetRoom = creep.memory.targetRoom;
      if (!homeRoom || !targetRoom) continue;

      const home = Game.rooms[homeRoom];
      if (!home?.controller?.my) continue;

      const task = this.assignRemoteTask(creep, role, home, targetRoom);
      if (task) {
          this.spawnTask(creep, task.type, task.data, task.priority);
      }
    }
  }

  private assignRemoteTask(creep: Creep, role: string, home: Room, targetRoom: string): { type: string, data: any, priority: number } | null {
      // Common: Check if safe
      // STRICT CHECK: If we are not in target room, and it's unsafe, DO NOT ENTER.
      if (!isRemoteSafe(home, targetRoom)) {
          // Unsafe: Move home if not already there
          if (creep.room.name !== home.name) {
              return { type: "MoveTask", data: { targetRoom: home.name }, priority: 60 };
          }
          // If at home, wait.
          return null; 
      }

      // Role specific
      if (role === "scout") {
          if (creep.room.name !== targetRoom) {
              return { type: "MoveTask", data: { targetRoom }, priority: 55 };
          }
          return null;
      }

      if (role === "remoteHarvester") {
          if (creep.room.name !== targetRoom) {
              return { type: "MoveTask", data: { targetRoom }, priority: 50 };
          }
          
          const sourceId = creep.memory.sourceId;
          const source = sourceId ? Game.getObjectById(sourceId as Id<Source>) : null;
          const pickedSource = source ?? creep.room.find(FIND_SOURCES)[0] ?? null;
          if (!pickedSource) return null;
          creep.memory.sourceId = pickedSource.id;

          const entry = home.memory.remote?.[targetRoom];
          const plan = entry?.sources?.[pickedSource.id];
          const cp = plan?.containerPos;
          
          if (cp) {
             const container = getContainerAt(creep.room, cp.x, cp.y);
             if (container) {
                 if (container.hits < container.hitsMax && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                     return { type: "RepairTask", data: { targetId: container.id }, priority: 55 };
                 }
                 // If container exists, just harvest. But we need to be ON the container.
                 // HarvestTask usually moves to range 1.
                 // We need to move to container pos.
                 if (creep.pos.x !== cp.x || creep.pos.y !== cp.y) {
                     return { type: "MoveTask", data: { targetPos: { x: cp.x, y: cp.y, roomName: targetRoom }, range: 0 }, priority: 55 };
                 }
                 return { type: "HarvestTask", data: { targetId: pickedSource.id }, priority: 50 };
             }

             const site = getContainerSiteAt(creep.room, cp.x, cp.y);
             if (site) {
                 if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 20) {
                     return { type: "BuildTask", data: { targetId: site.id }, priority: 60 };
                 }
                 return { type: "HarvestTask", data: { targetId: pickedSource.id }, priority: 50 };
             }
          }
          return { type: "HarvestTask", data: { targetId: pickedSource.id }, priority: 50 };
      }

      if (role === "remoteHauler") {
          if (creep.memory.hauling && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0)
             creep.memory.hauling = false;
          if (!creep.memory.hauling && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0)
             creep.memory.hauling = true;
             
          if (creep.memory.hauling) {
              if (creep.room.name !== home.name) {
                  return { type: "MoveTask", data: { targetRoom: home.name }, priority: 50 };
              }
              const targetId = pickHomeEnergyTargetId(home);
              if (targetId) return { type: "TransferTask", data: { targetId }, priority: 60 };
              return null;
          } else {
              if (creep.room.name !== targetRoom) {
                  return { type: "MoveTask", data: { targetRoom }, priority: 50 };
              }
              const containerId = pickContainerWithEnergyId(creep.room);
              if (containerId) return { type: "WithdrawTask", data: { targetId: containerId }, priority: 55 };
              const dropId = pickDroppedEnergyId(creep.room);
              if (dropId) return { type: "PickupTask", data: { targetId: dropId }, priority: 55 };
              return null;
          }
      }

      if (role === "reserver") {
          if (creep.room.name !== targetRoom) {
              return { type: "MoveTask", data: { targetRoom }, priority: 50 };
          }
          if (creep.room.controller) {
              return { type: "ClaimTask", data: { targetId: creep.room.controller.id }, priority: 50 };
          }
      }

      if (role === "keeperKiller") {
          if (creep.room.name !== targetRoom) {
               return { type: "MoveTask", data: { targetRoom }, priority: 80 }; // High priority move
          }
          const target = pickKeeperTarget(creep.room);
          if (target) {
              return { type: "RangedAttackTask", data: { targetId: target.id }, priority: 85 };
          }
          // Heal self if no target
          if (creep.hits < creep.hitsMax) {
              return { type: "HealTask", data: { targetId: creep.id }, priority: 90 };
          }
      }

      if (role === "keeperHealer") {
          if (creep.room.name !== targetRoom) {
               return { type: "MoveTask", data: { targetRoom }, priority: 80 };
          }
          // Find killer to heal
          const killers = Object.values(Game.creeps).filter(c => c.memory.role === "keeperKiller" && c.room.name === targetRoom);
          const follow = killers[0];
          if (follow) {
              if (follow.hits < follow.hitsMax) {
                  return { type: "HealTask", data: { targetId: follow.id }, priority: 90 };
              }
              // Move to follow
              if (creep.pos.getRangeTo(follow) > 1) {
                  return { type: "MoveTask", data: { targetPos: { x: follow.pos.x, y: follow.pos.y, roomName: targetRoom }, range: 1 }, priority: 80 };
              }
          }
          if (creep.hits < creep.hitsMax) {
               return { type: "HealTask", data: { targetId: creep.id }, priority: 90 };
          }
      }

      if (role === "scout") {
          if (creep.room.name !== targetRoom) {
               return { type: "MoveTask", data: { targetRoom }, priority: 40 };
          }
          // Arrived logic handled in main loop (runScout logic inside process?)
          // Wait, runScout logic was "if in room, update memory".
          // The scout task (MoveTask) completes when in room.
          // Then creep has no task.
          // We can check if creep is in targetRoom here and do the memory update.
          if (creep.room.name === targetRoom) {
               if (!home.memory.remotes) home.memory.remotes = [];
               if (!home.memory.remotes.includes(targetRoom)) {
                   if (evaluateRemote(home, creep.room)) home.memory.remotes.push(targetRoom);
               }
               const scout = home.memory.scout;
               if (scout && scout.targetRoom === targetRoom) {
                   scout.status = "completed";
                   delete scout.targetRoom;
                   scout.lastScan = Game.time;
               }
               // Scout done. Kill creep? Or let Spawner handle cleanup (Spawner doesn't kill).
               creep.suicide(); // Optimization: recycle if possible, but suicide is fast.
          }
      }

      return null;
  }

  private spawnTask(creep: Creep, type: string, data: any, priority: number): void {
      const pid = `task_${creep.name}_${Game.time}_${Math.floor(Math.random()*1000)}`;
      let process: Process | undefined;
      
      switch (type) {
          case "HarvestTask": process = new HarvestTask(pid, this.pid, priority); break;
          case "TransferTask": process = new TransferTask(pid, this.pid, priority); break;
          case "WithdrawTask": process = new WithdrawTask(pid, this.pid, priority); break;
          case "PickupTask": process = new PickupTask(pid, this.pid, priority); break;
          case "BuildTask": process = new BuildTask(pid, this.pid, priority); break;
          case "RepairTask": process = new RepairTask(pid, this.pid, priority); break;
          case "AttackTask": process = new AttackTask(pid, this.pid, priority); break;
          case "RangedAttackTask": process = new RangedAttackTask(pid, this.pid, priority); break;
          case "HealTask": process = new HealTask(pid, this.pid, priority); break;
          case "ClaimTask": process = new ClaimTask(pid, this.pid, priority); break;
          case "MoveTask": process = new MoveTask(pid, this.pid, priority); break;
      }

      if (process) {
          this.kernel.addProcess(process);
          const mem = this.kernel.getProcessMemory(pid);
          mem.creepName = creep.name;
          Object.assign(mem, data);
          creep.memory.taskId = pid;
      }
  }
}

processRegistry.register(RemoteMiningProcess, "RemoteMiningProcess");
