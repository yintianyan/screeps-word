import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { TaskType } from "../tasks/types";
import { config } from "../config";
import { tryReserve } from "../core/Reservation";
import { Cache } from "../core/Cache";
import StructureCache from "../utils/structureCache";
import { HarvestTask } from "../tasks/HarvestTask";
import { TransferTask } from "../tasks/TransferTask";
import { UpgradeTask } from "../tasks/UpgradeTask";
import { BuildTask } from "../tasks/BuildTask";
import { RepairTask } from "../tasks/RepairTask";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { PickupTask } from "../tasks/PickupTask";
import { Debug } from "../core/Debug";

type SupportedTask = Extract<
  TaskType,
  "pickup" | "harvest" | "withdraw" | "transfer" | "upgrade" | "build" | "repair"
>;
type AssignedTask = {
  type: SupportedTask;
  targetId?: string;
  resourceType?: ResourceConstant;
};
type WorkerStickyTask = {
  type: SupportedTask;
  targetId?: string;
  resourceType?: ResourceConstant;
  until: number;
};

const sourceSlotsCache: Record<string, number> = {};
const WORKER_STICKY_TICKS = 10;

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) rooms.push(room);
  }
  return rooms;
}

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function countSourceSlots(source: Source): number {
  const cached = sourceSlotsCache[source.id];
  if (cached != null) return cached;
  const terrain = source.room.getTerrain();
  let slots = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = source.pos.x + dx;
      const y = source.pos.y + dy;
      if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) slots++;
    }
  }
  const value = Math.max(1, slots);
  sourceSlotsCache[source.id] = value;
  return value;
}

function getDroppedResources(room: Room): Resource[] {
  return Cache.getTick(`rl:dropped:${room.name}`, () => {
    return room.find(FIND_DROPPED_RESOURCES, {
      filter: (r) =>
        (r.resourceType === RESOURCE_ENERGY && r.amount >= 50) ||
        (r.resourceType !== RESOURCE_ENERGY && r.amount >= 10),
    }) as Resource[];
  });
}

function getTombstonesWithResources(room: Room): Tombstone[] {
  return Cache.getTick(`rl:tombstones:${room.name}`, () => {
    return room.find(FIND_TOMBSTONES, {
      filter: (t) => t.store.getUsedCapacity() > 0,
    });
  });
}

function getRuinsWithResources(room: Room): Ruin[] {
  return Cache.getTick(`rl:ruins:${room.name}`, () => {
    return room.find(FIND_RUINS, {
      filter: (r) => r.store.getUsedCapacity() > 0,
    });
  });
}

function getMyStructures(room: Room): Structure[] {
  return Cache.getTick(`rl:myStructures:${room.name}`, () =>
    room.find(FIND_MY_STRUCTURES),
  );
}

