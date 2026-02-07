const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");
const roleHauler = require("role.hauler");
const autoBuilder = require("module.autoBuilder");
const populationModule = require("module.population");
const towerModule = require("module.tower");
const monitorModule = require("module.monitor");
const structurePlanner = require("module.structurePlanner");

module.exports.loop = function () {
  // 1. 清理内存：删除死亡 Creep 的内存
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
      console.log("清除已死亡 Creep 的内存:", name);
    }
  }

  // 运行自动建设模块和监控模块
  if (Game.spawns["Spawn1"]) {
    // 运行新的智能结构规划器
    structurePlanner.run(Game.spawns["Spawn1"].room);

    // 运行旧的 autoBuilder (主要用于 Roads/Extensions，Container 逻辑已由 Planner 接管)
    autoBuilder.run(Game.spawns["Spawn1"].room);

    towerModule.run(Game.spawns["Spawn1"].room);
    monitorModule.run(Game.spawns["Spawn1"].room);

    // 动态再分配搬运工 (每 5 tick)
    if (Game.time % 5 === 0) {
      populationModule.rebalanceHaulers(Game.spawns["Spawn1"].room);
    }
  }

  // 2. 孵化逻辑
  // 统计各角色数量
  const creeps = Game.creeps;
  let counts = {
    harvester: 0,
    upgrader: 0,
    builder: 0,
    hauler: 0,
  };

  for (const name in creeps) {
    const creep = creeps[name];
    if (counts[creep.memory.role] !== undefined) {
      // 提前孵化逻辑：
      // 如果 Creep 存活时间少于 100 tick（且不是正在孵化的），则不计入当前数量。
      // 这样 Spawn 会认为人手不足，提前开始孵化继任者。
      if (!creep.spawning && creep.ticksToLive < 100) {
        continue;
      }
      counts[creep.memory.role]++;
    }
  }

  // 设定目标数量 (使用 populationModule 动态计算)
  const spawn = Game.spawns["Spawn1"];
  const TARGETS = spawn
    ? populationModule.calculateTargets(spawn.room)
    : {
        harvester: 2,
        upgrader: 1,
        builder: 0,
        hauler: 0,
      };

  // 只有当 Spawn 存在且空闲时才孵化
  if (spawn && !spawn.spawning) {
    // 动态计算身体部件
    const getBody = (capacity, role) => {
      // 1. 搬运工 (Hauler): 唯一需要频繁移动的角色
      // 配置: CARRY + MOVE (1:1)
      if (role === "hauler") {
        if (capacity >= 300) return [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE]; // Cost: 300 (200容量) - 这里的配比是 2:1，移动稍慢，但容量大
        return [CARRY, CARRY, MOVE]; // Cost: 150 (100容量)
      }

      // 2. 采集者 (Harvester): 固定不动 (Stationary)
      // 配置: Max WORK + Min CARRY + Min MOVE
      if (role === "harvester") {
        // Late Game (RCL 8, Energy >= 1200+)
        // 用户要求: 8-10 个 WORK
        // 10 WORK = 1000 cost, + CARRY(50) + MOVE(50) = 1100
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

        // Mid-Late Game (RCL 6-7, Energy >= 800)
        // 8 WORK = 800 cost, + CARRY + MOVE = 900
        if (capacity >= 900)
          return [WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];

        // Mid Game (RCL 5, Energy >= 650)
        // 用户要求: 5-6 个 WORK
        // 6 WORK = 600 cost, + CARRY + MOVE = 700
        if (capacity >= 700)
          return [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];

        // 5 WORK = 500 cost, + CARRY + MOVE = 600
        if (capacity >= 600) return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];

        // Early Game (RCL 1-4)
        // 用户要求: 3-5 个 WORK

        // RCL 2 (Energy 550): 5 WORK (500) + MOVE (50) = 550 (无 CARRY，需脚下有 Container 或 Link，或者放弃 CARRY)
        // 为了安全起见，RCL 2 最好还是带个 CARRY 或者 4 WORK
        // 4 WORK (400) + CARRY (50) + MOVE (50) = 500
        if (capacity >= 500) return [WORK, WORK, WORK, WORK, CARRY, MOVE];

        // 平滑过渡 (Energy 400-450): 3 WORK (300) + CARRY (50) + MOVE (50) = 400
        // 这填补了 300 和 500 之间的空白，充分利用紧急能量
        if (capacity >= 400) return [WORK, WORK, WORK, CARRY, MOVE];

        // RCL 1-2 Transition (Energy 300-450)
        // 3 WORK (300) - 无法移动
        // 2 WORK (200) + CARRY (50) + MOVE (50) = 300
        if (capacity >= 300) return [WORK, WORK, CARRY, MOVE];

        return [WORK, CARRY, MOVE];
      }

      // 3. 升级者 (Upgrader): 固定不动 (Stationary)
      // 配置: Max WORK + Min CARRY + Min MOVE (只需要走到 Controller)
      if (role === "upgrader") {
        // Upgrader 不需要太多 CARRY，因为 Hauler 会源源不断送货
        // 重点是 WORK 的吞吐量
        if (capacity >= 550) return [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE]; // Cost: 550 (4 WORK!)
        if (capacity >= 300) return [WORK, WORK, CARRY, MOVE];
        return [WORK, CARRY, MOVE];
      }

      // 4. 建造者 (Builder): 区域移动 (Semi-Stationary)
      // 配置: Balanced WORK/CARRY + MOVE
      if (role === "builder") {
        if (capacity >= 550)
          return [WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE]; // Cost: 550
        if (capacity >= 300) return [WORK, CARRY, CARRY, MOVE, MOVE]; // Cost: 300
        return [WORK, CARRY, MOVE];
      }

      // Fallback
      return [WORK, CARRY, MOVE];
    };

    // === Harvester 孵化逻辑优化：按 Source 分配 ===
    // 找出哪个 Source 缺人
    const sources = spawn.room.find(FIND_SOURCES);
    const harvesters = spawn.room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "harvester",
    });

    let targetSource = null;
    let hasEmptySource = false; // 是否有完全没人的 Source

    // 统计每个 Source 的 Harvester 数量
    // 过滤掉即将死亡的 (ticksToLive < 100)，除非它是刚刚孵化出来的
    const sourceHarvesterCounts = {};
    sources.forEach((s) => (sourceHarvesterCounts[s.id] = 0));

    harvesters.forEach((c) => {
      // 如果 Creep 已经绑定了 Source，且寿命还长（或者正在孵化），则计入
      if (c.memory.sourceId && (c.ticksToLive > 100 || c.spawning)) {
        sourceHarvesterCounts[c.memory.sourceId]++;
      }
    });

    // 检查是否有 Source 是 0 人
    for (const source of sources) {
      if (sourceHarvesterCounts[source.id] === 0) {
        hasEmptySource = true;
        break;
      }
    }

    // 找到第一个缺人的 Source (目前设定为每个 Source 2 人)
    for (const source of sources) {
      if (sourceHarvesterCounts[source.id] < 2) {
        targetSource = source;
        break;
      }
    }

    // 如果有 Source 完全没人 (0 Harvester)，或者全局 Harvester 为 0，必须使用当前可用能量进行紧急孵化
    // 否则使用最大容量等待 Extensions 填满
    const energyToUse =
      counts.harvester === 0 || hasEmptySource
        ? spawn.room.energyAvailable
        : spawn.room.energyCapacityAvailable;

    if (targetSource) {
      const newBody = getBody(energyToUse, "harvester");
      const newName = "Harvester" + Game.time;
      console.log(
        "正在孵化新采集者: " +
          newName +
          " (" +
          newBody +
          ") -> 绑定 Source: " +
          targetSource.id,
      );
      spawn.spawnCreep(newBody, newName, {
        memory: { role: "harvester", sourceId: targetSource.id },
      });
    } else if (
      counts.upgrader < 1 &&
      spawn.room.controller.ticksToDowngrade < 4000
    ) {
      // 紧急救援：如果没有 Upgrader 且即将降级，优先孵化 Upgrader (插队到 Hauler 之前)
      const newBody = getBody(energyToUse, "upgrader");
      const newName = "Upgrader" + Game.time;
      console.log("🚨 紧急孵化救援升级者: " + newName + " (" + newBody + ")");
      spawn.spawnCreep(newBody, newName, {
        memory: { role: "upgrader" },
      });
    } else if (counts.hauler < TARGETS.hauler) {
      // 只有当有 Harvester 时才孵化 Hauler
      const newBody = getBody(energyToUse, "hauler");
      const newName = "Hauler" + Game.time;

      // === 智能分配 Source ===
      const haulerNeeds = populationModule.getHaulerNeeds(spawn.room);
      const haulers = spawn.room.find(FIND_MY_CREEPS, {
        filter: (c) => c.memory.role === "hauler",
      });

      // 统计现有分布
      const currentCounts = {};
      haulers.forEach((c) => {
        if (c.memory.sourceId && (c.ticksToLive > 100 || c.spawning)) {
          currentCounts[c.memory.sourceId] =
            (currentCounts[c.memory.sourceId] || 0) + 1;
        }
      });

      // 寻找缺口最大的 Source (Need - Current)
      let bestSourceId = null;
      let maxDeficit = -999;

      for (const sourceId in haulerNeeds) {
        const current = currentCounts[sourceId] || 0;
        const deficit = haulerNeeds[sourceId] - current;
        if (deficit > maxDeficit) {
          maxDeficit = deficit;
          bestSourceId = sourceId;
        }
      }

      // 如果没有特别缺的（或者都满了），就随机分配一个或者给第一个
      if (!bestSourceId) {
        const sources = spawn.room.find(FIND_SOURCES);
        bestSourceId = sources[0].id;
      }

      console.log(
        `正在孵化新搬运工: ${newName} -> 支援 Source ${bestSourceId} (缺口: ${maxDeficit})`,
      );
      spawn.spawnCreep(newBody, newName, {
        memory: { role: "hauler", sourceId: bestSourceId },
      });
    } else if (counts.upgrader < TARGETS.upgrader) {
      const newBody = getBody(energyToUse, "upgrader");
      const newName = "Upgrader" + Game.time;
      console.log("正在孵化新升级者: " + newName + " (" + newBody + ")");
      spawn.spawnCreep(newBody, newName, {
        memory: { role: "upgrader" },
      });
    } else if (counts.builder < TARGETS.builder) {
      const newBody = getBody(energyToUse, "builder");
      const newName = "Builder" + Game.time;
      console.log("正在孵化新建造者: " + newName + " (" + newBody + ")");
      spawn.spawnCreep(newBody, newName, {
        memory: { role: "builder" },
      });
    }
  }

  // 显示孵化状态
  if (spawn && spawn.spawning) {
    const spawningCreep = Game.creeps[spawn.spawning.name];
    spawn.room.visual.text(
      "🛠️" + spawningCreep.memory.role,
      spawn.pos.x + 1,
      spawn.pos.y,
      { align: "left", opacity: 0.8 },
    );
  }

  // 3. 执行角色逻辑
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.role == "harvester") {
      roleHarvester.run(creep);
    }
    if (creep.memory.role == "upgrader") {
      roleUpgrader.run(creep);
    }
    if (creep.memory.role == "builder") {
      roleBuilder.run(creep);
    }
    if (creep.memory.role == "hauler") {
      roleHauler.run(creep);
    }
  }
};
