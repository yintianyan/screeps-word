import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { TaskType } from "../tasks/types";
import { runHarvest } from "../tasks/impl/harvest";
import { runTransfer } from "../tasks/impl/transfer";
import { runUpgrade } from "../tasks/impl/upgrade";
import { runBuild } from "../tasks/impl/build";
import { config } from "../config";

type SupportedTask = Extract<
  TaskType,
  "harvest" | "transfer" | "upgrade" | "build"
>;
type AssignedTask = { type: SupportedTask; targetId?: string; start: number };

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

function getTask(creep: Creep): AssignedTask | null {
  const taskId = creep.memory.taskId;
  const start = creep.memory.taskStart;
  if (!taskId || start == null) return null;
  if (
    taskId !== "harvest" &&
    taskId !== "transfer" &&
    taskId !== "upgrade" &&
    taskId !== "build"
  )
    return null;
  return { type: taskId, targetId: creep.memory.targetId, start };
}

function clearTask(creep: Creep): void {
  delete creep.memory.taskId;
  delete creep.memory.targetId;
  delete creep.memory.taskStart;
}

function setTask(creep: Creep, task: Omit<AssignedTask, "start">): void {
  creep.memory.taskId = task.type;
  creep.memory.targetId = task.targetId;
  creep.memory.taskStart = Game.time;
}

function runAssignedTask(creep: Creep, task: AssignedTask): void {
  if (Game.time - task.start > 50) {
    clearTask(creep);
    return;
  }

  if (task.type === "harvest") {
    const r = runHarvest(creep, task.targetId);
    if (r.status !== "running") clearTask(creep);
    return;
  }

  if (task.type === "transfer") {
    const r = runTransfer(creep, task.targetId);
    if (r.status !== "running") clearTask(creep);
    return;
  }

  if (task.type === "upgrade") {
    const r = runUpgrade(creep);
    if (r.status !== "running") clearTask(creep);
    return;
  }

  if (task.type === "build") {
    const r = runBuild(creep, task.targetId);
    if (r.status !== "running") clearTask(creep);
    return;
  }

  clearTask(creep);
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

function pickEnergyTargetId(creep: Creep): string | null {
  const spawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS, {
    filter: (s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
  if (spawn) return spawn.id;

  const extension = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_EXTENSION &&
      (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureExtension | null;

  return extension ? extension.id : null;
}

function pickConstructionSiteId(
  creep: Creep,
  assigned: Record<string, number>,
): string | null {
  const sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
  if (sites.length === 0) return null;

  const rcl = creep.room.controller?.level ?? 0;
  const existingByType: Partial<Record<BuildableStructureConstant, number>> =
    {};
  for (const s of creep.room.find(FIND_MY_STRUCTURES)) {
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
  const sources = creep.room.find(FIND_SOURCES);
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

function assignTask(
  creep: Creep,
  assigned: Record<string, number>,
  counts: { upgrade: number; build: number },
): { type: SupportedTask; targetId?: string } | null {
  const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);

  const ticksToDowngrade = creep.room.controller?.ticksToDowngrade;
  if (
    used > 0 &&
    ticksToDowngrade != null &&
    ticksToDowngrade < config.CONTROLLER.DOWNGRADE_CRITICAL
  ) {
    return { type: "upgrade" };
  }

  if (free > 0 && used === 0) {
    const sourceId = pickSourceId(creep, assigned);
    if (!sourceId) return null;
    assigned[sourceId] = (assigned[sourceId] ?? 0) + 1;
    return { type: "harvest", targetId: sourceId };
  }

  const needsRefill =
    creep.room.find(FIND_MY_SPAWNS, {
      filter: (s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    }).length > 0 ||
    creep.room.find(FIND_MY_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_EXTENSION &&
        (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    }).length > 0;

  if (used > 0 && needsRefill) {
    const targetId = pickEnergyTargetId(creep);
    if (!targetId) return { type: "upgrade" };
    if ((assigned[targetId] ?? 0) >= 1) {
      const siteId = pickConstructionSiteId(creep, assigned);
      if (siteId) {
        assigned[siteId] = (assigned[siteId] ?? 0) + 1;
        return { type: "build", targetId: siteId };
      }
      return { type: "upgrade" };
    }
    assigned[targetId] = (assigned[targetId] ?? 0) + 1;
    return { type: "transfer", targetId };
  }

  if (used > 0 && !needsRefill) {
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
  if (used === 0)
    return {
      type: "harvest",
      targetId: pickSourceId(creep, assigned) ?? undefined,
    };

  const targetId = pickEnergyTargetId(creep);
  if (targetId && (assigned[targetId] ?? 0) < 1) {
    assigned[targetId] = (assigned[targetId] ?? 0) + 1;
    return { type: "transfer", targetId };
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
      const creeps = room.find(FIND_MY_CREEPS);
      for (const creep of creeps) {
        const task = getTask(creep);
        if (!task) {
          const newTask = assignTask(creep, assigned, counts);
          if (newTask) {
            setTask(creep, newTask);
            if (newTask.type === "upgrade") counts.upgrade++;
            if (newTask.type === "build") counts.build++;
          }
          continue;
        }
        if (task.targetId)
          assigned[task.targetId] = (assigned[task.targetId] ?? 0) + 1;
        if (task.type === "upgrade") counts.upgrade++;
        if (task.type === "build") counts.build++;
        runAssignedTask(creep, task);
      }
    }
  }
}

processRegistry.register(RoomLogisticsProcess, "RoomLogisticsProcess");
