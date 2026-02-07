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

          // === 0. Role Avoidance (Highest Priority) ===
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

          // 2. 叠加车道偏好 (Lane Bias)
          // 计算大致方向
          let direction = 0;
          const dx = target.pos
            ? target.pos.x - creep.pos.x
            : target.x - creep.pos.x;
          const dy = target.pos
            ? target.pos.y - creep.pos.y
            : target.y - creep.pos.y;

          if (Math.abs(dy) > Math.abs(dx)) {
            // Vertical
            direction = dy < 0 ? TOP : BOTTOM;
          } else {
            // Horizontal
            direction = dx < 0 ? LEFT : RIGHT;
          }

          if (direction) {
            const laneMatrix = TrafficManager.getLaneMatrix(
              creep.room,
              direction,
            );
            if (laneMatrix) {
              // 合并矩阵: PathFinder 会自动处理，但我们需要返回一个 CostMatrix
              // 由于不能直接 merge 两个 CM，我们需要 clone 一个并叠加
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
      // 强制避让拥堵 + 遵循车道
      moveOpts.ignoreCreeps = false;
      moveOpts.costCallback = function (roomName, costMatrix) {
        if (roomName === creep.room.name) {
          const trafficMatrix = TrafficManager.getTrafficMatrix(creep.room);
          // 这里我们只返回拥堵矩阵，车道偏好在紧急避让时可以暂时忽略，或者需要合并
          // 为了简单，紧急避让时优先考虑 trafficMatrix (避开人)
          return trafficMatrix;
        }
      };
      moveOpts.reusePath = 0; // 重新寻路
      moveOpts.visualizePathStyle = { stroke: "#ff0000", lineStyle: "dotted" };

      creep.say("🔀 divert");
    }

    creep.moveTo(target, moveOpts);
  },

  /**
   * Check if creep is standing on a road
   * @param {Creep} creep
   * @returns {boolean}
   */
  isOnRoad: function (creep) {
    return creep.pos
      .lookFor(LOOK_STRUCTURES)
      .some((s) => s.structureType === STRUCTURE_ROAD);
  },

  /**
   * Move off the road to a random adjacent walkable tile
   * Keeps within range of anchor if provided
   * @param {Creep} creep
   * @param {RoomPosition|Object} anchor (Optional) Target to stay near
   * @param {number} range (Optional) Max range from anchor
   */
  parkOffRoad: function (creep, anchor = null, range = 1) {
    if (!this.isOnRoad(creep)) return; // Already off road

    // Find valid spot
    const terrain = creep.room.getTerrain();
    const adjacent = [];

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        if (x === 0 && y === 0) continue;
        const targetX = creep.pos.x + x;
        const targetY = creep.pos.y + y;

        // Boundary check
        if (targetX < 1 || targetX > 48 || targetY < 1 || targetY > 48)
          continue;

        const pos = new RoomPosition(targetX, targetY, creep.room.name);

        // Check terrain (Wall)
        if (terrain.get(targetX, targetY) === TERRAIN_MASK_WALL) continue;

        // Check structures (Road or Obstacle)
        const structures = pos.lookFor(LOOK_STRUCTURES);
        // Avoid Roads
        if (structures.some((s) => s.structureType === STRUCTURE_ROAD))
          continue;
        // Avoid Obstacles (Manual check for common ones or trust moveTo logic? Here we need manual check)
        if (
          structures.some(
            (s) =>
              s.structureType !== STRUCTURE_CONTAINER &&
              s.structureType !== STRUCTURE_RAMPART &&
              (OBSTACLE_OBJECT_TYPES.includes(s.structureType) ||
                s.structureType === "constructedWall"), // constructedWall is in OBSTACLE_OBJECT_TYPES usually
          )
        )
          continue;

        // Check creeps
        if (pos.lookFor(LOOK_CREEPS).length > 0) continue;

        // Check anchor range
        if (anchor && !pos.inRangeTo(anchor, range)) continue;

        adjacent.push(pos);
      }
    }

    if (adjacent.length > 0) {
      // Pick random or first
      const target = adjacent[Math.floor(Math.random() * adjacent.length)];
      creep.move(creep.pos.getDirectionTo(target));
      creep.say("🚷 park");
    }
  },
};

module.exports = moveModule;
