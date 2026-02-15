import { GlobalDispatch } from "../ai/GlobalDispatch";
import { SpawnTask, TaskPriority } from "../types/dispatch";
import populationModule from "../components/populationManager";
import Lifecycle from "../components/roomManager";
import Cache from "../components/memoryManager";

/**
 * 孵化指挥中心 (SpawnCenter)
 * 职责：
 * 1. 统一收集所有孵化需求（常规人口 + 生命周期替换）。
 * 2. 转化为标准化的 SpawnTask。
 * 3. 提交给 GlobalDispatch 进行排序和分发。
 */
export class SpawnCenter {
  static run(room: Room) {
    if (Game.time % 5 !== 0) return; // 每 5 ticks 运行一次，节省 CPU

    // [Rule 4] Maintain Priority Queue Logic (In Memory)
    if (!room.memory.spawnQueue) room.memory.spawnQueue = [];

    // 1. 检查是否存在积压的孵化任务
    // [FIX] Anti-Duplication: If queue has pending task for this room, do not generate new ones blindly.
    // However, we might have multiple tasks for DIFFERENT roles.
    // So we should check if we can process gap for a role that is NOT in queue.
    // For simplicity, let's keep single-threaded for now but refine the check.
    // if (this.hasPendingTask(room.name)) return; // <-- REMOVED strict blocking

    // 2. 处理生命周期替换 (Lifecycle) - 最高优先级
    this.processLifecycleRequests(room);

    // 3. 处理常规人口缺口 (Population Gap)
    this.processPopulationGaps(room);
  }

  // [Rule 2] Redundancy Check Helper
  private static isRoleRedundant(room: Room, role: string): boolean {
    if (role === "harvester") {
      // Check Room.memory.harvesters
      if (room.memory.harvesters) {
        const totalWork = room.memory.harvesters.reduce(
          (sum: number, h: any) => sum + h.workParts,
          0,
        );
        const sources = room.find(FIND_SOURCES).length;
        if (totalWork >= sources * 3) return true; // Lock if saturated
      }
    }
    return false;
  }

  // Helper to check if a specific role is already queued
  private static isRoleQueued(roomName: string, role: string): boolean {
    const globalQueue = Memory.dispatch.spawnQueue || [];
    const localQueue = Memory.rooms[roomName].spawnQueue || [];

    const inGlobal = globalQueue.some(
      (t) => t.roomName === roomName && t.role === role,
    );
    const inLocal = localQueue.some((t: any) => t.role === role);

    return inGlobal || inLocal;
  }

  private static hasPendingTask(roomName: string): boolean {
    return Memory.dispatch.spawnQueue.some((t) => t.roomName === roomName);
  }

  private static processLifecycleRequests(room: Room) {
    const requests = Lifecycle.getRequests();
    for (const name in requests) {
      const req = requests[name];
      // 仅处理本房间的请求
      // ... (省略部分注释)
      let requestRoom = Game.creeps[name]?.room.name;
      if (!requestRoom && Memory.creeps[name])
        requestRoom = Memory.creeps[name].room;

      if (requestRoom === room.name) {
        // [Greedy Logic]
        // 检查房间状态：如果是 CRITICAL (能源危机)，则使用当前能量 (false)
        // 否则使用最大容量 (true) 来尝试孵化最好的 Creep
        const energyLevel = populationModule.getEnergyLevel(room);
        const forceMax = energyLevel !== "CRITICAL";

        // 转换为 SpawnTask
        const body = populationModule.getBody(room, req.role, forceMax);
        const newName =
          req.role.charAt(0).toUpperCase() + req.role.slice(1) + Game.time;

        // 构造新 Memory
        const newMemory = { ...req.baseMemory };
        newMemory.predecessorId = name;
        delete newMemory.hauling;
        delete newMemory.working;
        delete newMemory.building;
        delete newMemory.upgrading;
        delete newMemory._move;

        const task: SpawnTask = {
          id: `SPAWN_${newName}`,
          roomName: room.name,
          role: req.role,
          priority: TaskPriority.CRITICAL, // 替换总是最紧急的
          body: body,
          memory: newMemory,
          requestTime: Game.time,
        };

        const cost = populationModule.calculateBodyCost(body);
        const waitStatus =
          forceMax && room.energyAvailable < cost ? " (Waiting for fill)" : "";
        console.log(
          `[SpawnCenter] 🚨 批准生命周期替换: ${name} -> ${newName} [Cost: ${cost}]${waitStatus}`,
        );

        GlobalDispatch.registerSpawnTask(task);

        // 通知 Lifecycle 请求已被接管 (避免重复处理)
        delete requests[name]; // 移除 Lifecycle 请求，防止重复
        return; // 一次只处理一个
      }
    }
  }

