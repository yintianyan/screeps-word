const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");
const roleHauler = require("role.hauler");
const autoBuilder = require("module.autoBuilder");
const populationModule = require("module.population");
const towerModule = require("module.tower");
const monitorModule = require("module.monitor");

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
    autoBuilder.run(Game.spawns["Spawn1"].room);
    towerModule.run(Game.spawns["Spawn1"].room);
    monitorModule.run(Game.spawns["Spawn1"].room);
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
        // Late Game (RCL 3+, Energy >= 750)
        // 5 WORK (100% 满速) + 2 CARRY (100容量) + 3 MOVE (足以移动到 Source)
        // Cost: 500 + 100 + 150 = 750
        if (capacity >= 750)
          return [WORK, WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE];

        // Mid Game (RCL 2, Energy >= 550)
        // 4 WORK + 1 CARRY + 2 MOVE
        // Cost: 400 + 50 + 100 = 550
        if (capacity >= 550) return [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE];

        // Early Game
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

    // 如果 Harvester 数量为 0，必须使用当前可用能量（energyAvailable）进行紧急孵化
    // 否则使用最大容量（energyCapacityAvailable）等待 Extensions 填满
    const energyToUse =
      counts.harvester === 0
        ? spawn.room.energyAvailable
        : spawn.room.energyCapacityAvailable;

    // === Harvester 孵化逻辑优化：按 Source 分配 ===
    // 找出哪个 Source 缺人
    const sources = spawn.room.find(FIND_SOURCES);
    const harvesters = spawn.room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "harvester",
    });

    let targetSource = null;

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

    // 找到第一个缺人的 Source (目前设定为每个 Source 1 人)
    for (const source of sources) {
      if (sourceHarvesterCounts[source.id] < 1) {
        targetSource = source;
        break;
      }
    }

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
      console.log("正在孵化新搬运工: " + newName + " (" + newBody + ")");

      // 均衡分配 Source 给 Hauler
      const sources = spawn.room.find(FIND_SOURCES);
      const haulers = spawn.room.find(FIND_MY_CREEPS, {
        filter: (c) => c.memory.role === "hauler",
      });

      // 统计每个 Source 的 Hauler 数量
      const sourceCounts = {};
      sources.forEach((s) => (sourceCounts[s.id] = 0));
      haulers.forEach((c) => {
        if (c.memory.sourceId) {
          sourceCounts[c.memory.sourceId] =
            (sourceCounts[c.memory.sourceId] || 0) + 1;
        }
      });

      // 找最少的
      let bestSource = sources[0];
      let minCount = 9999;
      sources.forEach((s) => {
        if (sourceCounts[s.id] < minCount) {
          minCount = sourceCounts[s.id];
          bestSource = s;
        }
      });

      spawn.spawnCreep(newBody, newName, {
        memory: { role: "hauler", sourceId: bestSource.id },
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
