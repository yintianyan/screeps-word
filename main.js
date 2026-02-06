const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");
const roleHauler = require("role.hauler");
const autoBuilder = require("module.autoBuilder");
const populationModule = require("module.population");
const towerModule = require("module.tower");

module.exports.loop = function () {
  // 1. 清理内存：删除死亡 Creep 的内存
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
      console.log("清除已死亡 Creep 的内存:", name);
    }
  }

  // 运行自动建设模块
  if (Game.spawns["Spawn1"]) {
    autoBuilder.run(Game.spawns["Spawn1"].room);
    towerModule.run(Game.spawns["Spawn1"].room);
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
      // 搬运工只需要 CARRY 和 MOVE
      if (role === "hauler") {
        if (capacity >= 300) return [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE]; // Cost: 300 (200容量)
        return [CARRY, CARRY, MOVE]; // Cost: 150 (100容量)
      }

      // Harvester 专用高产配置 (Static Mining)
      if (role === "harvester") {
        // RCL 3+ (800 energy): 5 WORK (100% 效率) + 1 CARRY + 2 MOVE = 650
        if (capacity >= 650)
          return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE];

        // RCL 2 (550 energy): 4 WORK (80% 效率) + 1 CARRY + 1 MOVE = 500
        // 注意：只有 1 个 MOVE，移动慢，但到了位置就不动了
        if (capacity >= 550) return [WORK, WORK, WORK, WORK, CARRY, MOVE];

        // RCL 1-2 (300-500 energy): 2 WORK + 1 CARRY + 1 MOVE = 300
        if (capacity >= 300) return [WORK, WORK, CARRY, MOVE];

        return [WORK, CARRY, MOVE]; // Cost: 200
      }

      // 其他角色 (Upgrader, Builder)
      if (capacity >= 550)
        return [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE]; // Cost: 550
      if (capacity >= 400) return [WORK, WORK, CARRY, CARRY, MOVE, MOVE]; // Cost: 400
      if (capacity >= 300) return [WORK, WORK, CARRY, MOVE]; // Cost: 300
      return [WORK, CARRY, MOVE]; // Cost: 200
    };

    // 如果 Harvester 数量为 0，必须使用当前可用能量（energyAvailable）进行紧急孵化
    // 否则使用最大容量（energyCapacityAvailable）等待 Extensions 填满
    const energyToUse =
      counts.harvester === 0
        ? spawn.room.energyAvailable
        : spawn.room.energyCapacityAvailable;

    if (counts.harvester < TARGETS.harvester) {
      const newBody = getBody(energyToUse, "harvester");
      const newName = "Harvester" + Game.time;
      console.log("正在孵化新采集者: " + newName + " (" + newBody + ")");
      spawn.spawnCreep(newBody, newName, {
        memory: { role: "harvester" },
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
