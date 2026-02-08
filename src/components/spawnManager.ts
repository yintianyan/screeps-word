
import populationModule from "./populationManager";
import Lifecycle from "./roomManager";

/**
 * 模块：孵化器 (Spawner)
 * 处理所有 Creep 的孵化逻辑，包括生命周期替换和常规人口补充
 */
const spawnerModule = {
  run: function (room: Room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn || spawn.spawning) {
      // 可视化孵化状态
      if (spawn && spawn.spawning) {
        const spawningCreep = Game.creeps[spawn.spawning.name];
        spawn.room.visual.text(
          "🛠️" + spawningCreep.memory.role,
          spawn.pos.x + 1,
          spawn.pos.y,
          { align: "left", opacity: 0.8 },
        );
      }
      return;
    }

    // 1. 处理生命周期替换请求 (最高优先级)
    const lifecycleRequests = Lifecycle.getRequests();
    let bestRequest = null;
    let requestCreepName = null;

    for (const name in lifecycleRequests) {
      const req = lifecycleRequests[name];
      // 过滤请求：仅处理本房间的
      const dyingCreep = Game.creeps[name];
      if (dyingCreep && dyingCreep.room.name === room.name) {
        if (!bestRequest || req.priority > bestRequest.priority) {
          bestRequest = req;
          requestCreepName = name;
        }
      }
    }

    if (bestRequest) {
      // 使用新的动态 Body 生成逻辑
      const body = populationModule.getBody(room, bestRequest.role);
      const newName =
        bestRequest.role.charAt(0).toUpperCase() +
        bestRequest.role.slice(1) +
        Game.time;

      // 继承 Memory 但重置运作状态
      const newMemory = bestRequest.baseMemory;
      newMemory.predecessorId = requestCreepName; // 链接到旧 Creep
      delete newMemory.hauling; // 重置状态
      delete newMemory.upgrading;
      delete newMemory.building;
      delete newMemory._move; // 重置移动缓存

      const result = spawn.spawnCreep(body, newName, { memory: newMemory });

      if (result === OK) {
        console.log(
          `[Spawner] ♻️ 执行生命周期替换: ${requestCreepName} -> ${newName}`,
        );
        Lifecycle.notifySpawn(requestCreepName, newName);
        return; // 本 tick 结束
      }
    }

    // 2. 标准人口检查
    const creeps = room.find(FIND_MY_CREEPS);
    const counts = {
      harvester: 0,
      upgrader: 0,
      builder: 0,
      hauler: 0,
    };

    creeps.forEach((c) => {
      // 使用 Lifecycle 判断该 Creep 是否计入"活跃人口"
      if (Lifecycle.isOperational(c)) {
        if (counts[c.memory.role] !== undefined) {
          counts[c.memory.role]++;
        }
      }
    });

    const targets = populationModule.calculateTargets(room);

    // 紧急检查逻辑
    // 重新实现 main.js 中的“空置 Source”检查
    const sources = room.find(FIND_SOURCES);
    const harvesters = creeps.filter((c) => c.memory.role === "harvester");
    const sourceCounts = {};
    sources.forEach((s) => (sourceCounts[s.id] = 0));

    harvesters.forEach((c) => {
      if (c.memory.sourceId && Lifecycle.isOperational(c)) {
        sourceCounts[c.memory.sourceId]++;
      }
    });

    // 找到一个 Harvester 数量为 0 的 Source (目前目标是 1)
    let targetSource = sources.find((s) => sourceCounts[s.id] < 1);

    // === 孵化逻辑 ===
    // 优先顺序：Harvester -> Hauler -> Upgrader -> Builder
    // 此时不再需要手动计算 energyToUse，因为 getBody 会根据 Room 的 Energy Level 自动处理

    // 1. Harvester
    if (targetSource) {
      const body = populationModule.getBody(room, "harvester");
      const name = "Harvester" + Game.time;
      console.log(`[Spawner] 为 Source ${targetSource.id} 孵化 ${name}`);
      spawn.spawnCreep(body, name, {
        memory: { role: "harvester", sourceId: targetSource.id },
      });
      return;
    }

    // 紧急升级者 (Emergency Upgrader) - 防止降级
    if (counts.upgrader < 1 && room.controller.ticksToDowngrade < 4000) {
      spawn.spawnCreep(
        populationModule.getBody(room, "upgrader"),
        "Upgrader" + Game.time,
        {
          memory: { role: "upgrader" },
        },
      );
      return;
    }

    // 2. Hauler
    if (counts.hauler < targets.hauler && counts.harvester > 0) {
      const needs = populationModule.getHaulerNeeds(room);
      const haulers = creeps.filter((c) => c.memory.role === "hauler");
      const haulerCounts = {};
      haulers.forEach((c) => {
        if (c.memory.sourceId)
          haulerCounts[c.memory.sourceId] =
            (haulerCounts[c.memory.sourceId] || 0) + 1;
      });

      let bestSourceId = null;
      let maxDeficit = -999;
      for (const id in needs) {
        const deficit = needs[id] - (haulerCounts[id] || 0);
        if (deficit > maxDeficit) {
          maxDeficit = deficit;
          bestSourceId = id;
        }
      }
      if (!bestSourceId) bestSourceId = sources[0].id;

      spawn.spawnCreep(
        populationModule.getBody(room, "hauler"),
        "Hauler" + Game.time,
        {
          memory: { role: "hauler", sourceId: bestSourceId },
        },
      );
      return;
    }

    // 3. Upgrader
    if (counts.upgrader < targets.upgrader) {
      spawn.spawnCreep(
        populationModule.getBody(room, "upgrader"),
        "Upgrader" + Game.time,
        {
          memory: { role: "upgrader" },
        },
      );
      return;
    }

    // 4. Builder
    if (counts.builder < targets.builder) {
      spawn.spawnCreep(
        populationModule.getBody(room, "builder"),
        "Builder" + Game.time,
        {
          memory: { role: "builder" },
        },
      );
      return;
    }
  },
};

export default spawnerModule;
