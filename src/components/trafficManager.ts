/**
 * 智能交通控制系统 (Intelligent Traffic Control System)
 *
 * 1. 拥堵监控：追踪 Creep 移动并识别卡住的 Creep。
 * 2. 动态 CostMatrix：增加拥堵地块的通行成本，强制寻路算法重算路径。
 * 3. 可视化：显示交通热力图（绿色=畅通，红色=拥堵）。
 */
const TrafficManager = {
  // 配置
  config: {
    stuckThreshold: 2, // 判定为卡住的等待 tick 数
    congestionCost: 50, // 拥堵地块增加的 Cost
    visualize: true,
  },

  /**
   * 每 tick 运行以更新交通数据
   * @param {Room} room
   */
  run: function (room) {
    if (Game.time % 1 !== 0) return; // 实时更新

    // 初始化车道矩阵 (懒加载)
    if (!room._laneMatrices) {
      this.generateLaneMatrices(room);
    }

    // 1. 监控与可视化
    if (this.config.visualize) {
      this.visualizeTraffic(room);
    }
  },

  /**
   * 生成房间的静态车道偏好矩阵
   * "左进右出" (Left-Hand Traffic) 规则:
   * - 垂直道路: 左车道 (x) = 向上/北, 右车道 (x+1) = 向下/南
   * - 水平道路: 上车道 (y) = 向左/西, 下车道 (y+1) = 向右/东
   * @param {Room} room
   */
  generateLaneMatrices: function (room) {
    // 为 4 个方向创建 4 个矩阵
    // 1: Top, 3: Right, 5: Bottom, 7: Left (Screeps 常量)
    const matrices = {
      [TOP]: new PathFinder.CostMatrix(),
      [BOTTOM]: new PathFinder.CostMatrix(),
      [LEFT]: new PathFinder.CostMatrix(),
      [RIGHT]: new PathFinder.CostMatrix(),
    };

    const terrain = room.getTerrain();
    // 扫描所有道路 (建筑)
    // 注意：依赖已建成的道路。对于规划中的道路，可能需要查看工地。
    const roads = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_ROAD,
    });

    roads.forEach((road) => {
      const x = road.pos.x;
      const y = road.pos.y;

      // 1. 检查垂直双车道 (x+1 或 x-1 有路)
      const hasRight =
        room
          .lookForAt(LOOK_STRUCTURES, x + 1, y)
          .some((s) => s.structureType === STRUCTURE_ROAD) ||
        terrain.get(x + 1, y) === TERRAIN_MASK_WALL; // 墙壁视为"对面"? 不。
      const hasLeft = room
        .lookForAt(LOOK_STRUCTURES, x - 1, y)
        .some((s) => s.structureType === STRUCTURE_ROAD);

      // 规则: 左 (x) = 上, 右 (x+1) = 下
      if (hasRight && !hasLeft) {
        // 这是左车道
        // 偏好: 利于向上 (Top), 不利于向下 (Bottom)
        matrices[TOP].set(x, y, 1); // 优先
        matrices[BOTTOM].set(x, y, 5); // 惩罚
      } else if (hasLeft && !hasRight) {
        // 这是右车道
        // 偏好: 利于向下 (Bottom), 不利于向上 (Top)
        matrices[BOTTOM].set(x, y, 1);
        matrices[TOP].set(x, y, 5);
      }

      // 2. 检查水平双车道 (y+1 或 y-1 有路)
      const hasBottom = room
        .lookForAt(LOOK_STRUCTURES, x, y + 1)
        .some((s) => s.structureType === STRUCTURE_ROAD);
      const hasTop = room
        .lookForAt(LOOK_STRUCTURES, x, y - 1)
        .some((s) => s.structureType === STRUCTURE_ROAD);

      // 规则: 上 (y) = 左 (西), 下 (y+1) = 右 (东)
      if (hasBottom && !hasTop) {
        // 这是上车道
        // 偏好: 利于向左 (West), 不利于向右 (East)
        matrices[LEFT].set(x, y, 1);
        matrices[RIGHT].set(x, y, 5);
      } else if (hasTop && !hasBottom) {
        // 这是下车道
        // 偏好: 利于向右 (East), 不利于向左 (West)
        matrices[RIGHT].set(x, y, 1);
        matrices[LEFT].set(x, y, 5);
      }
    });

    room._laneMatrices = matrices;
    // 缓存过期：每 1000 ticks 清除或建筑完成后清除？
    // 目前让其在 Heap 中持久化。Global 重置时会清除。
  },

  /**
   * 获取特定避让矩阵（标记特定角色为不可通行）
   * 用于“反拥挤”逻辑（例如 Hauler 绕过 Upgrader）
   * @param {Room} room
   * @param {string[]} rolesToAvoid 要避让的角色名称数组
   * @param {CostMatrix} [existingMatrix]
   */
  getAvoidanceMatrix: function (room, rolesToAvoid, existingMatrix) {
    const costMatrix = existingMatrix || new PathFinder.CostMatrix();
    const creeps = room.find(FIND_CREEPS);

    creeps.forEach((creep) => {
      // 特定角色避让 (硬阻挡)
      if (
        creep.my &&
        creep.memory.role &&
        rolesToAvoid.includes(creep.memory.role)
      ) {
        costMatrix.set(creep.pos.x, creep.pos.y, 255); // 不可通行
      }
    });

    return costMatrix;
  },

  /**
   * 将车道偏好应用到现有矩阵
   * @param {Room} room
   * @param {number} direction
   * @param {CostMatrix} matrix
   */
  applyLanePreference: function (room, direction, matrix) {
    if (!room._laneMatrices) this.generateLaneMatrices(room);
    const laneMatrix = room._laneMatrices[direction];
    if (!laneMatrix) return;

    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        const laneCost = laneMatrix.get(x, y);
        if (laneCost > 0) {
          const currentCost = matrix.get(x, y);
          // 只有在当前位置没有被设为硬阻挡时才应用偏好
          if (currentCost < 100) {
            matrix.set(x, y, Math.max(currentCost, laneCost));
          }
        }
      }
    }
  },

  /**
   * 更新并返回包含交通状况的 CostMatrix
   * 根据 Creep 的空闲时间 (idleTicks) 动态调整成本
   * @param {Room} room
   * @param {CostMatrix} [existingMatrix] 可选的现有矩阵
   * @returns {CostMatrix}
   */
  getTrafficMatrix: function (room, existingMatrix) {
    const costs = existingMatrix || new PathFinder.CostMatrix();
    const creeps = room.find(FIND_CREEPS);
    const powerCreeps = room.find(FIND_POWER_CREEPS);
    const allCreeps = creeps.concat(powerCreeps);

    allCreeps.forEach((c) => {
      // 正在移动的 Creep 成本较低，静止的成本较高
      let cost = 20; // 默认轻微避让，引导走空地

      const idleTicks =
        (c.memory && c.memory._move && c.memory._move.stuckCount) ||
        (c.memory && c.memory.idleTicks) ||
        0;

      if (idleTicks > 10) {
        cost = 250; // 严重阻塞：几乎避开
      } else if (idleTicks > 5) {
        cost = 150; // 中度阻塞
      } else if (idleTicks > 2) {
        cost = 80; // 轻微阻塞
      }

      // 如果是当前 Creep 正在寻路，不要把自己设为障碍 (虽然通常不会在目标位置)
      // 但这里不知道谁是寻路者，所以统一处理

      const current = costs.get(c.pos.x, c.pos.y);
      if (cost > current) {
        costs.set(c.pos.x, c.pos.y, cost);
      }
    });

    return costs;
  },

  /**
   * 可视化交通状态
   * @param {Room} room
   */
  visualizeTraffic: function (room) {
    const visual = new RoomVisual(room.name);
    const creeps = room.find(FIND_MY_CREEPS);

    creeps.forEach((creep) => {
      if (creep.memory.idleTicks > 2) {
        // 卡住/闲置: 红圈
        visual.circle(creep.pos, {
          fill: "transparent",
          radius: 0.4,
          stroke: "#ff0000",
        });
      } else {
        // 移动中: 绿点
        // visual.circle(creep.pos, {fill: '#00ff00', radius: 0.1});
      }
    });
  },

  /**
   * 追踪空闲时间的辅助函数
   */
  trackCreep: function (creep) {
    if (!creep.memory._lastPos) {
      creep.memory._lastPos = { x: creep.pos.x, y: creep.pos.y };
      creep.memory.idleTicks = 0;
    } else {
      if (
        creep.pos.x === creep.memory._lastPos.x &&
        creep.pos.y === creep.memory._lastPos.y
      ) {
        creep.memory.idleTicks = (creep.memory.idleTicks || 0) + 1;
      } else {
        creep.memory.idleTicks = 0;
        creep.memory._lastPos = { x: creep.pos.x, y: creep.pos.y };
      }
    }

    // 检查并处理移动请求 (由其他 Creep 发起)
    if (
      creep.memory._moveRequest &&
      creep.memory._moveRequest.tick === Game.time
    ) {
      // 只有在当前没有移动意图（或者移动失败）的情况下，才会尝试响应请求
      // 注意：这通常在 Creep 逻辑运行前被设置，或者在运行中被同伴设置
      // 这里只是标记，实际移动由 module.move 处理
    }
  },

  /**
   * 外部请求某个 Creep 让位
   * @param {Creep} targetCreep 被请求的 Creep
   * @param {number} direction 建议移动的方向 (通常是请求者想要进入的方向)
   */
  requestMove: function (targetCreep, direction) {
    if (!targetCreep || !targetCreep.my) return;
    targetCreep.memory._moveRequest = {
      tick: Game.time,
      dir: direction,
    };
  },
};

export default TrafficManager;