function roomNeedsRefill(room: Room): boolean {
  return Cache.getTick(`rl:needsRefill:${room.name}`, () => {
    const spawns = StructureCache.getMyStructures(
      room,
      STRUCTURE_SPAWN,
    ) as StructureSpawn[];
    for (const s of spawns) {
      if (s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return true;
    }

    const extensions = StructureCache.getMyStructures(
      room,
      STRUCTURE_EXTENSION,
    ) as StructureExtension[];
    for (const e of extensions) {
      if (e.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return true;
    }

    const towers = StructureCache.getMyStructures(
      room,
      STRUCTURE_TOWER,
    ) as StructureTower[];
    for (const t of towers) {
      if (t.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return true;
    }

    return false;
  });
}

function spawnNeedsRefill(room: Room): boolean {
  const spawns = StructureCache.getMyStructures(
    room,
    STRUCTURE_SPAWN,
  ) as StructureSpawn[];
  for (const s of spawns) {
    if (s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return true;
  }
  return false;
}

function pickClosestReservableId<T extends { id: string; pos: RoomPosition }>(
  creep: Creep,
  targets: T[],
  getAmount: (t: T) => number,
): string | null {
  if (targets.length === 0) return null;
  const capacity = creep.store.getCapacity(RESOURCE_ENERGY) || 50;

  const rejected = new Set<string>();
  for (let attempt = 0; attempt < 5; attempt++) {
    let best: T | null = null;
    let bestRange = 999;
    for (const t of targets) {
      if (rejected.has(t.id)) continue;
      const range = creep.pos.getRangeTo(t.pos);
      if (range < bestRange) {
        bestRange = range;
        best = t;
      }
    }
    if (!best) return null;

    const amount = getAmount(best);
    const slots = Math.min(5, Math.ceil(amount / (capacity * 0.5)));
    if (tryReserve(best.id, creep.name, slots)) return best.id;
    rejected.add(best.id);
  }
  return null;
}

function pickDroppedEnergyId(creep: Creep): string | null {
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return null;
  const drops = getDroppedResources(creep.room).filter(
    (d): d is Resource<RESOURCE_ENERGY> => d.resourceType === RESOURCE_ENERGY,
  );
  if (drops.length === 0) return null;
  return pickClosestReservableId(creep, drops, (d) => d.amount);
}

function pickTombstoneEnergyId(creep: Creep): string | null {
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return null;
  const tombstones = getTombstonesWithResources(creep.room).filter(
    (t) => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
  );
  if (tombstones.length === 0) return null;
  return pickClosestReservableId(creep, tombstones, (t) =>
    t.store.getUsedCapacity(RESOURCE_ENERGY),
  );
}

function pickRuinEnergyId(creep: Creep): string | null {
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return null;
  const ruins = getRuinsWithResources(creep.room).filter(
    (r) => r.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
  );
  if (ruins.length === 0) return null;
  return pickClosestReservableId(creep, ruins, (r) =>
    r.store.getUsedCapacity(RESOURCE_ENERGY),
  );
}

function pickStoredResource(
  store: Tombstone["store"] | Ruin["store"],
): ResourceConstant | null {
  for (const resource of RESOURCES_ALL) {
    if (resource === RESOURCE_ENERGY) continue;
    if (store.getUsedCapacity(resource) > 0) return resource;
  }
  if (store.getUsedCapacity(RESOURCE_ENERGY) > 0) return RESOURCE_ENERGY;
  return null;
}

function pickDroppedResourceTask(creep: Creep): AssignedTask | null {
  if (creep.store.getFreeCapacity() <= 0) return null;
  const drops = getDroppedResources(creep.room);
  if (drops.length === 0) return null;
  const targetId = pickClosestReservableId(creep, drops, (d) => d.amount);
  if (!targetId) return null;
  return { type: "pickup", targetId };
}

function pickTombstoneResourceTask(creep: Creep): AssignedTask | null {
  if (creep.store.getFreeCapacity() <= 0) return null;
  const tombstones = getTombstonesWithResources(creep.room).filter(
    (t) => pickStoredResource(t.store) != null,
  );
  if (tombstones.length === 0) return null;
  const targetId = pickClosestReservableId(creep, tombstones, (t) =>
    t.store.getUsedCapacity(),
  );
  if (!targetId) return null;
  const target = Game.getObjectById(targetId as Id<Tombstone>);
  if (!(target instanceof Tombstone)) return null;
  const resourceType = pickStoredResource(target.store);
  if (!resourceType) return null;
  return { type: "withdraw", targetId, resourceType };
}

function pickRuinResourceTask(creep: Creep): AssignedTask | null {
  if (creep.store.getFreeCapacity() <= 0) return null;
  const ruins = getRuinsWithResources(creep.room).filter(
    (r) => pickStoredResource(r.store) != null,
  );
  if (ruins.length === 0) return null;
  const targetId = pickClosestReservableId(creep, ruins, (r) =>
    r.store.getUsedCapacity(),
  );
  if (!targetId) return null;
  const target = Game.getObjectById(targetId as Id<Ruin>);
  if (!(target instanceof Ruin)) return null;
  const resourceType = pickStoredResource(target.store);
  if (!resourceType) return null;
  return { type: "withdraw", targetId, resourceType };
}

function pickEnergyTargetId(creep: Creep): string | null {
  const spawns = StructureCache.getMyStructures(
    creep.room,
    STRUCTURE_SPAWN,
  ) as StructureSpawn[];
  for (const s of spawns) {
    if (s.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) continue;
    if (tryReserve(s.id, creep.name, 1)) return s.id;
  }

  const extensions = StructureCache.getMyStructures(
    creep.room,
    STRUCTURE_EXTENSION,
  ) as StructureExtension[];

  const needyExtensions = extensions.filter(
    (e) => e.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  );
  needyExtensions.sort(
    (a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b),
  );

  for (const e of needyExtensions) {
    if (tryReserve(e.id, creep.name, 1)) return e.id;
  }

  const towers = StructureCache.getMyStructures(
    creep.room,
    STRUCTURE_TOWER,
  ) as StructureTower[];
  let bestTower: StructureTower | null = null;
  let bestTowerRange = 999;
  for (const t of towers) {
    if (t.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) continue;
    const range = creep.pos.getRangeTo(t);
    if (range < bestTowerRange) {
      bestTowerRange = range;
      bestTower = t;
    }
  }
  if (bestTower && tryReserve(bestTower.id, creep.name, 1)) return bestTower.id;

  return null;
}

function pickRepairTargetId(creep: Creep, priority: "critical" | "maintenance"): string | null {
  const roads = StructureCache.getStructures(
    creep.room,
    STRUCTURE_ROAD,
  ) as StructureRoad[];
  const containers = StructureCache.getStructures(
    creep.room,
    STRUCTURE_CONTAINER,
  ) as StructureContainer[];
  const ramparts = StructureCache.getMyStructures(
    creep.room,
    STRUCTURE_RAMPART,
  ) as StructureRampart[];

  if (priority === "critical") {
    // Road < 20%
    const criticalRoad = roads.find((r) => r.hits < r.hitsMax * 0.2);
    if (criticalRoad) return criticalRoad.id;

    // Container < 50%
    const criticalContainer = containers.find((c) => c.hits < c.hitsMax * 0.5);
    if (criticalContainer) return criticalContainer.id;

    // Rampart < 5k (Emergency defense)
    const criticalRampart = ramparts.find((r) => r.hits < 5000);
    if (criticalRampart) return criticalRampart.id;
  } else {
    // Maintenance
    // Road < 80%
    const damagedRoad = roads.find((r) => r.hits < r.hitsMax * 0.8);
    if (damagedRoad) return damagedRoad.id;

    // Container < 90%
    const damagedContainer = containers.find((c) => c.hits < c.hitsMax * 0.9);
    if (damagedContainer) return damagedContainer.id;

    // Fortify
    const rcl = creep.room.controller?.level ?? 0;
    if (rcl >= 4) {
      const storageEnergy =
        creep.room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
      // Only fortify if storage has energy buffer
      if (storageEnergy > config.POPULATION.STORAGE.WORKER_WITHDRAW_MIN) {
        // Target hits based on RCL and Storage level
        let targetHits = 50000;
        if (rcl >= 6) targetHits = 500000;
        if (rcl === 8) {
           if (storageEnergy > 500000) targetHits = 300000000; // Max walls
           else if (storageEnergy > 100000) targetHits = 3000000;
           else targetHits = 1000000;
        }

        const walls = StructureCache.getStructures(
          creep.room,
          STRUCTURE_WALL,
        ) as StructureWall[];
        const fortifications = [...ramparts, ...walls];

        let weakest: Structure | null = null;
        let minHits = targetHits;

        // Find weakest below target
        for (const s of fortifications) {
          if (s.hits < minHits) {
            minHits = s.hits;
            weakest = s;
          }
        }

        if (weakest) return weakest.id;
      }
    }
  }

  return null;
}

function pickConstructionSiteId(
  creep: Creep,
  assigned: Record<string, number>,
): string | null {
  const sites = StructureCache.getConstructionSites(creep.room).filter(
    (s) => s.my,
  );
  if (sites.length === 0) return null;

  const rcl = creep.room.controller?.level ?? 0;
  const existingByType: Partial<Record<BuildableStructureConstant, number>> =
    {};
  for (const s of getMyStructures(creep.room)) {
    const t = s.structureType as BuildableStructureConstant;
    existingByType[t] = (existingByType[t] ?? 0) + 1;
  }

  const desiredByType: Partial<Record<BuildableStructureConstant, number>> = {
    [STRUCTURE_SPAWN]: CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][rcl] ?? 0,
    [STRUCTURE_EXTENSION]: CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] ?? 0,
    [STRUCTURE_TOWER]: CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl] ?? 0,
    [STRUCTURE_STORAGE]: CONTROLLER_STRUCTURES[STRUCTURE_STORAGE][rcl] ?? 0,
    [STRUCTURE_CONTAINER]: CONTROLLER_STRUCTURES[STRUCTURE_CONTAINER][rcl] ?? 0,
    [STRUCTURE_LINK]: CONTROLLER_STRUCTURES[STRUCTURE_LINK][rcl] ?? 0,
  };

  const basePriorityByType: Partial<
    Record<BuildableStructureConstant, number>
  > = {
    [STRUCTURE_SPAWN]: 100,
    [STRUCTURE_TOWER]: 90,
    [STRUCTURE_LINK]: 85,
    [STRUCTURE_STORAGE]: 80,
    [STRUCTURE_EXTENSION]: 70,
    [STRUCTURE_CONTAINER]: 40,
    [STRUCTURE_ROAD]: 10,
  };

  const focus = creep.room.memory.buildFocus;
  let focusSite: ConstructionSite | null = null;
  let focusPriority = 0;
  if (focus) {
    const obj = Game.getObjectById(focus.siteId);
    if (!obj || !(obj instanceof ConstructionSite)) {
      delete creep.room.memory.buildFocus;
    } else {
      if (obj.progress > focus.lastProgress) {
        focus.lastProgress = obj.progress;
        focus.lastTick = Game.time;
      } else if (Game.time - focus.lastTick > 100) {
        delete creep.room.memory.buildFocus;
      } else {
        focusSite = obj;
      }
    }
  }

  const calcPriority = (site: ConstructionSite): number => {
    const type = site.structureType as BuildableStructureConstant;
    const base = basePriorityByType[type] ?? 1;
    const desired = desiredByType[type] ?? 0;
    const existing = existingByType[type] ?? 0;
    const deficit = Math.max(0, desired - existing);
    const deficitBoost = deficit > 0 ? 20 + deficit * 5 : 0;
    return base + deficitBoost;
  };

  let bestPriority = 0;
  let best: ConstructionSite | null = null;
  let bestScore = -999999;

  for (const s of sites) {
    if ((assigned[s.id] ?? 0) >= 2) continue;
    const p = calcPriority(s);
    const range = creep.pos.getRangeTo(s);
    const score = p * 1000 - range;
    if (score > bestScore) {
      bestScore = score;
      best = s;
      bestPriority = p;
    }
  }

  if (focusSite) focusPriority = calcPriority(focusSite);

  if (focusSite && (assigned[focusSite.id] ?? 0) < 4) {
    if (best && best.id !== focusSite.id && bestPriority > focusPriority) {
      creep.room.memory.buildFocus = {
        siteId: best.id,
        lastProgress: best.progress,
        lastTick: Game.time,
      };
      return best.id;
    }
    return focusSite.id;
  }

  if (best) {
    creep.room.memory.buildFocus = {
      siteId: best.id,
      lastProgress: best.progress,
      lastTick: Game.time,
    };
  }

  return best ? best.id : null;
}

function pickSourceId(
  creep: Creep,
  assigned: Record<string, number>,
): string | null {
  const sources = StructureCache.getSources(creep.room);
  if (sources.length === 0) return null;

  const startIndex = Math.abs(hashString(creep.name)) % sources.length;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[(startIndex + i) % sources.length];
    const used = assigned[source.id] ?? 0;
    const slots = countSourceSlots(source);
    if (used < slots) return source.id;
  }

  return sources[startIndex]?.id ?? null;
}

