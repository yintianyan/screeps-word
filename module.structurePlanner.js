const structurePlanner = {
  run: function (room) {
    // 每 10 tick 运行一次，节省 CPU
    if (Game.time % 10 !== 0) return;

    const analysis = this.analyzeRoom(room);
    this.visualize(room, analysis);
    this.execute(room, analysis);
  },

  /**
   * 1. 空间分析模块
   */
  analyzeRoom: function (room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    const sources = room.find(FIND_SOURCES);
    const controller = room.controller;

    if (!spawn || !controller) return null;

    // 计算资源点几何中心
    let sumX = 0,
      sumY = 0;
    sources.forEach((s) => {
      sumX += s.pos.x;
      sumY += s.pos.y;
    });
    const centerPos = new RoomPosition(
      Math.floor(sumX / sources.length),
      Math.floor(sumY / sources.length),
      room.name,
    );

    // 计算 Spawn 到几何中心的距离
    const spawnToCenter = spawn.pos.getRangeTo(centerPos);

    // 计算 Spawn 到各资源点的平均距离
    let totalSpawnDist = 0;
    sources.forEach((s) => (totalSpawnDist += spawn.pos.getRangeTo(s)));
    const avgSpawnDist = totalSpawnDist / sources.length;

    // 计算控制器到最近资源点的距离
    let minControllerDist = 999;
    sources.forEach((s) => {
      const d = controller.pos.getRangeTo(s);
      if (d < minControllerDist) minControllerDist = d;
    });

    // 资源点分布跨度
    let maxSourceSpan = 0;
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const d = sources[i].pos.getRangeTo(sources[j]);
        if (d > maxSourceSpan) maxSourceSpan = d;
      }
    }

    return {
      spawn,
      sources,
      controller,
      centerPos,
      spawnToCenter,
      avgSpawnDist,
      minControllerDist,
      maxSourceSpan,
      isSpawnCentral: spawnToCenter < 10 || spawnToCenter < avgSpawnDist * 0.5, // Spawn 位于中心区域
      isControllerIsolated: minControllerDist > 15, // 控制器比较偏远
    };
  },

  /**
   * 2. 建造决策与执行
   */
  execute: function (room, analysis) {
    if (!analysis) return;

    // 异常处理：资源不足暂停建造
    // 只有当有工地时才检查这个，或者在 createConstructionSite 前检查
    // 这里我们设定一个软阈值，如果房间能量极低 (<300)，暂缓规划新工地
    if (
      room.energyAvailable < 300 &&
      room.find(FIND_MY_CONSTRUCTION_SITES).length > 0
    ) {
      return;
    }

    const rcl = room.controller.level;

    // === 阶段 1: 基础资源点容器 (RCL >= 2) ===
    if (rcl >= 2) {
      analysis.sources.forEach((source) => {
        this.planContainer(room, source.pos, 1, "SourceMining");
      });
    }

    // === 阶段 2: 中转仓网络 (RCL >= 3) ===
    if (rcl >= 3) {
      // 决策 1: Spawn 中转仓
      // 如果 Spawn 位于中心，或者为了方便 Hauler 卸货，在 Spawn 附近必造一个
      if (analysis.isSpawnCentral) {
        // 在 Spawn 周围 2 格内找最佳位置 (优先选靠近 CenterPos 的方向)
        this.planContainer(
          room,
          analysis.spawn.pos,
          2,
          "SpawnTransfer",
          analysis.centerPos,
        );
      }

      // 决策 2: Controller 接收仓
      // 如果控制器偏远，必须造
      if (analysis.isControllerIsolated) {
        this.planContainer(
          room,
          analysis.controller.pos,
          3,
          "ControllerReceiver",
          analysis.spawn.pos,
        );
      }
    }

    // === 阶段 3: 二级中转点 (多级网络) ===
    // 当资源点跨度过大 (>50) 时
    if (analysis.maxSourceSpan > 50) {
      // 在 Spawn 和最远 Source 的中间点规划二级中转 (简化逻辑)
      // 暂不实现复杂寻路，仅标记
    }
  },

  /**
   * 通用容器规划器
   * @param {Room} room
   * @param {RoomPosition} centerPos 搜索中心
   * @param {number} range 搜索半径
   * @param {string} type 类型标识 (用于日志)
   * @param {RoomPosition} biasPos (可选) 偏向目标，选择靠近该目标的位置
   */
  planContainer: function (room, centerPos, range, type, biasPos) {
    // 1. 检查已有设施
    const existing = centerPos.findInRange(FIND_STRUCTURES, range, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    const sites = centerPos.findInRange(FIND_MY_CONSTRUCTION_SITES, range, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });

    if (existing.length > 0 || sites.length > 0) return; // 已存在

    // 2. 寻找最佳建造位
    // 扫描 range 范围内的所有非墙空地
    let bestPos = null;
    let minBiasDist = 999;

    for (let x = centerPos.x - range; x <= centerPos.x + range; x++) {
      for (let y = centerPos.y - range; y <= centerPos.y + range; y++) {
        // 排除中心点本身 (Source/Spawn/Controller 都是实体，不可重叠建造)
        if (x === centerPos.x && y === centerPos.y) continue;

        const pos = new RoomPosition(x, y, room.name);
        const terrain = room.getTerrain().get(x, y);

        if (terrain === TERRAIN_MASK_WALL) continue;

        // === 严格冲突检测 ===
        // 1. 检查资源点 (Source) - 绝对不可覆盖
        const sources = pos.lookFor(LOOK_SOURCES);
        if (sources.length > 0) continue;

        // 2. 检查建筑占用 (除了路和 Rampart)
        const structures = pos.lookFor(LOOK_STRUCTURES);
        const isBlockedByStructure = structures.some(
          (s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_RAMPART,
        );
        if (isBlockedByStructure) continue;

        // 3. 检查工地占用 (除了路和 Rampart)
        const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
        const isBlockedBySite = sites.some(
          (s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_RAMPART,
        );
        if (isBlockedBySite) continue;

        // 评分逻辑
        // 如果有偏向目标 (biasPos)，选离它最近的
        let score = 0;
        if (biasPos) {
          const dist = pos.getRangeTo(biasPos);
          if (dist < minBiasDist) {
            minBiasDist = dist;
            bestPos = pos;
          }
        } else {
          // 默认选开阔地 (周围空地多)
          // 简化：直接选第一个能造的，或者距离中心 range 的位置
          // 对于 Mining Container，通常选距离 1
          if (type === "SourceMining" && pos.getRangeTo(centerPos) === 1) {
            bestPos = pos; // 只要是 Range 1 就行
            break;
          }
          if (!bestPos) bestPos = pos;
        }
      }
      if (bestPos && type === "SourceMining") break;
    }

    // 3. 执行建造
    if (bestPos) {
      console.log(`[Planner] 规划建造 ${type} @ ${bestPos.x},${bestPos.y}`);
      room.createConstructionSite(bestPos.x, bestPos.y, STRUCTURE_CONTAINER);
    }
  },

  /**
   * 4. 报告与可视化
   */
  visualize: function (room, analysis) {
    if (!analysis) return;
    const visual = new RoomVisual(room.name);

    // 绘制几何中心
    visual.circle(analysis.centerPos, {
      fill: "transparent",
      radius: 0.5,
      stroke: "#00ffff",
    });
    visual.text(
      "Target Center",
      analysis.centerPos.x,
      analysis.centerPos.y + 0.2,
      { color: "#00ffff", font: 0.3 },
    );

    // 绘制连线
    analysis.sources.forEach((s) => {
      visual.line(analysis.spawn.pos, s.pos, {
        color: "#555555",
        lineStyle: "dashed",
      });
    });
    visual.line(analysis.spawn.pos, analysis.controller.pos, {
      color: "#555555",
      lineStyle: "dashed",
    });

    // 输出分析报告
    const x = 1;
    const y = 8;
    visual.text(`🏗️ Structure Planner Report`, x, y, {
      align: "left",
      color: "#ffffff",
    });
    visual.text(
      `Spawn Centrality: ${analysis.isSpawnCentral ? "YES" : "NO"} (Dist: ${analysis.spawnToCenter.toFixed(1)})`,
      x,
      y + 1,
      { align: "left", color: "#aaaaaa", font: 0.5 },
    );
    visual.text(
      `Controller Isolated: ${analysis.isControllerIsolated ? "YES" : "NO"} (Dist: ${analysis.minControllerDist})`,
      x,
      y + 2,
      { align: "left", color: "#aaaaaa", font: 0.5 },
    );
    visual.text(`Source Span: ${analysis.maxSourceSpan}`, x, y + 3, {
      align: "left",
      color: "#aaaaaa",
      font: 0.5,
    });

    // 预计效率提升 (模拟数据)
    const efficiency = analysis.isSpawnCentral ? "High (>50%)" : "Normal";
    visual.text(`Est. Efficiency Gain: ${efficiency}`, x, y + 4, {
      align: "left",
      color: "#00ff00",
      font: 0.5,
    });
  },
};

module.exports = structurePlanner;
