const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");

module.exports.loop = function () {
  // 1. 清理内存：删除死亡 Creep 的内存
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
      console.log("清除已死亡 Creep 的内存:", name);
    }
  }

  // 2. 孵化逻辑
  // 统计各角色数量
  const creeps = Game.creeps;
  let counts = {
    harvester: 0,
    upgrader: 0,
    builder: 0,
  };

  for (const name in creeps) {
    const creep = creeps[name];
    if (counts[creep.memory.role] !== undefined) {
      counts[creep.memory.role]++;
    }
  }

  // 设定目标数量 (建议根据房间等级调整)
  // 初始阶段：2个采集者，3个升级者，2个建造者
  const TARGETS = {
    harvester: 2,
    upgrader: 3,
    builder: 2,
  };

  const spawn = Game.spawns["Spawn1"];
  // 只有当 Spawn 存在且空闲时才孵化
  if (spawn && !spawn.spawning) {
    // 动态计算身体部件
    const getBody = (capacity) => {
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
    const newBody = getBody(energyToUse);

    if (counts.harvester < TARGETS.harvester) {
      const newName = "Harvester" + Game.time;
      console.log("正在孵化新采集者: " + newName + " (" + newBody + ")");
      spawn.spawnCreep(newBody, newName, {
        memory: { role: "harvester" },
      });
    } else if (counts.upgrader < TARGETS.upgrader) {
      const newName = "Upgrader" + Game.time;
      console.log("正在孵化新升级者: " + newName + " (" + newBody + ")");
      spawn.spawnCreep(newBody, newName, {
        memory: { role: "upgrader" },
      });
    } else if (counts.builder < TARGETS.builder) {
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
  }
};