function pickEnergySourceId(creep: Creep): string | null {
  const tombId = pickTombstoneEnergyId(creep);
  if (tombId) return tombId;

  const ruinId = pickRuinEnergyId(creep);
  if (ruinId) return ruinId;

  const storage = creep.room.storage;
  if (
    storage &&
    storage.store.getUsedCapacity(RESOURCE_ENERGY) >
      config.POPULATION.STORAGE.WORKER_WITHDRAW_MIN
  ) {
    if (tryReserve(storage.id, creep.name, 15)) return storage.id;
  }

  const hubId = creep.room.memory.links?.hub;
  if (hubId) {
    const obj = Game.getObjectById(hubId as Id<StructureLink>);
    if (
      obj instanceof StructureLink &&
      obj.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      if (tryReserve(obj.id, creep.name, 4)) return obj.id;
    }
  }

  const containers = StructureCache.getStructures(
    creep.room,
    STRUCTURE_CONTAINER,
  ) as StructureContainer[];
  let best: StructureContainer | null = null;
  let bestRange = 999;
  for (const c of containers) {
    if (c.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) continue;
    const range = creep.pos.getRangeTo(c);
    if (range < bestRange) {
      bestRange = range;
      best = c;
    }
  }
  if (best && tryReserve(best.id, creep.name, 2)) return best.id;

  return null;
}

