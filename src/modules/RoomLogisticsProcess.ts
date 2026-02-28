import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { TaskType } from "../tasks/types";
import { runHarvest } from "../tasks/impl/harvest";
import { runTransfer } from "../tasks/impl/transfer";
import { runUpgrade } from "../tasks/impl/upgrade";

type SupportedTask = Extract<TaskType, "harvest" | "transfer" | "upgrade">;
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
  if (taskId !== "harvest" && taskId !== "transfer" && taskId !== "upgrade")
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
): { type: SupportedTask; targetId?: string } | null {
  const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);

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
    if ((assigned[targetId] ?? 0) >= 1) return { type: "upgrade" };
    assigned[targetId] = (assigned[targetId] ?? 0) + 1;
    return { type: "transfer", targetId };
  }
  if (used > 0 && !needsRefill) return { type: "upgrade" };
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
  return { type: "upgrade" };
}

export class RoomLogisticsProcess extends Process {
  public run(): void {
    const assigned: Record<string, number> = {};
    for (const room of getMyRooms()) {
      const creeps = room.find(FIND_MY_CREEPS);
      for (const creep of creeps) {
        const task = getTask(creep);
        if (!task) {
          const newTask = assignTask(creep, assigned);
          if (newTask) setTask(creep, newTask);
          continue;
        }
        if (task.targetId)
          assigned[task.targetId] = (assigned[task.targetId] ?? 0) + 1;
        runAssignedTask(creep, task);
      }
    }
  }
}

processRegistry.register(RoomLogisticsProcess, "RoomLogisticsProcess");
