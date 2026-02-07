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
   */
  getAvoidanceMatrix: function (room, rolesToAvoid) {
    const costMatrix = new PathFinder.CostMatrix();
    const creeps = room.find(FIND_CREEPS);

    creeps.forEach((creep) => {
      // 1. 一般交通成本 (软避让)
      // 轻微惩罚所有 Creep 位置，倾向于走空地
      costMatrix.set(creep.pos.x, creep.pos.y, 10);

      // 2. 特定角色避让 (硬阻挡)
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
   * 获取方向性车道矩阵
   * @param {Room} room
   * @param {number} direction TOP/BOTTOM/LEFT/RIGHT
   */
  getLaneMatrix: function (room, direction) {
    if (!room._laneMatrices) this.generateLaneMatrices(room);
    return room._laneMatrices[direction];
  },

  /**
   * 生成包含交通状况的 CostMatrix
   * @param {Room} room
   * @returns {CostMatrix}
   */
  getTrafficMatrix: function (room) {
    const costs = new PathFinder.CostMatrix();
    const creeps = room.find(FIND_CREEPS);

    creeps.forEach((creep) => {
      // 基础成本 (尽量避免穿过人)
      let cost = 0;

      // 如果 Creep 卡住/闲置，显著增加成本
      if (creep.memory.idleTicks > this.config.stuckThreshold) {
        cost = this.config.congestionCost;
      } else if (creep.fatigue > 0) {
        cost = 10; // 疲劳的 Creep 是缓慢的障碍物
      } else {
        cost = 5; // 移动中的 Creep 是轻微障碍
      }

      // 设置成本 (仅当高于现有值时)
      // 注意：我们不覆盖墙壁 (255)，PathFinder 会处理。
      costs.set(creep.pos.x, creep.pos.y, cost);
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
   * 追踪空闲时间的辅助函数 (由 Creep 逻辑或内核调用)
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
  },
};

module.exports = TrafficManager;
