import { Process } from "../../core/Process";
import { processRegistry } from "../../core/ProcessRegistry";
import { config } from "../../config";
import { tryReserve } from "../../core/Reservation";
import { Cache } from "../../core/Cache";
import { Debug } from "../../core/Debug";
import StructureCache from "../../utils/structureCache";
import { TransferTask } from "../../tasks/TransferTask";
import { WithdrawTask } from "../../tasks/WithdrawTask";
import { smartMove } from "../../tasks/move/smartMove";

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

function pickFillTarget(room: Room, creep: Creep): Id<Structure> | null {
  const spawns = StructureCache.getMyStructures(
    room,
    STRUCTURE_SPAWN,
  ) as StructureSpawn[];
  const extensions = StructureCache.getMyStructures(
    room,
    STRUCTURE_EXTENSION,
  ) as StructureExtension[];

  // Priority 1: Spawns & Extensions
  const primaryTargets: Structure[] = [];
  for (const s of spawns) {
    if (s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) primaryTargets.push(s);
  }
  for (const e of extensions) {
    if (e.store.getFreeCapacity(RESOURCE_ENERGY) > 0) primaryTargets.push(e);
  }

  if (primaryTargets.length > 0) {
    primaryTargets.sort(
      (a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b),
    );
    for (const t of primaryTargets) {
      if (tryReserve(t.id, creep.name, 1)) return t.id as Id<Structure>;
    }
  }

  // Priority 2: Towers
  const towers = StructureCache.getMyStructures(
    room,
    STRUCTURE_TOWER,
  ) as StructureTower[];
  const towerTargets: StructureTower[] = [];
  for (const t of towers) {
    if (t.store.getFreeCapacity(RESOURCE_ENERGY) > 0) towerTargets.push(t);
  }

  if (towerTargets.length > 0) {
    towerTargets.sort(
      (a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b),
    );
    for (const t of towerTargets) {
      if (tryReserve(t.id, creep.name, 1)) return t.id;
    }
  }

  return null;
}

function pickEnergyDumpTarget(
  room: Room,
  creepName: string,
): Id<Structure> | null {
  const storage = room.storage;
  if (
    storage &&
    storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
    tryReserve(storage.id, creepName, 5)
  )
    return storage.id;

  const containers = StructureCache.getStructures(
    room,
    STRUCTURE_CONTAINER,
  ) as StructureContainer[];
  for (const c of containers) {
    if (c.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) continue;
    if (tryReserve(c.id, creepName, 2)) return c.id;
  }

  const hubId = room.memory.links?.hub;
  if (hubId) {
    const obj = Game.getObjectById(hubId as Id<StructureLink>);
    if (
      obj instanceof StructureLink &&
      obj.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
      tryReserve(obj.id, creepName, 2)
    )
      return obj.id;
  }

  return null;
}

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/**
 * 计算 Distributor 的停车位置
 *
 * 为了避免 Distributor 在没有任务时堵塞关键路口（如 Storage 或 Link 周围），
 * 我们根据 creep 的名字哈希分配一个固定的停车位。
 *
 * 策略：
 * 1. 以 Hub Link 或 Storage 为中心，搜索 5x5 范围内的可行走位置。
 * 2. 排除墙壁、路、容器和其他 creep 已经占用的位置（除了 rampart）。
 * 3. 将可行位置按距离排序。
 * 4. 使用 creep 名字的哈希值选择一个位置，确保同一个 creep 总是去同一个位置。
 */
function getHubParkingPos(room: Room, creepName: string): RoomPosition | null {
  const hub = getLink(room, "hub");
  const anchor = hub?.pos ?? room.storage?.pos;
  if (!anchor) return null;
  const terrain = room.getTerrain();
  const candidates: RoomPosition[] = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (x <= 1 || x >= 48 || y <= 1 || y >= 48) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      const pos = new RoomPosition(x, y, room.name);
      const blocked = pos
        .lookFor(LOOK_STRUCTURES)
        .some(
          (s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_CONTAINER &&
            (s.structureType !== STRUCTURE_RAMPART ||
              !(s as StructureRampart).my),
        );
      if (blocked) continue;
      candidates.push(pos);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const da = a.getRangeTo(anchor);
    const db = b.getRangeTo(anchor);
    if (da !== db) return da - db;
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  });
  const idx = Math.abs(hashString(creepName)) % candidates.length;
  return candidates[idx];
}

/**
 * Distributor 进程
 *
 * 负责管理房间内的能量分发。Distributor 是高级物流单位，通常在 RCL 4+ 出现。
 *
 * 主要职责：
 * 1. 从 Storage/Link/Container 取出能量。
 * 2. 填充 Spawns/Extensions/Towers (优先级最高)。
 * 3. 填充 Controller Link (用于 Upgrader)。
 * 4. 将多余能量存入 Storage。
 * 5. 无任务时在 Hub 周围待命。
 */