function pickUpgraderEnergySourceId(creep: Creep): string | null {
  const controllerLink = creep.room.memory.links?.controller;
  if (controllerLink) {
    const link = Game.getObjectById(controllerLink as Id<StructureLink>);
    if (link && link.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      if (tryReserve(link.id, creep.name, 4)) return link.id;
    }
  }

  const tombId = pickTombstoneEnergyId(creep);
  if (tombId) return tombId;

  const ruinId = pickRuinEnergyId(creep);
  if (ruinId) return ruinId;

  const storage = creep.room.storage;
  if (
    storage &&
    storage.store.getUsedCapacity(RESOURCE_ENERGY) >
      config.POPULATION.STORAGE.UPGRADER_WITHDRAW_MIN
  ) {
    if (tryReserve(storage.id, creep.name, 15)) return storage.id;
  }

  const containers = StructureCache.getStructures(
    creep.room,
    STRUCTURE_CONTAINER,
  ) as StructureContainer[];
  let best: StructureContainer | null = null;
  let bestRange = 999;
  for (const c of containers) {
    if (c.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) continue;
    const range = creep.pos.getRangeTo(c);
    if (range < bestRange) {
      bestRange = range;
      best = c;
    }
  }
  if (best && tryReserve(best.id, creep.name, 2)) return best.id;

  const sources = StructureCache.getSources(creep.room);
  const activeSources = sources.filter((s) => s.energy > 0);
  if (activeSources.length > 0) {
    return activeSources[0].id;
  }

  return null;
}

