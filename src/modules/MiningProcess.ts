import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { config } from "../config";
import { MinerTask } from "../tasks/MinerTask";
import { TransferTask } from "../tasks/TransferTask";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { PickupTask } from "../tasks/PickupTask";
import { tryReserve } from "../core/Reservation";

type SourcePlan = {
  containerPos?: { x: number; y: number };
  containerId?: string;
  lastPlan?: number;
};

type MineralPlan = {
  containerPos?: { x: number; y: number };
  containerId?: string;
  extractorId?: string;
};

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) rooms.push(room);
  }
  return rooms;
}

function ensureMining(room: Room): NonNullable<RoomMemory["mining"]> {
  if (!room.memory.mining) room.memory.mining = {};
  return room.memory.mining;
}

function isInsideRoom(x: number, y: number): boolean {
  return x >= 1 && x <= 48 && y >= 1 && y <= 48;
}

function pickContainerPosForSource(
  room: Room,
  source: Source | Mineral,
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
      if (
        structures.some(
          (s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_CONTAINER,
        )
      )
        continue;
      const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
      if (
        sites.some(
          (s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_CONTAINER,
        )
      )
        continue;

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

function planStaticHarvesting(room: Room): void {
  const rcl = room.controller?.level ?? 0;
  if (rcl < 3) return;
  if (Game.cpu.bucket < config.CPU.BUCKET_LIMIT) return;

  const mining = ensureMining(room);

  // Sources
  const sources = room.find(FIND_SOURCES);
  for (const source of sources) {
    const key = source.id;
    const plan = (mining[key] ?? {}) as SourcePlan;
    mining[key] = plan as never;

    if (plan.lastPlan != null && Game.time - plan.lastPlan < 200) continue;
    plan.lastPlan = Game.time;

    if (!plan.containerPos) {
      const p = pickContainerPosForSource(room, source);
      if (!p) continue;
      plan.containerPos = p;
    }

    const cp = plan.containerPos;
    const existing = getContainerAt(room, cp.x, cp.y);
    if (existing) {
      plan.containerId = existing.id;
      continue;
    }

    const site = getContainerSiteAt(room, cp.x, cp.y);
    if (site) continue;
    const pos = new RoomPosition(cp.x, cp.y, room.name);
    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    if (sites.length > 0) continue;

    room.createConstructionSite(cp.x, cp.y, STRUCTURE_CONTAINER);
  }

  // Minerals (RCL >= 6)
  if (rcl >= 6) {
    const minerals = room.find(FIND_MINERALS);
    for (const mineral of minerals) {
      const key = mineral.id;
      const plan = (mining[key] ?? {}) as MineralPlan;
      mining[key] = plan as never;

      // Extractor
      if (!plan.extractorId) {
        const extractors = mineral.pos
          .lookFor(LOOK_STRUCTURES)
          .filter((s) => s.structureType === STRUCTURE_EXTRACTOR);
        if (extractors.length > 0) {
          plan.extractorId = extractors[0].id;
        } else {
          room.createConstructionSite(mineral.pos, STRUCTURE_EXTRACTOR);
        }
      }

      // Container
      if (!plan.containerPos) {
        const p = pickContainerPosForSource(room, mineral);
        if (!p) continue;
        plan.containerPos = p;
      }

      const cp = plan.containerPos;
      const existing = getContainerAt(room, cp.x, cp.y);
      if (existing) {
        plan.containerId = existing.id;
      } else {
        const site = getContainerSiteAt(room, cp.x, cp.y);
        if (site) continue;
        const pos = new RoomPosition(cp.x, cp.y, room.name);
        const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
        if (sites.length > 0) continue;
        room.createConstructionSite(cp.x, cp.y, STRUCTURE_CONTAINER);
      }
    }
  }
}

function pickFillTargetId(creep: Creep): string | null {
  const spawns = creep.room.find(FIND_MY_SPAWNS, {
    filter: (s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
  for (const s of spawns) {
    if (tryReserve(s.id, creep.name, 1)) return s.id;
  }

  const towers = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_TOWER &&
      (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureTower[];
  towers.sort((a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b));
  for (const t of towers) {
    if (tryReserve(t.id, creep.name, 1)) return t.id;
  }

  const extensions = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_EXTENSION &&
      (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureExtension[];
  extensions.sort((a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b));
  for (const e of extensions) {
    if (tryReserve(e.id, creep.name, 1)) return e.id;
  }

  return null;
}

function getSourceContainer(
  room: Room,
  sourceId: string,
): StructureContainer | null {
  const plan = room.memory.mining?.[sourceId];
  const cid = plan?.containerId;
  if (cid) {
    const obj = Game.getObjectById(cid as Id<StructureContainer>);
    if (obj instanceof StructureContainer) return obj;
  }
  const cp = plan?.containerPos;
  if (!cp) return null;
  const c = getContainerAt(room, cp.x, cp.y);
  if (c && room.memory.mining?.[sourceId])
    room.memory.mining[sourceId].containerId = c.id;
  return c;
}

export class MiningProcess extends Process {
  public run(): void {
    for (const room of getMyRooms()) {
      planStaticHarvesting(room);

      // Miners
      const sources = room.find(FIND_SOURCES);
      const miners = room.find(FIND_MY_CREEPS, {
        filter: (c) => c.memory.role === "miner",
      });
      const minerAssigned: Record<string, number> = {};
      for (const m of miners) {
        const sid = m.memory.sourceId;
        if (sid) minerAssigned[sid] = (minerAssigned[sid] ?? 0) + 1;
      }
      for (const creep of miners) {
        if (creep.memory.taskId) {
          const taskPid = creep.memory.taskId;
          if (!this.kernel.getProcessType(taskPid)) {
            delete creep.memory.taskId;
          } else {
            continue;
          }
        }

        let sourceId = creep.memory.sourceId;
        if (!sourceId && sources.length > 0) {
          let bestId: string | null = null;
          let bestUsed = 999999;
          for (const s of sources) {
            const used = minerAssigned[s.id] ?? 0;
            if (used < bestUsed) {
              bestUsed = used;
              bestId = s.id;
            }
          }
          sourceId = bestId ?? undefined;
          if (sourceId) {
            creep.memory.sourceId = sourceId;
            minerAssigned[sourceId] = (minerAssigned[sourceId] ?? 0) + 1;
          }
        }

        if (sourceId) this.spawnTask(creep, "MinerTask", { sourceId });
      }

      // Haulers
      const haulers = room.find(FIND_MY_CREEPS, {
        filter: (c) => c.memory.role === "hauler",
      });
      for (const creep of haulers) {
        if (creep.memory.taskId) {
          const taskPid = creep.memory.taskId;
          if (!this.kernel.getProcessType(taskPid)) {
            delete creep.memory.taskId;
          } else {
            continue;
          }
        }

        const task = this.assignHaulerTask(creep, room);
        if (task) {
          this.spawnTask(creep, task.type, task.data);
        }
      }
    }
  }

  private assignHaulerTask(
    creep: Creep,
    room: Room,
  ): { type: string; data: Record<string, unknown> } | null {
    const sourceId = creep.memory.sourceId;
    // Check if sourceId refers to a Mineral
    // We assume memory.sourceId is set. If not, fallback to source logic (for now)

    // If sourceId is mineral, handle mineral logic
    if (sourceId) {
      const obj = Game.getObjectById(sourceId as Id<Source | Mineral>);
      if (obj instanceof Mineral) {
        return this.assignMineralHaulerTask(creep, room, obj);
      }
    }

    const sources = room.find(FIND_SOURCES);
    let pickedSourceId: string | null = sourceId ?? null;
    if (!pickedSourceId && sources.length > 0) {
      let h = 0;
      for (let i = 0; i < creep.name.length; i++) {
        h = (h * 31 + creep.name.charCodeAt(i)) | 0;
      }
      const idx = Math.abs(h) % sources.length;
      pickedSourceId = sources[idx]?.id ?? null;
    }
    if (!pickedSourceId) return null;
    creep.memory.sourceId = pickedSourceId;

    if (
      creep.memory.hauling &&
      creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0
    )
      creep.memory.hauling = false;
    if (
      !creep.memory.hauling &&
      creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    )
      creep.memory.hauling = true;

    if (creep.memory.hauling) {
      const rcl = room.controller?.level ?? 0;
      if (rcl >= 5) {
        const sourceObj = Game.getObjectById(pickedSourceId as Id<Source>);
        const sourceLinkIds = room.memory.links?.source ?? [];
        const sourceLink =
          (sourceObj instanceof Source
            ? (sourceLinkIds
                .map((id) => Game.getObjectById(id as Id<StructureLink>))
                .find(
                  (l): l is StructureLink =>
                    l instanceof StructureLink &&
                    l.pos.inRangeTo(sourceObj.pos, 2),
                ) ?? null)
            : null) ??
          sourceLinkIds
            .map((id) => Game.getObjectById(id as Id<StructureLink>))
            .find((l): l is StructureLink => l instanceof StructureLink) ??
          null;
        const hubId = room.memory.links?.hub;
        const hub =
          hubId != null ? Game.getObjectById(hubId as Id<StructureLink>) : null;
        if (sourceLink && hub instanceof StructureLink) {
          if (sourceLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            return { type: "TransferTask", data: { targetId: sourceLink.id } };
          }
        }
      }
      if (rcl >= 4 && room.storage) {
        return { type: "TransferTask", data: { targetId: room.storage.id } };
      }
      const id = pickFillTargetId(creep);
      if (id) return { type: "TransferTask", data: { targetId: id } };
      return null;
    }

    const container = getSourceContainer(room, pickedSourceId);
    if (container) {
      return { type: "WithdrawTask", data: { targetId: container.id } };
    }

    const source = Game.getObjectById(pickedSourceId as Id<Source>);
    if (source instanceof Source) {
      const drop = source.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
      })[0] as Resource<RESOURCE_ENERGY> | undefined;
      if (drop) {
        return { type: "PickupTask", data: { targetId: drop.id } };
      }
    }

    return null;
  }

  private assignMineralHaulerTask(
    creep: Creep,
    room: Room,
    mineral: Mineral,
  ): { type: string; data: Record<string, unknown> } | null {
    // Mineral haulers just take from container and put in Storage/Terminal
    if (creep.memory.hauling && creep.store.getUsedCapacity() === 0)
      creep.memory.hauling = false;
    if (!creep.memory.hauling && creep.store.getFreeCapacity() === 0)
      creep.memory.hauling = true;

    if (creep.memory.hauling) {
      // Prioritize Terminal if available and not full
      if (room.terminal && room.terminal.store.getFreeCapacity() > 0) {
        return { type: "TransferTask", data: { targetId: room.terminal.id } };
      }
      if (room.storage && room.storage.store.getFreeCapacity() > 0) {
        return { type: "TransferTask", data: { targetId: room.storage.id } };
      }
      return null;
    } else {
      const container = getSourceContainer(room, mineral.id);
      if (
        container &&
        container.store.getUsedCapacity(mineral.mineralType) > 0
      ) {
        return { type: "WithdrawTask", data: { targetId: container.id } };
      }
      // Pickup drops?
      const drop = mineral.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
        filter: (r) => r.resourceType === mineral.mineralType,
      })[0];
      if (drop) {
        return { type: "PickupTask", data: { targetId: drop.id } };
      }
      return null;
    }
  }

  private spawnTask(
    creep: Creep,
    type: string,
    data: Record<string, unknown>,
  ): void {
    const pid = `task_${creep.name}_${Game.time}_${Math.floor(Math.random() * 1000)}`;
    let process: Process | undefined;
    const priority = 50;

    switch (type) {
      case "MinerTask":
        process = new MinerTask(pid, this.pid, priority);
        break;
      case "TransferTask":
        process = new TransferTask(pid, this.pid, priority);
        break;
      case "WithdrawTask":
        process = new WithdrawTask(pid, this.pid, priority);
        break;
      case "PickupTask":
        process = new PickupTask(pid, this.pid, priority);
        break;
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

processRegistry.register(MiningProcess, "MiningProcess");