export class DistributorProcess extends Process {
  public run(): void {
    for (const room of getMyRooms()) {
      const creeps = getCreeps(room).sort((a, b) =>
        a.name.localeCompare(b.name),
      );

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
        } else {
          const parking = getHubParkingPos(room, creep.name);
          if (parking && creep.pos.getRangeTo(parking) > 0) {
            smartMove(creep, parking, { range: 0, reusePath: 20 });
          }
        }
      }
    }
  }

  /**
   * 分配 Distributor 任务
   *
   * 决策逻辑：
   * 1. 状态切换：背包空了 -> 取能；背包满了 -> 工作。
   *
   * 工作状态 (Working):
   * - 优先级 1 (90): 填充 Spawn/Extension/Tower (维持生产和防御)。
   * - 优先级 2 (80): 填充 Hub Link (如果有 Controller Link 且需要能量)。
   * - 优先级 3 (70): 将多余能量存入 Storage。
   *
   * 取能状态 (Not Working):
   * - 优先级 1 (80): 从 Hub Link 取能 (Link 满了需要清空)。
   * - 优先级 2 (75): 从 Storage 取能 (通常是主力能量源)。
   * - 优先级 3 (70): 从 Container 取能 (兜底)。
   */
  private assignDistributorTask(
    creep: Creep,
    room: Room,
  ): {
    type: "TransferTask" | "WithdrawTask";
    data: Record<string, unknown>;
    priority: number;
  } | null {
    if (
      creep.memory.working &&
      creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0
    ) {
      creep.memory.working = false;
      delete creep.memory.sourceType;
    }
    if (
      !creep.memory.working &&
      creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    )
      creep.memory.working = true;

    const hub = getLink(room, "hub");
    const controller = getLink(room, "controller");
    const storage = room.storage;

    const needsControllerRefill =
      controller &&
      controller.store.getUsedCapacity(RESOURCE_ENERGY) < 400 &&
      hub &&
      hub.store.getUsedCapacity(RESOURCE_ENERGY) < 600 &&
      storage &&
      storage.store.getUsedCapacity(RESOURCE_ENERGY) > 5000;

    if (creep.memory.working) {
      const fillTarget = pickFillTarget(room, creep);
      if (fillTarget) {
        return {
          type: "TransferTask",
          data: { targetId: fillTarget },
          priority: 90,
        };
      }

      if (needsControllerRefill && hub) {
        return {
          type: "TransferTask",
          data: { targetId: hub.id },
          priority: 80,
        };
      }

      // Optimization: Do not dump back to storage if we just withdrew from it
      if (creep.memory.sourceType !== "storage") {
        const dumpTarget = pickEnergyDumpTarget(room, creep.name);
        if (dumpTarget) {
          return {
            type: "TransferTask",
            data: { targetId: dumpTarget },
            priority: 70,
          };
        }
      }

      return null;
    } else {
      // Only withdraw from Hub if we are NOT trying to refill controller
      if (
        !needsControllerRefill &&
        hub &&
        hub.store.getUsedCapacity(RESOURCE_ENERGY) > 0
      ) {
        creep.memory.sourceType = "link";
        return {
          type: "WithdrawTask",
          data: { targetId: hub.id },
          priority: 80,
        };
      }

      // Only withdraw from storage if there is demand (fill targets or controller link)
      // We can check if pickFillTarget returns something, but that's expensive to call twice?
      // We rely on the fact that if we are here, we are not full.
      // Optimization: Check if we actually need energy for non-storage targets.
      const hasDemand =
        pickFillTarget(room, creep) !== null || needsControllerRefill;

      if (
        hasDemand &&
        storage &&
        storage.store.getUsedCapacity(RESOURCE_ENERGY) >
          config.POPULATION.STORAGE.DISTRIBUTOR_WITHDRAW_MIN
      ) {
        creep.memory.sourceType = "storage";
        return {
          type: "WithdrawTask",
          data: { targetId: storage.id },
          priority: 75,
        };
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
      if (best) {
        creep.memory.sourceType = "container";
        return {
          type: "WithdrawTask",
          data: { targetId: best.id },
          priority: 70,
        };
      }

      return null;
    }
  }

  private spawnTask(
    creep: Creep,
    type: "TransferTask" | "WithdrawTask",
    data: Record<string, unknown>,
    priority: number,
  ): void {
    const pid = `task_${creep.name}_${Game.time}_${Math.floor(Math.random() * 1000)}`;
    let process: Process | undefined;

    switch (type) {
      case "TransferTask":
        process = new TransferTask(pid, this.pid, priority);
        break;
      case "WithdrawTask":
        process = new WithdrawTask(pid, this.pid, priority);
        break;
    }

    if (process) {
      this.kernel.addProcess(process);
      const mem = this.kernel.getProcessMemory(pid);
      mem.creepName = creep.name;
      Object.assign(mem, data);
      creep.memory.taskId = pid;
      Debug.event(
        "task_assigned",
        {
          taskPid: pid,
          taskType: process.constructor.name,
          targetId: (data as any).targetId,
        },
        { creep: creep.name, room: creep.room.name, pid },
      );
    }
  }
}

processRegistry.register(DistributorProcess, "DistributorProcess");