function pickEnergySinkId(creep: Creep): string | null {
  const storage = creep.room.storage;
  if (
    storage &&
    storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
    tryReserve(storage.id, creep.name, 5)
  )
    return storage.id;

  const containers = StructureCache.getStructures(
    creep.room,
    STRUCTURE_CONTAINER,
  ) as StructureContainer[];
  let best: StructureContainer | null = null;
  let bestRange = 999;
  for (const c of containers) {
    if (c.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) continue;
    const range = creep.pos.getRangeTo(c);
    if (range < bestRange) {
      bestRange = range;
      best = c;
    }
  }
  if (best && tryReserve(best.id, creep.name, 2)) return best.id;

  return null;
}

function assignUpgraderTask(
  creep: Creep,
): AssignedTask | null {
  const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);

  if (used === 0) creep.memory.working = false;
  if (free === 0) creep.memory.working = true;

  if (creep.memory.working) {
    const storageEnergy =
      creep.room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
    const energyHealthy =
      storageEnergy > config.POPULATION.STORAGE.UPGRADER_RUN_MIN ||
      creep.room.energyAvailable > creep.room.energyCapacityAvailable * 0.3;
    const ticksToDowngrade = creep.room.controller?.ticksToDowngrade ?? 10000;

    if (!energyHealthy && ticksToDowngrade > 2000) {
      const sinkId = pickEnergySinkId(creep);
      if (sinkId) return { type: "transfer", targetId: sinkId };
      return null;
    }

    return { type: "upgrade" };
  } else {
    const sourceId = pickUpgraderEnergySourceId(creep);
    if (!sourceId) return null;

    const obj = Game.getObjectById(sourceId as Id<Source | Structure>);
    if (obj instanceof Source) return { type: "harvest", targetId: sourceId };
    return { type: "withdraw", targetId: sourceId };
  }
}

/**
 * 分配 Worker 任务
 *
 * 决策逻辑：
 * 1. 紧急状态：Controller 快降级了 -> 强制升级 (Upgrade)。
 *
 * 2. 取能状态 (Not Working):
 *    - 捡地上的能量 (Pickup)。
 *    - 从墓碑/废墟/Storage/Container 取能 (Withdraw)。
 *    - 挖矿 (Harvest) - 如果没有更好的能量来源。
 *
 * 3. 工作状态 (Working):
 *    - 紧急填充 Spawn (如果 Spawn 能量不足)。
 *    - 建造 (Build) - 如果有工地且分配人数不足。
 *    - 常规填充 (Transfer) - 如果没有物流支持 (Distributor/Hauler) 且房间需要能量。
 *    - 升级 (Upgrade) - 兜底任务。
 *
 * @param logisticsSupport 是否有高级物流单位 (Distributor/Hauler)。如果有，Worker 减少搬运工作。
 */
