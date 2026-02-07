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
        // 添加 CostCallback 实现车道偏好
        costCallback: function (roomName, costMatrix) {
          if (roomName !== creep.room.name) return;

          // === 0. 角色避让 (最高优先级) ===
          // 用户指定需要避让的角色 (例如 Hauler 避让 Upgrader)
          if (opts.avoidRoles && opts.avoidRoles.length > 0) {
            return TrafficManager.getAvoidanceMatrix(
              creep.room,
              opts.avoidRoles,
            );
          }

          // 1. 获取基础交通拥堵矩阵 (如果需要避让)
          // 只有当 stuckCount > 0 时才避让拥堵，否则只遵循车道规则
          let matrix = costMatrix;

          // 2. 叠加车道偏好 (车道偏向)
          // 计算大致方向
          let direction = 0;
          const dx = target.pos
            ? target.pos.x - creep.pos.x
            : target.x - creep.pos.x;
          const dy = target.pos
            ? target.pos.y - creep.pos.y
            : target.y - creep.pos.y;

          if (Math.abs(dy) > Math.abs(dx)) {
            // 垂直方向
            direction = dy < 0 ? TOP : BOTTOM;
          } else {
            // 水平方向
            direction = dx < 0 ? LEFT : RIGHT;
          }

          if (direction) {
            const laneMatrix = TrafficManager.getLaneMatrix(
              creep.room,
              direction,
            );
            if (laneMatrix) {
              // 合并矩阵: PathFinder 会自动处理，但我们需要返回一个 CostMatrix
              // 由于不能直接合并两个 CM，我们需要克隆一个并叠加
              // 或者，为了性能，我们直接返回 laneMatrix，并在其中动态叠加拥堵？
              // 不，laneMatrix 是静态缓存的，不能修改。

              // 方案：返回 laneMatrix。如果卡住了，PathFinder 会重新寻路，此时我们可能需要更强的避让
              return laneMatrix;
            }
          }
        },
      },
      opts,
    );

    // === 智能分流逻辑 ===
    // 如果卡住了，或者 TrafficManager 报告前方拥堵
    // 这里的 "2" 是 stuckThreshold
    if (creep.memory._move.stuckCount >= 2) {
      // 1. 尝试交换 (Swap)
      // 如果前方仅仅是因为被自己人挡住，且对方也可以移动，直接交换位置
      // 注意：findPathTo 开销较大，仅在堵塞时调用
      const path = creep.pos.findPathTo(target, {
        ignoreCreeps: true,
        range: opts.range || 1,
        maxRooms: 1, // 限制范围，减少开销
      });

      if (path.length > 0) {
        const nextStep = path[0];
        const obstacle = creep.room.lookForAt(
          LOOK_CREEPS,
          nextStep.x,
          nextStep.y,
        )[0];

        // 只有当障碍物是己方 Creep 且未疲劳时才交换
        if (obstacle && obstacle.my && obstacle.fatigue === 0) {
          obstacle.move(obstacle.pos.getDirectionTo(creep));
          creep.move(creep.pos.getDirectionTo(obstacle));

          // 交换成功，重置计数并跳过常规 moveTo
          creep.memory._move.stuckCount = 0;
          creep.say("🔀 swap");
          return;
        }
      }

      // 2. 交换失败，启动 "智能分流" (Smart Diversion)
      // 强制避让拥堵 + 遵循车道
      moveOpts.ignoreCreeps = false;
      moveOpts.costCallback = function (roomName, costMatrix) {
        if (roomName === creep.room.name) {
          const trafficMatrix = TrafficManager.getTrafficMatrix(creep.room);
          return trafficMatrix;
        }
      };
      moveOpts.reusePath = 0; // 重新寻路
      moveOpts.visualizePathStyle = { stroke: "#ff0000", lineStyle: "dotted" };

      // 如果卡住很久 (>5 ticks)，说明重寻路也找不到路 (死胡同或被包围)
      // 尝试随机移动一步，打破僵局
      if (creep.memory._move.stuckCount > 5) {
        const directions = [
          TOP,
          TOP_RIGHT,
          RIGHT,
          BOTTOM_RIGHT,
          BOTTOM,
          BOTTOM_LEFT,
          LEFT,
          TOP_LEFT,
        ];
        const randomDir =
          directions[Math.floor(Math.random() * directions.length)];
        if (creep.move(randomDir) === OK) {
          creep.memory._move.stuckCount = 0;
          creep.say("🎲 panic");
          return;
        }
      }

      creep.say("🛡️ avoid");
    }

    const result = creep.moveTo(target, moveOpts);

    // 如果 moveTo 彻底失败 (无路可走)，且我们被卡住了
    if (result === ERR_NO_PATH && creep.memory._move.stuckCount > 0) {
      creep.say("🚫 no path");
      // 下个 tick 会触发 panic 随机移动
    }
  },

  /**
   * 检查 Creep 是否站在道路上
   * @param {Creep} creep
   * @returns {boolean}
   */
  isOnRoad: function (creep) {
    return creep.pos
      .lookFor(LOOK_STRUCTURES)
      .some((s) => s.structureType === STRUCTURE_ROAD);
  },

  /**
   * 移出道路到随机的相邻可行走地块
   * 如果提供锚点，则保持在锚点范围内
   * @param {Creep} creep
   * @param {RoomPosition|Object} anchor (可选) 要保持在其附近的目标
   * @param {number} range (可选) 离锚点的最大范围
   */
  parkOffRoad: function (creep, anchor = null, range = 1) {
    if (!this.isOnRoad(creep)) return; // 已经在非道路上

    // 寻找有效位置
    const terrain = creep.room.getTerrain();
    const adjacent = [];

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        if (x === 0 && y === 0) continue;
        const targetX = creep.pos.x + x;
        const targetY = creep.pos.y + y;

        // 边界检查
        if (targetX < 1 || targetX > 48 || targetY < 1 || targetY > 48)
          continue;

        const pos = new RoomPosition(targetX, targetY, creep.room.name);

        // 检查地形 (墙壁)
        if (terrain.get(targetX, targetY) === TERRAIN_MASK_WALL) continue;

        // 检查建筑 (路或障碍物)
        const structures = pos.lookFor(LOOK_STRUCTURES);
        // 避开道路
        if (structures.some((s) => s.structureType === STRUCTURE_ROAD))
          continue;
        // 避开障碍物 (手动检查常见障碍物或信任 moveTo 逻辑? 这里我们需要手动检查)
        if (
          structures.some(
            (s) =>
              s.structureType !== STRUCTURE_CONTAINER &&
              s.structureType !== STRUCTURE_RAMPART &&
              ((typeof OBSTACLE_OBJECT_TYPES !== "undefined" &&
                OBSTACLE_OBJECT_TYPES.includes(s.structureType)) ||
                s.structureType === "constructedWall"), // constructedWall 通常在 OBSTACLE_OBJECT_TYPES 中
          )
        )
          continue;

        // 检查 Creeps
        if (pos.lookFor(LOOK_CREEPS).length > 0) continue;

        // 检查锚点范围
        if (anchor && !pos.inRangeTo(anchor, range)) continue;

        adjacent.push(pos);
      }
    }

    if (adjacent.length > 0) {
      // 随机选择或选择第一个
      const target = adjacent[Math.floor(Math.random() * adjacent.length)];
      creep.move(creep.pos.getDirectionTo(target));
      creep.say("🚷 park");
    }
  },
};

module.exports = moveModule;
