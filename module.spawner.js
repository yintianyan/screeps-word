const populationModule = require("module.population");
const Lifecycle = require("module.lifecycle");

/**
 * 模块：孵化器 (Spawner)
 * 处理所有 Creep 的孵化逻辑，包括生命周期替换和常规人口补充
 */
const spawnerModule = {
  run: function (room) {
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
      // 过滤请求：仅处理本房间的（假设是全局 Memory，需要检查 Creep 所属房间）
      // 理想情况下，我们检查濒死 Creep 是否属于当前房间
      const dyingCreep = Game.creeps[name];
      if (dyingCreep && dyingCreep.room.name === room.name) {
        if (!bestRequest || req.priority > bestRequest.priority) {
          bestRequest = req;
          requestCreepName = name;
        }
      }
    }

    if (bestRequest) {
      const energyAvailable = room.energyAvailable;
      const energyCapacity = room.energyCapacityAvailable;

      // 确定能量预算 (如果是 Harvester 则可能触发紧急模式)
      // 使用 Lifecycle.isOperational 正确检测是否实际上已经没有运作中的 Harvester 了
      const operationalHarvesters = room.find(FIND_MY_CREEPS, {
        filter: (c) =>
          c.memory.role === "harvester" && Lifecycle.isOperational(c),
      });
      const isEmergency =
        bestRequest.role === "harvester" && operationalHarvesters.length <= 1;
      const energyToUse = isEmergency ? energyAvailable : energyCapacity;

      const body = this.getBody(energyToUse, bestRequest.role);
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
    // 使用 Lifecycle.isOperational 计数，避免将正在被替换的 Creep 重复计算
    const creeps = room.find(FIND_MY_CREEPS);
    const counts = {
      harvester: 0,
      upgrader: 0,
      builder: 0,
      hauler: 0,
    };

    creeps.forEach((c) => {
      // 使用 Lifecycle 判断该 Creep 是否计入“活跃人口”
      if (Lifecycle.isOperational(c)) {
        if (counts[c.memory.role] !== undefined) {
          counts[c.memory.role]++;
        }
      }
    });

    const targets = populationModule.calculateTargets(room);

    // 孵化逻辑
    const energyAvailable = room.energyAvailable;
    const energyCapacity = room.energyCapacityAvailable;

    // 紧急检查逻辑：确定使用的能量
    // 如果没有 Harvester 或资源点空置，使用当前可用能量
    let hasEmptySource = false;

    if (counts.harvester < targets.harvester) {
      // 确定能量预算
      // 如果任何 Source 没有 Harvester，使用当前能量
      // 重新实现 main.js 中的“空置 Source”检查
      const sources = room.find(FIND_SOURCES);
      const harvesters = creeps.filter((c) => c.memory.role === "harvester");
      const sourceCounts = {};
      sources.forEach((s) => (sourceCounts[s.id] = 0));

      // 使用 Lifecycle.isOperational 进行计数
      harvesters.forEach((c) => {
        if (c.memory.sourceId && Lifecycle.isOperational(c)) {
          sourceCounts[c.memory.sourceId]++;
        }
      });

      // 找到一个 Harvester 数量为 0 的 Source (目前目标是 1)
      let targetSource = sources.find((s) => sourceCounts[s.id] < 1);
      let hasEmpty = sources.some((s) => sourceCounts[s.id] === 0);

      const energyToUse =
        counts.harvester === 0 || hasEmpty ? energyAvailable : energyCapacity;

      if (targetSource) {
        const body = this.getBody(energyToUse, "harvester");
        const name = "Harvester" + Game.time;
        console.log(`[Spawner] 为 Source ${targetSource.id} 孵化 ${name}`);
        spawn.spawnCreep(body, name, {
          memory: { role: "harvester", sourceId: targetSource.id },
        });
        return;
      }
    }

    // 紧急升级者 (Emergency Upgrader)
    if (counts.upgrader < 1 && room.controller.ticksToDowngrade < 4000) {
      spawn.spawnCreep(
        this.getBody(energyAvailable, "upgrader"),
        "Upgrader" + Game.time,
        {
          memory: { role: "upgrader" },
        },
      );
      return;
    }

    // 搬运工 (Hauler)
    if (counts.hauler < targets.hauler && counts.harvester > 0) {
      // 智能分配 Source 给 Hauler
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
        this.getBody(energyAvailable, "hauler"),
        "Hauler" + Game.time,
        {
          memory: { role: "hauler", sourceId: bestSourceId },
        },
      );
      return;
    }

    // 升级者 (Upgrader)
    if (counts.upgrader < targets.upgrader) {
      spawn.spawnCreep(
        this.getBody(energyCapacity, "upgrader"),
        "Upgrader" + Game.time,
        {
          memory: { role: "upgrader" },
        },
      );
      return;
    }

    // 建造者 (Builder)
    if (counts.builder < targets.builder) {
      spawn.spawnCreep(
        this.getBody(energyCapacity, "builder"),
        "Builder" + Game.time,
        {
          memory: { role: "builder" },
        },
      );
      return;
    }
  },

  /**
   * 根据能量容量和角色类型生成身体部件数组
   * @param {number} capacity 可用能量容量
   * @param {string} role 角色名称
   */
  getBody: function (capacity, role) {
    // 逻辑复制自 main.js
    if (role === "hauler") {
      if (capacity >= 300) return [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE];
      return [CARRY, CARRY, MOVE];
    }
    if (role === "harvester") {
      if (capacity >= 1100)
        return [
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          CARRY,
          MOVE,
        ];
      if (capacity >= 900)
        return [WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
      if (capacity >= 700)
        return [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
      if (capacity >= 600) return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
      if (capacity >= 500) return [WORK, WORK, WORK, WORK, CARRY, MOVE];
      if (capacity >= 400) return [WORK, WORK, WORK, CARRY, MOVE];
      if (capacity >= 300) return [WORK, WORK, CARRY, MOVE];
      return [WORK, CARRY, MOVE];
    }
    if (role === "upgrader") {
      let isSuper = capacity >= 800; // Simplified check
      if (isSuper && capacity >= 800)
        return [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE];
      if (capacity >= 550) return [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE];
      if (capacity >= 300) return [WORK, WORK, CARRY, MOVE];
      return [WORK, CARRY, MOVE];
    }
    if (role === "builder") {
      if (capacity >= 550)
        return [WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
      if (capacity >= 300) return [WORK, CARRY, CARRY, MOVE, MOVE];
      return [WORK, CARRY, MOVE];
    }
    return [WORK, CARRY, MOVE];
  },
};

module.exports = spawnerModule;