function assignTask(
  creep: Creep,
  assigned: Record<string, number>,
  counts: { upgrade: number; build: number; transfer: number; repair: number },
  hasSites: boolean,
  logisticsSupport: boolean,
): AssignedTask | null {
  const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);

  if (used === 0) creep.memory.working = false;
  if (free === 0) creep.memory.working = true;

  const ticksToDowngrade = creep.room.controller?.ticksToDowngrade;
  if (
    used > 0 &&
    ticksToDowngrade != null &&
    ticksToDowngrade < config.CONTROLLER.DOWNGRADE_CRITICAL
  ) {
    return { type: "upgrade" };
  }

  if (used > 0) {
    const repairId = pickRepairTargetId(creep, "critical");
    if (repairId) return { type: "repair", targetId: repairId };
  }

  if (!creep.memory.working) {
    const dropTask = pickDroppedResourceTask(creep);
    if (dropTask) return dropTask;
    const tombTask = pickTombstoneResourceTask(creep);
    if (tombTask) return tombTask;
    const ruinTask = pickRuinResourceTask(creep);
    if (ruinTask) return ruinTask;
    const energyId = pickEnergySourceId(creep);
    if (energyId) return { type: "withdraw", targetId: energyId };
    const sourceId = pickSourceId(creep, assigned);
    if (!sourceId) return null;
    assigned[sourceId] = (assigned[sourceId] ?? 0) + 1;
    return { type: "harvest", targetId: sourceId };
  }

  const needsRefill = roomNeedsRefill(creep.room);
  const spawnNeeds = spawnNeedsRefill(creep.room);
  const carriedNonEnergy = (RESOURCES_ALL as ResourceConstant[]).find(
    (r) => r !== RESOURCE_ENERGY && creep.store.getUsedCapacity(r) > 0,
  );
  if (carriedNonEnergy) {
    const sinkId = pickEnergySinkId(creep);
    if (sinkId) {
      return { type: "transfer", targetId: sinkId, resourceType: carriedNonEnergy };
    }
    return null;
  }

  if (
    spawnNeeds &&
    (!logisticsSupport ||
      creep.room.energyAvailable < creep.room.energyCapacityAvailable * 0.5)
  ) {
    const targetId = pickEnergyTargetId(creep);
    if (targetId) return { type: "transfer", targetId };
  }

  if (hasSites && counts.build < 1) {
    const siteId = pickConstructionSiteId(creep, assigned);
    if (siteId) {
      assigned[siteId] = (assigned[siteId] ?? 0) + 1;
      return { type: "build", targetId: siteId };
    }
  }

  if (needsRefill && !logisticsSupport) {
    const targetId = pickEnergyTargetId(creep);
    if (targetId) return { type: "transfer", targetId };
  }

  if (
    ticksToDowngrade != null &&
    ticksToDowngrade < config.CONTROLLER.DOWNGRADE_LOW &&
    counts.upgrade < 1
  ) {
    return { type: "upgrade" };
  }
  const siteId = pickConstructionSiteId(creep, assigned);
  if (siteId) {
    assigned[siteId] = (assigned[siteId] ?? 0) + 1;
    return { type: "build", targetId: siteId };
  }

  const repairId = pickRepairTargetId(creep, "maintenance");
  if (repairId) return { type: "repair", targetId: repairId };

  const rcl = creep.room.controller?.level ?? 0;
  if (rcl === 8 && (ticksToDowngrade ?? 0) > 50000) {
    return null;
  }

  return { type: "upgrade" };
}

function hasStore(value: unknown): value is { store: StoreDefinition } {
  if (!value || typeof value !== "object") return false;
  return "store" in value;
}

function getWorkerStickyTask(creep: Creep): WorkerStickyTask | null {
  const mem = creep.memory as CreepMemory & { workerStickyTask?: WorkerStickyTask };
  const sticky = mem.workerStickyTask;
  if (!sticky) return null;
  if (typeof sticky.until !== "number" || sticky.until < Game.time) {
    delete mem.workerStickyTask;
    return null;
  }
  return sticky;
}

function clearWorkerStickyTask(creep: Creep): void {
  const mem = creep.memory as CreepMemory & { workerStickyTask?: WorkerStickyTask };
  delete mem.workerStickyTask;
}

function rememberWorkerStickyTask(creep: Creep, task: AssignedTask): void {
  const mem = creep.memory as CreepMemory & { workerStickyTask?: WorkerStickyTask };
  mem.workerStickyTask = {
    type: task.type,
    targetId: task.targetId,
    resourceType: task.resourceType,
    until: Game.time + WORKER_STICKY_TICKS,
  };
}

