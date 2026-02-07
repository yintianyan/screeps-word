const TrafficManager = require("module.traffic");

const moveModule = {
  /**
   * 智能移动逻辑
   * 默认忽略 Creep 碰撞（走 Road），卡住时才考虑 Creep（绕路）
   * 集成 TrafficManager 实现动态车道选择
   * @param {Creep} creep
   * @param {RoomPosition|Structure} target
   * @param {object} opts
   */
  smartMove: function (creep, target, opts = {}) {
    // 0. 交通流量监测 (汇报位置状态)
    TrafficManager.trackCreep(creep);

    // 初始化记忆
    if (!creep.memory._move) creep.memory._move = {};

    // 检查是否卡住
    if (
      creep.pos.x === creep.memory._move.lastX &&
      creep.pos.y === creep.memory._move.lastY &&
      creep.fatigue === 0
    ) {
      creep.memory._move.stuckCount = (creep.memory._move.stuckCount || 0) + 1;
    } else {
      creep.memory._move.stuckCount = 0;
      creep.memory._move.lastX = creep.pos.x;
      creep.memory._move.lastY = creep.pos.y;
    }

    // 默认配置
    let moveOpts = Object.assign(
      {
        visualizePathStyle: { stroke: "#ffffff", lineStyle: "dashed" },
        reusePath: 10,
        ignoreCreeps: true,
      },
      opts,
    );

    // === 智能分流逻辑 ===
    // 如果卡住了，或者 TrafficManager 报告前方拥堵
    // 这里的 "2" 是 stuckThreshold
    if (creep.memory._move.stuckCount >= 2) {
      // 1. 尝试交换 (Swap)
      const path = creep.pos.findPathTo(target, {
        ignoreCreeps: true,
        range: opts.range || 1,
      });
      if (path.length > 0) {
        const nextStep = path[0];
        const obstacle = creep.room.lookForAt(
          LOOK_CREEPS,
          nextStep.x,
          nextStep.y,
        )[0];

        if (obstacle && obstacle.my) {
          obstacle.move(obstacle.pos.getDirectionTo(creep));
          creep.move(creep.pos.getDirectionTo(obstacle));
          creep.memory._move.stuckCount = 0;
          return;
        }
      }

      // 2. 交换失败，启动 "智能分流" (Smart Diversion)
      // 使用 TrafficManager 生成的 CostMatrix，它会给拥堵的格子加高分
      // 从而迫使 PathFinder 选择旁边的空闲车道 (Double-Lane Highway 的优势)
      moveOpts.ignoreCreeps = false; // 必须设为 false 才能让 costCallback 生效? 不，pathFinder 此时需要自定义 matrix
      moveOpts.costCallback = function (roomName, costMatrix) {
        if (roomName === creep.room.name) {
          return TrafficManager.getTrafficMatrix(creep.room);
        }
      };
      moveOpts.reusePath = 0; // 重新寻路
      moveOpts.visualizePathStyle = { stroke: "#ff0000", lineStyle: "dotted" };

      creep.say("🔀 divert");
    }

    creep.moveTo(target, moveOpts);
  },
};

module.exports = moveModule;
