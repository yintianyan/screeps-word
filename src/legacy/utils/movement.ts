import TrafficManager from "../components/trafficManager";

interface SmartMoveOptions extends MoveToOpts {
  avoidRoles?: string[];
  visualizePathStyle?: PolyStyle;
  reusePath?: number;
  ignoreCreeps?: boolean;
  range?: number;
}

const moveModule = {
  /**
   * 智能移动逻辑
   * 默认忽略 Creep 碰撞（走 Road），卡住时才考虑 Creep（绕路）
   * 集成 TrafficManager 实现动态车道选择
   * @param {Creep} creep
   * @param {RoomPosition|Structure} target
   * @param {object} opts
   */
  smartMove: function (
    creep: Creep,
    target: RoomPosition | Structure | { pos: RoomPosition },
    opts: SmartMoveOptions = {},
  ) {
    // 标记已执行移动逻辑
    (creep as any)._moveExecuted = true;

    // 0. 交通流量监测 (汇报位置状态) - 已移除
    // TrafficManager.trackCreep(creep);

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
      // 优化：不立即清零，而是缓慢减少，防止路径震荡
      if (creep.memory._move.stuckCount && creep.memory._move.stuckCount > 0) {
        creep.memory._move.stuckCount--;
      }
      creep.memory._move.lastX = creep.pos.x;
      creep.memory._move.lastY = creep.pos.y;
    }

    const stuckCount = creep.memory._move.stuckCount || 0;

    // 默认配置
    let moveOpts: SmartMoveOptions = Object.assign(
      {
        visualizePathStyle: { stroke: "#ffffff", lineStyle: "dashed" },
        reusePath: 20, // 增加复用
        ignoreCreeps: true, // 默认忽略
        range: 1,
        // [Optimization] 强制设置地形权重，使 Creep 优先走 Roads (1)
        plainCost: 2,
        swampCost: 10,

        // 添加 CostCallback 实现车道偏好
        costCallback: function (roomName: string, costMatrix: CostMatrix) {
          if (roomName !== creep.room.name) return costMatrix;

          // 1. 基础道路与地形成本 (确保 PathFinder 知道道路的存在)
          // 只有在没有使用 TrafficManager 的静态矩阵时才需要手动设置
          // 这里我们通常直接在 TrafficManager 的方法里叠加

          // 2. 角色避让 (例如避开正在升级的 Upgrader)
          if (opts.avoidRoles && opts.avoidRoles.length > 0) {
            TrafficManager.getAvoidanceMatrix(
              creep.room,
              opts.avoidRoles,
              costMatrix,
            );
          }

          // 3. 动态拥堵避让 (根据 stuckCount 逐渐增加对 Creep 的感知)
          if (stuckCount >= 5) {
            TrafficManager.getTrafficMatrix(creep.room, costMatrix);
          }

          // 4. 车道偏好 (仅在未严重卡住时使用)
          if (stuckCount < 8) {
            let direction = 0;

            const targetPos = (target as any).pos
              ? (target as any).pos
              : target;

            const dx = targetPos.x - creep.pos.x;
            const dy = targetPos.y - creep.pos.y;

            if (Math.abs(dy) > Math.abs(dx)) {
              direction = dy < 0 ? TOP : BOTTOM;
            } else {
              direction = dx < 0 ? LEFT : RIGHT;
            }

            if (direction) {
              TrafficManager.applyLanePreference(
                creep.room,
                direction as DirectionConstant,
                costMatrix,
              );
            }
          }

          return costMatrix;
        },
      },
      opts,
    );

    // === 阶段处理 (State Machine) ===

    // 阶段 1: 等待 (1-2 ticks)
    // 保持 ignoreCreeps: true，给对方一点时间移开
    if (stuckCount > 0 && stuckCount < 3) {
      creep.say("⏳ " + stuckCount);
      // 继续使用 moveTo，依靠 reusePath
    }

    // 阶段 2: 尝试交换/请求让位 (3-5 ticks)
    if (stuckCount >= 3 && stuckCount <= 5) {
      moveOpts.reusePath = 0; // 强制重算
      moveOpts.visualizePathStyle = { stroke: "#ffff00", lineStyle: "dotted" };

      const targetPos = (target as any).pos || target;
      const path = creep.pos.findPathTo(targetPos, {
        ignoreCreeps: true,
        range: moveOpts.range,
        maxRooms: 1,
      });

      if (path.length > 0) {
        const nextStep = path[0];
        const obstacle = creep.room.lookForAt(
          LOOK_CREEPS,
          nextStep.x,
          nextStep.y,
        )[0];
        if (obstacle && obstacle.my) {
          // 发起交换请求
          TrafficManager.requestMove(
            obstacle,
            creep.pos.getDirectionTo(obstacle),
          );
          creep.say("🤝 swap?");
          if (stuckCount === 3)
            console.log(
              `[Move] ${creep.name} requesting swap from ${obstacle.name} at ${obstacle.pos}`,
            );
          // 尝试对穿
          if (obstacle.fatigue === 0) {
            creep.move(creep.pos.getDirectionTo(obstacle));
            // 注意：我们不直接命令对方 move，而是让对方在自己的 smartMove 中响应
            return OK;
          }
        }
      }
    }

    // 阶段 3: 强制绕路 (6-10 ticks)
    if (stuckCount >= 6 && stuckCount <= 10) {
      moveOpts.ignoreCreeps = false; // 寻路时考虑 Creep 碰撞
      moveOpts.reusePath = 0;
      moveOpts.maxOps = 2000; // 增加寻路上限
      moveOpts.visualizePathStyle = { stroke: "#ff8800", lineStyle: "solid" };
      creep.say("🛡️ detour");
    }

    // 阶段 4: 紧急避让/恐慌 (> 10 ticks)
    if (stuckCount > 10) {
      creep.say("😖 panic");
      if (stuckCount === 11)
        console.log(
          `[Move] ${creep.name} entered PANIC mode at ${creep.pos} (stuck for ${stuckCount} ticks)`,
        );
      // 检查周围是否有非道路的空位可以暂时“停靠”
      const terrain = creep.room.getTerrain();
      const possiblePos: { pos: RoomPosition; score: number }[] = [];
      for (let i = 1; i <= 8; i++) {
        const pos = this.getPositionInDirection(creep.pos, i);
        if (!pos || pos.x < 1 || pos.x > 48 || pos.y < 1 || pos.y > 48)
          continue;
        if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) continue;
        if (pos.lookFor(LOOK_CREEPS).length > 0) continue;

        const structures = pos.lookFor(LOOK_STRUCTURES);
        // OBSTACLE_OBJECT_TYPES is defined in constants.js/ts globally in screeps usually,
        // but here we might need to be careful.
        // Standard check:
        const isObstacle = structures.some(
          (s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_CONTAINER &&
            (OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType),
        );

        if (isObstacle) continue;

        // 评分逻辑：
        // 1. 离目标不要太远 (权重 10)
        // 2. 必须离开道路 (权重 20)
        // 3. 避免再次进入狭窄通道 (检查周围空位数量)
        const targetPos = (target as any).pos || target;
        let score = (20 - pos.getRangeTo(targetPos)) * 1;
        const isOnRoad = structures.some(
          (s) => s.structureType === STRUCTURE_ROAD,
        );
        if (!isOnRoad) score += 50;

        // 检查周围空位
        let freeSpaces = 0;
        for (let j = 1; j <= 8; j++) {
          const nearPos = this.getPositionInDirection(pos, j);
          if (
            nearPos &&
            terrain.get(nearPos.x, nearPos.y) !== TERRAIN_MASK_WALL
          )
            freeSpaces++;
        }
        score += freeSpaces * 5;

        possiblePos.push({ pos, score });
      }

      if (possiblePos.length > 0) {
        const best = possiblePos.reduce(
          (prev, current) => (prev.score > current.score ? prev : current),
          possiblePos[0],
        );
        if (best) {
          // 如果当前位置分值已经很高（不在路上），则原地等待
          const currentIsOnRoad = this.isOnRoad(creep);
          if (!currentIsOnRoad && best.score < 60) {
            creep.say("💤 parking");
            return OK;
          }
          creep.move(creep.pos.getDirectionTo(best.pos));
          return OK;
        }
      }
    }

    // === 正常移动执行 ===
    const result = creep.moveTo(
      target as RoomPosition | { pos: RoomPosition },
      moveOpts,
    );

    // === 响应同伴请求 (后置处理) ===
    // 如果本 tick 移动失败，或者没有移动意图，尝试响应之前的请求
    const moveRequest = creep.memory._moveRequest;
    if (
      result !== OK &&
      result !== ERR_TIRED &&
      moveRequest &&
      moveRequest.tick === Game.time
    ) {
      const dir = moveRequest.dir;
      // 反向移动实现对穿
      // 注意：这里的 dir 是请求者相对于我的方向，所以我要移向请求者
      // 但其实更简单的做法是直接移向请求者的位置
      const oppositeDir = ((dir + 3) % 8) + 1;

      creep.move(oppositeDir as DirectionConstant);
      creep.say("🔄 OK");
      console.log(
        `[Move] ${creep.name} responding to move request (direction: ${oppositeDir})`,
      );
      return OK; // 标记已处理
    }

    if (result === ERR_NO_PATH) {
      // 如果完全找不到路，且已经卡住
      if (stuckCount > 5) {
        creep.say("🚫 trapped");
        // 尝试向反方向退一步，腾出空间

        const targetPos = (target as any).pos || target;
        const dirToTarget = creep.pos.getDirectionTo(targetPos);
        const oppositeDir = ((dirToTarget + 3) % 8) + 1;

        creep.move(oppositeDir as DirectionConstant);
      }
    }

    return result;
  },

  /**
   * 辅助方法：获取给定方向的新位置
   */
  getPositionInDirection: function (pos: RoomPosition, direction: number) {
    const offsets: { [key: number]: number[] } = {
      [TOP]: [0, -1],
      [TOP_RIGHT]: [1, -1],
      [RIGHT]: [1, 0],
      [BOTTOM_RIGHT]: [1, 1],
      [BOTTOM]: [0, 1],
      [BOTTOM_LEFT]: [-1, 1],
      [LEFT]: [-1, 0],
      [TOP_LEFT]: [-1, -1],
    };
    const offset = offsets[direction];
    if (!offset) return null;
    const x = pos.x + offset[0];
    const y = pos.y + offset[1];
    if (x < 0 || x > 49 || y < 0 || y > 49) return null;
    return new RoomPosition(x, y, pos.roomName);
  },

  /**
   * 检查 Creep 是否站在道路上
   * @param {Creep} creep
   * @returns {boolean}
   */
  isOnRoad: function (creep: Creep) {
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
  parkOffRoad: function (
    creep: Creep,
    anchor: RoomPosition | { pos: RoomPosition } | null = null,
    range = 1,
  ) {
    if ((creep as any)._moveExecuted) return;
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
        // 避开障碍物
        if (
          structures.some(
            (s) =>
              s.structureType !== STRUCTURE_CONTAINER &&
              s.structureType !== STRUCTURE_RAMPART &&
              // @ts-ignore
              ((typeof OBSTACLE_OBJECT_TYPES !== "undefined" &&
                // @ts-ignore
                OBSTACLE_OBJECT_TYPES.includes(s.structureType)) ||
                s.structureType === "constructedWall"),
          )
        )
          continue;

        // 检查 Creeps
        if (pos.lookFor(LOOK_CREEPS).length > 0) continue;

        // 检查锚点范围
        if (anchor) {
          const anchorPos = (anchor as any).pos || anchor;
          if (!pos.inRangeTo(anchorPos, range)) continue;
        }

        adjacent.push(pos);
      }
    }

    if (adjacent.length > 0) {
      // 随机选择或选择第一个
      const target = adjacent[Math.floor(Math.random() * adjacent.length)];
      creep.move(creep.pos.getDirectionTo(target));
      (creep as any)._moveExecuted = true;
      creep.say("🚷 park");
    }
  },

  /**
   * 处理来自其他 Creep 的移动请求 (对穿/避让)
   * 应在 Role 逻辑结束后调用，确保那些没有调用 smartMove 的 Creep (如正在挖矿/工作的) 也能响应请求
   * @param {Creep} creep
   */
  handleRequests: function (creep: Creep) {
    // 如果本 tick 已经执行过移动逻辑 (smartMove)，则跳过 (smartMove 内部会处理)
    if ((creep as any)._moveExecuted) return;

    const moveRequest = creep.memory._moveRequest;
    if (moveRequest && moveRequest.tick === Game.time) {
      // Simple accept
      creep.move(moveRequest.dir);
      delete creep.memory._moveRequest;
      (creep as any)._moveExecuted = true;
    }
  },

  /**
   * Flee from hostiles to a safe room (Home or Fortress)
   */
  flee: function (creep: Creep, homeRoom: string) {
    // 1. Find enemies to avoid
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    const goals = hostiles.map((h) => ({ pos: h.pos, range: 10 }));

    // 2. Determine Safe Destination
    // If we are in danger room, move to exit towards home
    if (creep.room.name !== homeRoom) {
      const route = Game.map.findRoute(creep.room, homeRoom);
      if (route && route !== ERR_NO_PATH && route.length > 0) {
        const exit = creep.pos.findClosestByRange(route[0].exit);
        if (exit) {
          creep.moveTo(exit, {
            visualizePathStyle: { stroke: "#ff0000", lineStyle: "dashed" },
            reusePath: 5,
          });
          creep.say("🏃💨 flee");
          return;
        }
      }
    }

    // 3. If in home room or no path, PathFinder.search to run away from enemies
    const ret = PathFinder.search(creep.pos, goals, {
      flee: true,
      roomCallback: (roomName) => {
        const room = Game.rooms[roomName];
        if (!room) return false;
        const costs = new PathFinder.CostMatrix();
        room.find(FIND_STRUCTURES).forEach(function (struct) {
          if (struct.structureType === STRUCTURE_ROAD) {
            // Favor roads
            costs.set(struct.pos.x, struct.pos.y, 1);
          } else if (
            struct.structureType !== STRUCTURE_CONTAINER &&
            (struct.structureType !== STRUCTURE_RAMPART || !struct.my)
          ) {
            // Can't walk through non-walkable buildings
            costs.set(struct.pos.x, struct.pos.y, 0xff);
          }
        });
        return costs;
      },
    });

    if (ret.path.length > 0) {
      creep.move(creep.pos.getDirectionTo(ret.path[0]));
      creep.say("😱 panic");
    }
  },
};

export default moveModule;