  private static processPopulationGaps(room: Room) {
    const targets = populationModule.calculateTargets(room);

    const currentCounts = {};
    const creeps = room.find(FIND_MY_CREEPS);

    creeps.forEach((c) => {
      const role = c.memory.role;
      currentCounts[role] = (currentCounts[role] || 0) + 1;
    });

    const roleList = Object.keys(targets).filter((r) => (targets[r] || 0) > 0);

    const tasks = Memory.dispatch?.tasks ? Object.values(Memory.dispatch.tasks) : [];
    const roleToBestTaskPriority = new Map<string, TaskPriority>();
    for (const t of tasks) {
      if (!t || !t.validRoles || t.validRoles.length === 0) continue;
      if (!t.creepsAssigned) t.creepsAssigned = [];
      if (t.creepsAssigned.length >= t.maxCreeps) continue;
      const role = t.validRoles[0];
      const prev = roleToBestTaskPriority.get(role);
      if (prev === undefined || t.priority < prev) roleToBestTaskPriority.set(role, t.priority);
    }

    const energyAvailable = room.energyAvailable;
    const dynamicOrder = roleList
      .map((role) => {
        const target = targets[role] || 0;
        const current = currentCounts[role] || 0;
        const deficit = Math.max(0, target - current);
        let priority: TaskPriority = TaskPriority.NORMAL;
        if ((role === "harvester" || role === "hauler") && current === 0) {
          priority = TaskPriority.CRITICAL;
        } else {
          const best = roleToBestTaskPriority.get(role);
          if (best !== undefined) priority = best;
          else if (role === "harvester") priority = TaskPriority.MEDIUM;
          else if (role === "builder") priority = TaskPriority.LOW;
          else if (role === "scout") priority = TaskPriority.IDLE;
          else if (role === "upgrader" && energyAvailable < 300) priority = TaskPriority.HIGH;
        }
        return { role, priority, deficit };
      })
      .filter((x) => x.deficit > 0)
      .sort((a, b) => a.priority - b.priority || b.deficit - a.deficit);

    for (const item of dynamicOrder) {
      const role = item.role;
      const target = targets[role] || 0;
      const current = currentCounts[role] || 0;

      if (current < target) {
        // [Rule 2] Redundancy Check
        if (this.isRoleRedundant(room, role)) {
          console.log(
            `[SpawnCenter] 🔒 通道锁定: ${role} 已饱和 (Redundancy Check)`,
          );
          continue;
        }

        // [Fix] Anti-Duplication Check
        if (this.isRoleQueued(room.name, role)) {
          // console.log(`[SpawnCenter] ⏳ 等待队列: ${role} 已在队列中`);
          continue;
        }

        // 发现缺口！
        console.log(
          `[SpawnCenter] 📉 发现人口缺口: ${role} (${current}/${target})`,
        );

        // 特殊逻辑：Hauler 的 SourceID 分配
        let memory: any = { role: role, room: room.name };
        if (role === "hauler") {
          const bestSourceId = this.findBestSourceForHauler(room, creeps);
          if (bestSourceId) memory.sourceId = bestSourceId;
        } else if (role === "harvester") {
          const bestSourceId = this.findBestSourceForHarvester(room, creeps);
          if (bestSourceId) memory.sourceId = bestSourceId;
        }

        // [Greedy Logic]
        // 如果是补充人口，特别是 Hauler/Upgrader，我们希望质量高一点
        // 只有 Harvester 在数量为 0 时需要急救 (false)
        // 其他情况尽量贪婪 (true)
        const energyLevel = populationModule.getEnergyLevel(room);
        let forceMax = energyLevel !== "CRITICAL";

        // 如果 Harvester 挂光了，必须立即孵化，不能等
        if (role === "harvester" && current === 0) forceMax = false;
        // 如果 Hauler 挂光了，也不能等
        if (role === "hauler" && current === 0) forceMax = false;

        const body = populationModule.getBody(room, role, forceMax);

        // [Rule 1.3] If body is null (banned), abort
        if (!body) {
          console.log(
            `[SpawnCenter] ⛔ 孵化拒绝: ${role} (Body Check Failed - Low Energy)`,
          );
          continue;
        }

        const newName =
          role.charAt(0).toUpperCase() + role.slice(1) + Game.time;

        let priority = item.priority;
        if (current === 0 && (role === "harvester" || role === "hauler")) priority = TaskPriority.CRITICAL;

        const task: SpawnTask = {
          id: `SPAWN_${newName}`,
          roomName: room.name,
          role: role,
          priority: priority,
          body: body,
          memory: memory,
          requestTime: Game.time,
        };

        const cost = populationModule.calculateBodyCost(body);
        const waitStatus =
          forceMax && room.energyAvailable < cost ? " (Waiting for fill)" : "";
        console.log(
          `[SpawnCenter] 🆕 批准人口补充: ${role} [Cost: ${cost}]${waitStatus}`,
        );

        GlobalDispatch.registerSpawnTask(task);
        return; // 一次一个
      }
    }
  }