function canRunStickyTask(creep: Creep, task: WorkerStickyTask): boolean {
  if (task.until < Game.time) return false;
  const freeEnergy = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  const usedEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const resType = task.resourceType ?? RESOURCE_ENERGY;

  if (task.type === "upgrade") {
    return usedEnergy > 0 && !!creep.room.controller?.my;
  }
  if (task.type === "build") {
    if (usedEnergy <= 0 || !task.targetId) return false;
    const site = Game.getObjectById(task.targetId as Id<ConstructionSite>);
    return site instanceof ConstructionSite;
  }
  if (task.type === "repair") {
    if (usedEnergy <= 0 || !task.targetId) return false;
    const target = Game.getObjectById(task.targetId as Id<Structure>);
    return target instanceof Structure && target.hits < target.hitsMax;
  }
  if (task.type === "harvest") {
    if (freeEnergy <= 0 || !task.targetId) return false;
    const source = Game.getObjectById(task.targetId as Id<Source>);
    return source instanceof Source && source.energy > 0;
  }
  if (task.type === "pickup") {
    if (creep.store.getFreeCapacity() <= 0 || !task.targetId) return false;
    const resource = Game.getObjectById(task.targetId as Id<Resource>);
    return resource instanceof Resource && resource.amount > 0;
  }
  if (task.type === "withdraw") {
    if (creep.store.getFreeCapacity() <= 0 || !task.targetId) return false;
    const target = Game.getObjectById(
      task.targetId as Id<Structure | Tombstone | Ruin>,
    );
    if (!target || !hasStore(target)) return false;
    return target.store.getUsedCapacity(resType) > 0;
  }
  if (task.type === "transfer") {
    if (!task.targetId) return false;
    const target = Game.getObjectById(
      task.targetId as Id<Structure | Tombstone | Ruin>,
    );
    if (!target || !hasStore(target)) return false;
    return (
      creep.store.getUsedCapacity(resType) > 0 &&
      target.store.getFreeCapacity(resType) > 0
    );
  }
  return false;
}

/**
 * 房间物流进程
 *
 * 负责管理房间内的普通 Worker 和 Upgrader。
 *
 * 主要职责：
 * 1. 统计房间内的物流需求（工地、能量填充、升级）。
 * 2. 监控 Creep 数量和状态。
 * 3. 为 Worker 和 Upgrader 分配任务。
 * 4. 记录性能指标 (Metrics)。
 */
