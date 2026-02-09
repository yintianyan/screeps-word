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

    // 1. 检查是否存在积压的孵化任务
    // 如果队列里已经有本房间的任务，先别生成新的，防止重复
    if (this.hasPendingTask(room.name)) return;

    // 2. 处理生命周期替换 (Lifecycle) - 最高优先级
    // Lifecycle 模块已经把请求放到了 Memory.lifecycle.requests
    // 我们负责搬运这些请求到 GlobalDispatch
    this.processLifecycleRequests(room);

    // 3. 处理常规人口缺口 (Population Gap)
    // 只有在没有处理 Lifecycle 请求时才进行（单线程产出）
    if (!this.hasPendingTask(room.name)) {
      this.processPopulationGaps(room);
    }
  }

  private static hasPendingTask(roomName: string): boolean {
    return Memory.dispatch.spawnQueue.some((t) => t.roomName === roomName);
  }

  private static processLifecycleRequests(room: Room) {
    const requests = Lifecycle.getRequests();
    for (const name in requests) {
      const req = requests[name];
      // 仅处理本房间的请求
      // 注意：Lifecycle 里的 requests key 是 creepName
      // 我们需要确认这个 creep 是属于本房间的
      // 但 creep 可能已经死了。所以我们需要在 request 里存 roomName?
      // 目前 Lifecycle 没存，但我们可以通过 Game.creeps[name]?.room.name 判断
      // 或者假设 Memory.creeps[name].room 存在

      // 简化：如果 Creep 还活着，检查房间。如果死了，检查 Memory。
      let requestRoom = Game.creeps[name]?.room.name;
      if (!requestRoom && Memory.creeps[name])
        requestRoom = Memory.creeps[name].room;

      if (requestRoom === room.name) {
        // 转换为 SpawnTask
        const body = populationModule.getBody(room, req.role);
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

        console.log(`[SpawnCenter] 🚨 批准生命周期替换: ${name} -> ${newName}`);
        GlobalDispatch.registerSpawnTask(task);

        // 通知 Lifecycle 请求已被接管 (避免重复处理)
        // 但 Lifecycle 的 notifySpawn 是在孵化成功后调用的
        // 这里我们先不动 requests，等 spawnManager 执行成功后再清理
        // 或者：我们可以现在就删掉 request，因为已经在 SpawnQueue 里了
        delete requests[name]; // 移除 Lifecycle 请求，防止重复
        return; // 一次只处理一个
      }
    }
  }

  private static processPopulationGaps(room: Room) {
    // 获取目标和现状
    const targets = populationModule.calculateTargets(room);
    const currentCounts = {};
    const creeps = room.find(FIND_MY_CREEPS);

    creeps.forEach((c) => {
      // 排除掉正在濒死且已经申请替换的 Creep?
      // 不，Lifecycle 已经处理了替换。这里只看绝对数量缺口。
      // 如果一个 Creep 濒死，它还在 currentCounts 里。
      // 如果它申请了替换，SpawnQueue 里会有任务，hasPendingTask 会拦截。
      // 所以这里只处理：还没死，也没申请替换，但数量就是不够的情况（比如意外死亡）。
      const role = c.memory.role;
      currentCounts[role] = (currentCounts[role] || 0) + 1;
    });

    // 优先级顺序
    const rolePriority = ["harvester", "hauler", "upgrader", "builder"];

    for (const role of rolePriority) {
      const target = targets[role] || 0;
      const current = currentCounts[role] || 0;

      if (current < target) {
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

        const body = populationModule.getBody(room, role);
        const newName =
          role.charAt(0).toUpperCase() + role.slice(1) + Game.time;

        const task: SpawnTask = {
          id: `SPAWN_${newName}`,
          roomName: room.name,
          role: role,
          priority:
            role === "harvester" ? TaskPriority.CRITICAL : TaskPriority.NORMAL,
          body: body,
          memory: memory,
          requestTime: Game.time,
        };

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
    const counts = {};
    creeps
      .filter((c) => c.memory.role === "harvester")
      .forEach((c) => {
        if (c.memory.sourceId)
          counts[c.memory.sourceId] = (counts[c.memory.sourceId] || 0) + 1;
      });

    // 找没人挖的矿
    for (const source of sources) {
      if (!counts[source.id]) return source.id;
    }
    return sources[0].id; // Fallback
  }
}