  private static findBestSourceForHauler(room: Room, creeps: Creep[]): string {
    // 简化的逻辑：找 Hauler 最少的 Source
    const sources = room.find(FIND_SOURCES);
    const needs = populationModule.getHaulerNeeds(room);
    const counts = {};

    creeps
      .filter((c) => c.memory.role === "hauler")
      .forEach((c) => {
        if (c.memory.sourceId)
          counts[c.memory.sourceId] = (counts[c.memory.sourceId] || 0) + 1;
      });

    let bestSource = sources[0].id;
    let maxDeficit = -999;

    for (const source of sources) {
      const needed = needs[source.id] || 0;
      const existing = counts[source.id] || 0;
      const deficit = needed - existing;

      if (deficit > maxDeficit) {
        maxDeficit = deficit;
        bestSource = source.id;
      }
    }
    return bestSource;
  }

  private static findBestSourceForHarvester(
    room: Room,
    creeps: Creep[],
  ): string {
    const sources = room.find(FIND_SOURCES);
    const counts: Record<string, number> = {};
    
    // Count existing creeps
    creeps
      .filter((c) => c.memory.role === "harvester")
      .forEach((c) => {
        if (c.memory.sourceId)
          counts[c.memory.sourceId] = (counts[c.memory.sourceId] || 0) + 1;
      });

    // Count queued creeps
    const spawnQueue = Memory.dispatch.spawnQueue || [];
    spawnQueue.forEach(task => {
        if (task.roomName === room.name && task.role === "harvester" && task.memory && task.memory.sourceId) {
             counts[task.memory.sourceId] = (counts[task.memory.sourceId] || 0) + 1;
        }
    });

    // 找没人挖的矿
    for (const source of sources) {
      if (!counts[source.id]) return source.id;
    }
    
    // Fallback: Return the one with minimum count
    let minSource = sources[0];
    let minCount = counts[sources[0].id] || 0;
    
    for (const source of sources) {
        const count = counts[source.id] || 0;
        if (count < minCount) {
            minCount = count;
            minSource = source;
        }
    }
    return minSource.id;
  }
}