export class RoomLogisticsProcess extends Process {
  public run(): void {
    for (const room of getMyRooms()) {
      const assigned: Record<string, number> = {};
      const counts = { upgrade: 0, build: 0, transfer: 0, repair: 0 };
      const hasSites = StructureCache.getConstructionSites(room).some(
        (s) => s.my,
      );
      const distributorCount = StructureCache.getCreeps(
        room,
        "distributor",
      ).length;
      const haulerCount = StructureCache.getCreeps(room, "hauler").length;
      const logisticsSupport = distributorCount + haulerCount > 0;

      let idleWorkerCount = 0;

      const workers = StructureCache.getCreeps(room, "worker");
      for (const creep of workers) {
        if (creep.memory.taskId) {
          const taskPid = creep.memory.taskId;
          if (!this.kernel.getProcessType(taskPid)) {
            delete creep.memory.taskId;
          } else {
            continue;
          }
        }

        const stickyTask = getWorkerStickyTask(creep);
        if (stickyTask && canRunStickyTask(creep, stickyTask)) {
          this.spawnTask(creep, stickyTask);
          if (stickyTask.type === "upgrade") counts.upgrade++;
          if (stickyTask.type === "build") counts.build++;
          if (stickyTask.type === "transfer") counts.transfer++;
          if (stickyTask.type === "repair") counts.repair++;
          continue;
        }
        if (stickyTask) clearWorkerStickyTask(creep);

        const newTask = assignTask(
          creep,
          assigned,
          counts,
          hasSites,
          logisticsSupport,
        );
        if (newTask) {
          rememberWorkerStickyTask(creep, newTask);
          this.spawnTask(creep, newTask);
          if (newTask.type === "upgrade") counts.upgrade++;
          if (newTask.type === "build") counts.build++;
          if (newTask.type === "transfer") counts.transfer++;
          if (newTask.type === "repair") counts.repair++;
        } else {
          clearWorkerStickyTask(creep);
          idleWorkerCount++;
        }
      }

      if (!room.memory.metrics) {
        room.memory.metrics = {
          idleRate: 0,
          lastUpdate: Game.time,
          workerCount: 0,
          idleWorkerCount: 0,
        };
      }
      const metrics = room.memory.metrics;
      metrics.workerCount = workers.length;
      metrics.idleWorkerCount = idleWorkerCount;
      const currentRate =
        workers.length > 0 ? idleWorkerCount / workers.length : 0;
      const alpha = config.POPULATION.METRICS_ALPHA;
      metrics.idleRate = metrics.idleRate * (1 - alpha) + currentRate * alpha;
      metrics.lastUpdate = Game.time;

      Debug.gauge(`room.${room.name}.workers.total`, workers.length);
      Debug.gauge(`room.${room.name}.workers.idle`, idleWorkerCount);
      Debug.gauge(`room.${room.name}.workers.build`, counts.build);
      Debug.gauge(`room.${room.name}.workers.upgrade`, counts.upgrade);
      Debug.gauge(`room.${room.name}.workers.transfer`, counts.transfer);
      Debug.gauge(`room.${room.name}.workers.repair`, counts.repair);
      Debug.gauge(`room.${room.name}.distributors.total`, distributorCount);
      Debug.gauge(`room.${room.name}.haulers.total`, haulerCount);
      let runningBuild = 0;
      let runningUpgrade = 0;
      let runningRepair = 0;
      for (const c of workers) {
        const pid = c.memory.taskId;
        if (!pid) continue;
        const t = this.kernel.getProcessType(pid);
        if (t === "BuildTask") runningBuild++;
        if (t === "UpgradeTask") runningUpgrade++;
        if (t === "RepairTask") runningRepair++;
      }
      Debug.gauge(`room.${room.name}.workers.runningBuild`, runningBuild);
      Debug.gauge(`room.${room.name}.workers.runningUpgrade`, runningUpgrade);
      Debug.gauge(`room.${room.name}.workers.runningRepair`, runningRepair);

      const upgraders = StructureCache.getCreeps(room, "upgrader");
      let upgraderAssigned = 0;
      for (const creep of upgraders) {
        if (creep.memory.taskId) {
          const taskPid = creep.memory.taskId;
          if (!this.kernel.getProcessType(taskPid)) {
            delete creep.memory.taskId;
          } else {
            continue;
          }
        }

        const newTask = assignUpgraderTask(creep);
        if (newTask) {
          this.spawnTask(creep, newTask);
          upgraderAssigned++;
        }
      }

      Debug.gauge(`room.${room.name}.upgraders.total`, upgraders.length);
      Debug.gauge(`room.${room.name}.upgraders.assigned`, upgraderAssigned);
    }
  }

  private spawnTask(creep: Creep, task: AssignedTask): void {
    const pid = `task_${creep.name}_${Game.time}_${Math.floor(Math.random() * 1000)}`;
    let process: Process | undefined;

    const priority = 50;

    switch (task.type) {
      case "harvest":
        process = new HarvestTask(pid, this.pid, priority);
        break;
      case "transfer":
        process = new TransferTask(pid, this.pid, priority);
        break;
      case "upgrade":
        process = new UpgradeTask(pid, this.pid, priority);
        break;
      case "build":
        process = new BuildTask(pid, this.pid, priority);
        break;
      case "repair":
        process = new RepairTask(pid, this.pid, priority);
        break;
      case "withdraw":
        process = new WithdrawTask(pid, this.pid, priority);
        break;
      case "pickup":
        process = new PickupTask(pid, this.pid, priority);
        break;
    }

    if (process) {
      this.kernel.addProcess(process);
      const mem = this.kernel.getProcessMemory(pid);
      mem.creepName = creep.name;
      mem.targetId = task.targetId;
      if (task.resourceType) mem.resourceType = task.resourceType;

      creep.memory.taskId = pid;
      Debug.event(
        "task_assigned",
        {
          taskPid: pid,
          taskType: process.constructor.name,
          targetId: task.targetId,
        },
        { creep: creep.name, room: creep.room.name, pid },
      );
    }
  }
}

processRegistry.register(RoomLogisticsProcess, "RoomLogisticsProcess");
