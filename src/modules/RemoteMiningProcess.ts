import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { config } from "../config";
import { smartMove } from "../tasks/move/smartMove";
import { runHarvest } from "../tasks/impl/harvest";
import { runPickup } from "../tasks/impl/pickup";
import { runTransfer } from "../tasks/impl/transfer";
import { runWithdraw } from "../tasks/impl/withdraw";
import { isSourceKeeperRoom } from "../utils/roomName";

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

function moveToRoom(creep: Creep, roomName: string): void {
  if (creep.room.name === roomName) return;
  const dir = creep.room.findExitTo(roomName);
  if (dir === ERR_NO_PATH || dir === ERR_INVALID_ARGS) return;
  const exits = creep.room.find(dir as ExitConstant);
  const exit = creep.pos.findClosestByRange(exits);
  if (exit) smartMove(creep, exit, { reusePath: 20, range: 1 });
}

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

  return extension ? extension.id : null;
}

function runRemoteHarvester(
  creep: Creep,
  home: Room,
  remoteName: string,
): void {
  if (!isRemoteSafe(home, remoteName)) {
    moveToRoom(creep, home.name);
    return;
  }

  if (creep.room.name !== remoteName) {
    moveToRoom(creep, remoteName);
    return;
  }

  const sourceId = creep.memory.sourceId;
  const source = sourceId ? Game.getObjectById(sourceId) : null;
  const pickedSource = source ?? creep.room.find(FIND_SOURCES)[0] ?? null;
  if (!pickedSource) return;
  creep.memory.sourceId = pickedSource.id;

  const entry = home.memory.remote?.[remoteName];
  const plan = entry?.sources?.[pickedSource.id];
  const cp = plan?.containerPos;
  if (cp) {
    const container = getContainerAt(creep.room, cp.x, cp.y);
    if (container) {
      if (creep.pos.x !== cp.x || creep.pos.y !== cp.y) {
        smartMove(creep, container, { reusePath: 20, range: 0 });
        return;
      }
      if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 40) {
        creep.transfer(container, RESOURCE_ENERGY);
        return;
      }
      runHarvest(creep, pickedSource.id);
      return;
    }

    const site = getContainerSiteAt(creep.room, cp.x, cp.y);
    if (site) {
      if (creep.pos.getRangeTo(site) > 0) {
        smartMove(creep, site, { reusePath: 20, range: 0 });
        return;
      }
      if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 20) {
        creep.build(site);
        return;
      }
    }
  }

  runHarvest(creep, pickedSource.id);
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

function runRemoteHauler(creep: Creep, home: Room, remoteName: string): void {
  if (!isRemoteSafe(home, remoteName)) {
    creep.memory.hauling = true;
  }

  if (
    creep.memory.hauling &&
    creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0
  ) {
    creep.memory.hauling = false;
  }
  if (
    !creep.memory.hauling &&
    creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
  ) {
    creep.memory.hauling = true;
  }

  if (creep.memory.hauling) {
    if (creep.room.name !== home.name) {
      moveToRoom(creep, home.name);
      return;
    }
    const targetId = pickHomeEnergyTargetId(home);
    if (!targetId) return;
    runTransfer(creep, targetId);
    return;
  }

  if (creep.room.name !== remoteName) {
    moveToRoom(creep, remoteName);
    return;
  }

  const containerId = pickContainerWithEnergyId(creep.room);
  if (containerId) {
    runWithdraw(creep, containerId);
    return;
  }

  const dropId = pickDroppedEnergyId(creep.room);
  if (dropId) {
    runPickup(creep, dropId);
    return;
  }
}

function runReserver(creep: Creep, home: Room, remoteName: string): void {
  if (!isRemoteSafe(home, remoteName)) {
    moveToRoom(creep, home.name);
    return;
  }

  if (creep.room.name !== remoteName) {
    moveToRoom(creep, remoteName);
    return;
  }

  const controller = creep.room.controller;
  if (!controller) return;
  const r = creep.reserveController(controller);
  if (r === ERR_NOT_IN_RANGE) smartMove(creep, controller, { reusePath: 20, range: 1 });
}

function pickKeeperTarget(room: Room): Creep | null {
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  return (
    hostiles.find((c) => c.owner?.username === "Source Keeper") ??
    hostiles[0] ??
    null
  );
}

function runKeeperKiller(creep: Creep, home: Room, remoteName: string): void {
  if (!canRunSkRemote(home)) {
    moveToRoom(creep, home.name);
    return;
  }
  if (creep.room.name !== remoteName) {
    moveToRoom(creep, remoteName);
    return;
  }

  if (creep.hits < creep.hitsMax) creep.heal(creep);

  const target = pickKeeperTarget(creep.room);
  if (!target) return;
  const r = creep.rangedAttack(target);
  if (r === ERR_NOT_IN_RANGE) smartMove(creep, target, { reusePath: 10, range: 3 });
}

function runKeeperHealer(creep: Creep, home: Room, remoteName: string): void {
  if (!canRunSkRemote(home)) {
    moveToRoom(creep, home.name);
    return;
  }
  if (creep.room.name !== remoteName) {
    moveToRoom(creep, remoteName);
    return;
  }

  const killers = Object.values(Game.creeps).filter(
    (c) =>
      c.memory.role === "keeperKiller" &&
      c.memory.homeRoom === home.name &&
      c.memory.targetRoom === remoteName &&
      c.room.name === remoteName,
  );
  const follow = killers[0] ?? null;

  if (follow) {
    if (follow.hits < follow.hitsMax) {
      const r = creep.heal(follow);
      if (r === ERR_NOT_IN_RANGE)
        smartMove(creep, follow, { reusePath: 10, range: 1 });
      return;
    }
    if (creep.pos.getRangeTo(follow) > 1)
      smartMove(creep, follow, { reusePath: 10, range: 1 });
    if (creep.hits < creep.hitsMax) creep.heal(creep);
    return;
  }

  if (creep.hits < creep.hitsMax) creep.heal(creep);
}

function runScout(creep: Creep, home: Room, remoteName: string): void {
  if (creep.room.name !== remoteName) {
    moveToRoom(creep, remoteName);
    return;
  }

  if (!home.memory.remotes) home.memory.remotes = [];
  if (!home.memory.remotes.includes(remoteName)) {
    if (evaluateRemote(home, creep.room)) home.memory.remotes.push(remoteName);
  }

  const scout = home.memory.scout;
  if (scout && scout.targetRoom === remoteName) {
    scout.status = "completed";
    delete scout.targetRoom;
    scout.lastScan = Game.time;
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
      const role = creep.memory.role;
      const homeRoom = creep.memory.homeRoom;
      const targetRoom = creep.memory.targetRoom;
      if (!homeRoom || !targetRoom) continue;

      const home = Game.rooms[homeRoom];
      if (!home?.controller?.my) continue;

      if (role === "remoteHarvester")
        runRemoteHarvester(creep, home, targetRoom);
      if (role === "remoteHauler") runRemoteHauler(creep, home, targetRoom);
      if (role === "reserver") runReserver(creep, home, targetRoom);
      if (role === "keeperKiller") runKeeperKiller(creep, home, targetRoom);
      if (role === "keeperHealer") runKeeperHealer(creep, home, targetRoom);
      if (role === "scout") runScout(creep, home, targetRoom);
    }
  }
}

processRegistry.register(RemoteMiningProcess, "RemoteMiningProcess");
