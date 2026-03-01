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
import { WithdrawTask } from "../tasks/WithdrawTask";
import { PickupTask } from "../tasks/PickupTask";

type SupportedTask = Extract<
  TaskType,
  "pickup" | "harvest" | "withdraw" | "transfer" | "upgrade" | "build"
>;
type AssignedTask = { type: SupportedTask; targetId?: string };

const sourceSlotsCache: Record<string, number> = {};

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

function getDroppedEnergy(room: Room): Resource<RESOURCE_ENERGY>[] {
  return Cache.getTick(`rl:dropped:${room.name}`, () => {
    const drops = room.find(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    }) as Resource<RESOURCE_ENERGY>[];
    return drops;
  });
}

function getTombstonesWithEnergy(room: Room): Tombstone[] {
  return Cache.getTick(`rl:tombstones:${room.name}`, () => {
    return room.find(FIND_TOMBSTONES, {
      filter: (t) => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
    });
  });
}

function getRuinsWithEnergy(room: Room): Ruin[] {
  return Cache.getTick(`rl:ruins:${room.name}`, () => {
    return room.find(FIND_RUINS, {
      filter: (r) => r.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
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
  const drops = getDroppedEnergy(creep.room);
  if (drops.length === 0) return null;
  return pickClosestReservableId(creep, drops, (d) => d.amount);
}

function pickTombstoneEnergyId(creep: Creep): string | null {
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return null;
  const tombstones = getTombstonesWithEnergy(creep.room);
  if (tombstones.length === 0) return null;
  return pickClosestReservableId(creep, tombstones, (t) =>
    t.store.getUsedCapacity(RESOURCE_ENERGY),
  );
}

function pickRuinEnergyId(creep: Creep): string | null {
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return null;
  const ruins = getRuinsWithEnergy(creep.room);
  if (ruins.length === 0) return null;
  return pickClosestReservableId(creep, ruins, (r) =>
    r.store.getUsedCapacity(RESOURCE_ENERGY),
  );
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
  let bestExtension: StructureExtension | null = null;
  let bestExtensionRange = 999;
  for (const e of extensions) {
    if (e.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) continue;
    const range = creep.pos.getRangeTo(e);
    if (range < bestExtensionRange) {
      bestExtensionRange = range;
      bestExtension = e;
    }
  }
  if (bestExtension && tryReserve(bestExtension.id, creep.name, 1))
    return bestExtension.id;

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
  if (storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
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
  if (storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
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

function assignUpgraderTask(
  creep: Creep,
): { type: SupportedTask; targetId?: string } | null {
  const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);

  if (used === 0) creep.memory.working = false;
  if (free === 0) creep.memory.working = true;

  if (creep.memory.working) {
    const storageEnergy =
      creep.room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
    const energyHealthy =
      storageEnergy > 2000 ||
      creep.room.energyAvailable > creep.room.energyCapacityAvailable * 0.3;
    const ticksToDowngrade = creep.room.controller?.ticksToDowngrade ?? 10000;

    if (!energyHealthy && ticksToDowngrade > 2000) {
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

function assignTask(
  creep: Creep,
  assigned: Record<string, number>,
  counts: { upgrade: number; build: number },
): { type: SupportedTask; targetId?: string } | null {
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

  if (!creep.memory.working) {
    const dropId = pickDroppedEnergyId(creep);
    if (dropId) return { type: "pickup", targetId: dropId };
    const energyId = pickEnergySourceId(creep);
    if (energyId) return { type: "withdraw", targetId: energyId };
    const sourceId = pickSourceId(creep, assigned);
    if (!sourceId) return null;
    assigned[sourceId] = (assigned[sourceId] ?? 0) + 1;
    return { type: "harvest", targetId: sourceId };
  }

  const needsRefill = roomNeedsRefill(creep.room);

  if (needsRefill) {
    const targetId = pickEnergyTargetId(creep);
    if (!targetId) return { type: "upgrade" };
    return { type: "transfer", targetId };
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
  return { type: "upgrade" };
}

export class RoomLogisticsProcess extends Process {
  public run(): void {
    for (const room of getMyRooms()) {
      const assigned: Record<string, number> = {};
      const counts = { upgrade: 0, build: 0 };

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

        const newTask = assignTask(creep, assigned, counts);
        if (newTask) {
          this.spawnTask(creep, newTask);
          if (newTask.type === "upgrade") counts.upgrade++;
          if (newTask.type === "build") counts.build++;
        } else {
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

      const upgraders = StructureCache.getCreeps(room, "upgrader");
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
        if (newTask) this.spawnTask(creep, newTask);
      }
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

      creep.memory.taskId = pid;
    }
  }
}

processRegistry.register(RoomLogisticsProcess, "RoomLogisticsProcess");
