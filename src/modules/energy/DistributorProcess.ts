import { Process } from "../../core/Process";
import { processRegistry } from "../../core/ProcessRegistry";
import { tryReserve } from "../../core/Reservation";
import { Cache } from "../../core/Cache";
import StructureCache from "../../utils/structureCache";
import { TransferTask } from "../../tasks/TransferTask";
import { WithdrawTask } from "../../tasks/WithdrawTask";

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) rooms.push(room);
  }
  return rooms;
}

function getCreeps(room: Room): Creep[] {
  return StructureCache.getCreeps(room, "distributor").filter(
    (c) => c.memory.homeRoom === room.name,
  );
}

function getLink(room: Room, key: "hub" | "controller"): StructureLink | null {
  const id = room.memory.links?.[key];
  if (!id) return null;
  const obj = Game.getObjectById(id as Id<StructureLink>);
  return obj instanceof StructureLink ? obj : null;
}

function pickFillTarget(room: Room, creepName: string): Id<Structure> | null {
  const targets = Cache.getTick(`dp:fillTargets:${room.name}`, () => {
    const result: Array<Id<Structure>> = [];

    const spawns = StructureCache.getMyStructures(
      room,
      STRUCTURE_SPAWN,
    ) as StructureSpawn[];
    for (const s of spawns) {
      if (s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) result.push(s.id);
    }

    const extensions = StructureCache.getMyStructures(
      room,
      STRUCTURE_EXTENSION,
    ) as StructureExtension[];
    for (const e of extensions) {
      if (e.store.getFreeCapacity(RESOURCE_ENERGY) > 0) result.push(e.id);
    }

    const towers = StructureCache.getMyStructures(
      room,
      STRUCTURE_TOWER,
    ) as StructureTower[];
    for (const t of towers) {
      if (t.store.getFreeCapacity(RESOURCE_ENERGY) > 0) result.push(t.id);
    }

    return result;
  });

  for (const id of targets) {
    if (tryReserve(id, creepName, 1)) return id;
  }

  return null;
}

export class DistributorProcess extends Process {
  public run(): void {
    for (const room of getMyRooms()) {
      const creeps = getCreeps(room).sort((a, b) => a.name.localeCompare(b.name));
      
      for (const creep of creeps) {
          if (creep.memory.taskId) {
              const taskPid = creep.memory.taskId;
              if (!this.kernel.getProcessType(taskPid)) {
                  delete creep.memory.taskId;
              } else {
                  continue;
              }
          }

          const task = this.assignDistributorTask(creep, room);
          if (task) {
              this.spawnTask(creep, task.type, task.data, task.priority);
          }
      }
    }
  }

  private assignDistributorTask(
    creep: Creep,
    room: Room,
  ):
    | {
        type: "TransferTask" | "WithdrawTask";
        data: Record<string, unknown>;
        priority: number;
      }
    | null {
      if (creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0)
        creep.memory.working = false;
      if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0)
        creep.memory.working = true;

      const hub = getLink(room, "hub");
      const controller = getLink(room, "controller");
      const storage = room.storage;

      if (creep.memory.working) {
          const fillTarget = pickFillTarget(room, creep.name);
          if (fillTarget) {
              return { type: "TransferTask", data: { targetId: fillTarget }, priority: 90 };
          }

          const needsControllerRefill = controller && controller.store.getUsedCapacity(RESOURCE_ENERGY) < 400 && 
                                        hub && hub.store.getUsedCapacity(RESOURCE_ENERGY) < 600 &&
                                        storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 5000;
          
          if (needsControllerRefill && hub) {
              return { type: "TransferTask", data: { targetId: hub.id }, priority: 80 };
          }

          if (storage) {
              return { type: "TransferTask", data: { targetId: storage.id }, priority: 70 };
          }
          
          return null;
      } else {
          if (storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
              return { type: "WithdrawTask", data: { targetId: storage.id }, priority: 80 };
          }
          
          if (hub && hub.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
               return { type: "WithdrawTask", data: { targetId: hub.id }, priority: 75 };
          }
          
          const containers = StructureCache.getStructures(
            room,
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
          if (best) return { type: "WithdrawTask", data: { targetId: best.id }, priority: 70 };
          
          return null;
      }
  }

  private spawnTask(
    creep: Creep,
    type: "TransferTask" | "WithdrawTask",
    data: Record<string, unknown>,
    priority: number,
  ): void {
      const pid = `task_${creep.name}_${Game.time}_${Math.floor(Math.random()*1000)}`;
      let process: Process | undefined;
      
      switch (type) {
          case "TransferTask": process = new TransferTask(pid, this.pid, priority); break;
          case "WithdrawTask": process = new WithdrawTask(pid, this.pid, priority); break;
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

processRegistry.register(DistributorProcess, "DistributorProcess");
