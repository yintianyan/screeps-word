import Cache from "../../components/memoryManager";

const structurePlanner = {
  _cache: {} as any,

  run: function (room) {
    // 1. Analyze & Execute (Low Frequency)
    if (Game.time % 10 === 0 || !this._cache[room.name]) {
      const analysis = this.analyzeRoom(room);
      this._cache[room.name] = analysis;
      this.execute(room, analysis);
    }

    // 2. Visualize (High Frequency)
    const analysis = this._cache[room.name];
    if (analysis) {
      this.visualize(room, analysis);
    }
  },

  /**
   * 1. 空间分析模块
   */
  analyzeRoom: function (room) {
    const spawn = Cache.getTick(`spawn_${room.name}`, () => {
      const spawns = room.find(FIND_MY_SPAWNS);
      return spawns[0];
    });
    const sources = Cache.getTick(`sources_${room.name}`, () =>
      room.find(FIND_SOURCES),
    );
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

    // 1. 全局工地数量检查 (Throttling)
    // 防止一次性铺设过多工地，导致 Builder 跑断腿且能量枯竭
    // 如果现有工地超过 10 个，暂停所有新规划
    const existingSites = Cache.getTick(`my_sites_${room.name}`, () =>
      room.find(FIND_MY_CONSTRUCTION_SITES),
    );
    if (existingSites.length > 10) {
      return;
    }

    // 2. 异常处理：资源不足暂停建造
    if (room.energyAvailable < 300 && existingSites.length > 0) {
      return;
    }

    const rcl = room.controller.level;

    // === 阶段 1: 基础资源点容器 (RCL >= 2) ===
    if (rcl >= 2) {
      analysis.sources.forEach((source) => {
        this.planContainer(room, source.pos, 1, "SourceMining");
      });

      // 规划 Extension (RCL >= 2)
      this.planExtensions(room, analysis);

      // 规划道路 (低频)
      if (Game.time % 100 === 0) {
        this.planRoads(room, analysis);
      }
    }

    // === 阶段 2: 中转仓网络 & 塔 (RCL >= 3) ===
    if (rcl >= 3) {
      // 决策 1: Spawn 中转仓
      if (analysis.isSpawnCentral) {
        this.planContainer(
          room,
          analysis.spawn.pos,
          2,
          "SpawnTransfer",
          analysis.centerPos,
        );
      }

      // 决策 2: Controller 接收仓
      if (analysis.isControllerIsolated) {
        this.planContainer(
          room,
          analysis.controller.pos,
          3,
          "ControllerReceiver",
          analysis.spawn.pos,
        );
      }

      // 决策 3: 防御塔
      this.planTowers(room, analysis);
    }

    // === 阶段 3: 存储系统 (RCL >= 4) ===
    if (rcl >= 4) {
      this.planStorage(room, analysis);
    }

    // === 阶段 4: 链路系统 (RCL >= 5) ===
    if (rcl >= 5) {
      this.planLinks(room, analysis);
    }

    // === 阶段 5: 矿产采集 (RCL >= 6) ===
    if (rcl >= 6) {
      this.planExtractor(room);
      this.planTerminal(room, analysis);
      this.planLabs(room, analysis);
    }

    // === 阶段 6: 高级工业 (RCL >= 7) ===
    if (rcl >= 7) {
      this.planFactory(room, analysis);
      this.planSpawns(room, analysis);
    }

    // === 阶段 7: 终极建筑 (RCL >= 8) ===
    if (rcl >= 8) {
      this.planLateGameStructures(room, analysis);
    }
  },

  /**
   * 规划 Extension (棋盘格布局)
   * 根据 RCL 和 能量百分比 逐步建造
   */
  planExtensions: function (room, analysis) {
    const rcl = room.controller.level;
    const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] || 0;
    if (maxExtensions === 0) return;

    // 1. 统计现状
    const existing = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_EXTENSION,
    });
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_EXTENSION,
    });

    const total = existing.length + sites.length;
    if (total >= maxExtensions) return; // 已达上限

    // 2. 逐步建造逻辑 (Gradual Build)
    // 只有当当前工地很少，且能量充足时，才规划新的
    // 防止一次性铺设太多工地导致能量被掏空
    if (sites.length > 0) return; // 每次只规划一个，建完再规划下一个

    // 能量阈值检查
    // 用户要求：根据能量百分比逐渐新建
    // 设定：能量 > 80% 容量时才允许扩建
    // (在低等级时 80% 可能太难，设个保底值)
    const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
    if (energyRatio < 0.8 && room.energyAvailable < 1000) return;

    // 3. 寻找位置 (围绕 Spawn 的棋盘格)
    // 棋盘格：(x + y) % 2 === 0 放 Extension，=== 1 放路/空地
    const center = analysis.spawn.pos;
    let bestPos = null;

    // 从内圈向外圈扫描
    // Range 2 (避开 Spawn 贴身) 到 10 (通常够了)
    for (let r = 2; r <= 15; r++) {
      for (let x = center.x - r; x <= center.x + r; x++) {
        for (let y = center.y - r; y <= center.y + r; y++) {
          // 只检查边缘的一圈 (Ring)
          if (Math.abs(x - center.x) !== r && Math.abs(y - center.y) !== r)
            continue;

          // 边界检查
          if (x < 2 || x > 47 || y < 2 || y > 47) continue;

          // 棋盘格检查
          if ((x + y) % 2 !== 0) continue;

          // 地形检查
          const terrain = room.getTerrain().get(x, y);
          if (terrain === TERRAIN_MASK_WALL) continue;

          const pos = new RoomPosition(x, y, room.name);

          // 冲突检查 (建筑、工地、Source、Controller)
          // 避开 Source 及其周围 1 格 (保留开采位)
          if (pos.findInRange(FIND_SOURCES, 1).length > 0) continue;
          // 避开 Controller 及其周围 2 格 (保留升级位)
          if (pos.inRangeTo(room.controller, 2)) continue;

          // 避开已有建筑/工地
          const structures = pos.lookFor(LOOK_STRUCTURES);
          if (structures.length > 0) continue; // 任何建筑都避开 (包括路，因为我们要造在空地上)

          const existingSites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
          if (existingSites.length > 0) continue;

          // 找到一个可用位置
          bestPos = pos;
          break;
        }
        if (bestPos) break;
      }
      if (bestPos) break;
    }

    // 4. 执行
    if (bestPos) {
      console.log(
        `[Planner] 规划 Extension (${total + 1}/${maxExtensions}) @ ${bestPos.x},${bestPos.y} (Energy: ${(energyRatio * 100).toFixed(1)}%)`,
      );
      room.createConstructionSite(bestPos, STRUCTURE_EXTENSION);
    }
  },

  /**
   * 规划防御塔
   */
  planTowers: function (room, analysis) {
    const rcl = room.controller.level;
    const maxTowers = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl] || 0;
    if (maxTowers === 0) return;

    const existing = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    });
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    });

    if (existing.length + sites.length >= maxTowers) return;
    if (sites.length > 0) return; // 每次规划一个

    // 选址：Spawn 周围 3-5 格
    // 塔应该分散一点，覆盖全图，但主要保护 Spawn
    const center = analysis.spawn.pos;
    let bestPos = null;

    for (let r = 3; r <= 5; r++) {
      for (let x = center.x - r; x <= center.x + r; x++) {
        for (let y = center.y - r; y <= center.y + r; y++) {
          if (Math.abs(x - center.x) !== r && Math.abs(y - center.y) !== r)
            continue;
          if (x < 2 || x > 47 || y < 2 || y > 47) continue;

          const pos = new RoomPosition(x, y, room.name);
          if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) continue;

          // 避开建筑和路
          if (pos.lookFor(LOOK_STRUCTURES).length > 0) continue;
          if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) continue;

          bestPos = pos;
          break;
        }
        if (bestPos) break;
      }
      if (bestPos) break;
    }

    if (bestPos) {
      console.log(`[Planner] 规划 Tower @ ${bestPos.x},${bestPos.y}`);
      room.createConstructionSite(bestPos, STRUCTURE_TOWER);
    }
  },

  /**
   * 规划 Storage (中央仓库)
   */
  planStorage: function (room, analysis) {
    if (
      room.storage ||
      room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_STORAGE,
      }).length > 0
    )
      return;

    // 选址：优先选几何中心 (centerPos) 附近的空地
    // 且最好靠近 Spawn (如果几何中心太远)
    let targetPos = analysis.centerPos;
    if (analysis.spawn.pos.getRangeTo(targetPos) > 15) {
      // 如果中心太远，折中一下，取 Spawn 和 Source 中心的中点
      const midX = Math.floor((analysis.spawn.pos.x + targetPos.x) / 2);
      const midY = Math.floor((analysis.spawn.pos.y + targetPos.y) / 2);
      targetPos = new RoomPosition(midX, midY, room.name);
    }

    const bestPos = this.findSpotNear(room, targetPos, 2);
    if (bestPos) {
      console.log(`[Planner] 规划 Storage @ ${bestPos.x},${bestPos.y}`);
      room.createConstructionSite(bestPos, STRUCTURE_STORAGE);
    }
  },

  /**
   * 规划 Links (传送链路)
   */
  planLinks: function (room, analysis) {
    const rcl = room.controller.level;
    const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK][rcl] || 0;
    if (maxLinks === 0) return;

    const existing = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LINK,
    });
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_LINK,
    });
    if (existing.length + sites.length >= maxLinks) return;
    if (sites.length > 0) return;

    // 优先级 1: Storage Link (中央枢纽)
    if (room.storage) {
      const storageLink = room.storage.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: (s) => s.structureType === STRUCTURE_LINK,
      })[0];
      const storageSite = room.storage.pos.findInRange(
        FIND_MY_CONSTRUCTION_SITES,
        2,
        { filter: (s) => s.structureType === STRUCTURE_LINK },
      )[0];

      if (!storageLink && !storageSite) {
        const pos = this.findSpotNear(room, room.storage.pos, 2);
        if (pos) {
          room.createConstructionSite(pos, STRUCTURE_LINK);
          return;
        }
      }
    }

    // 优先级 2: Controller Link (远程升级)
    if (analysis.isControllerIsolated) {
      const controllerLink = room.controller.pos.findInRange(
        FIND_STRUCTURES,
        3,
        { filter: (s) => s.structureType === STRUCTURE_LINK },
      )[0];
      const controllerSite = room.controller.pos.findInRange(
        FIND_MY_CONSTRUCTION_SITES,
        3,
        { filter: (s) => s.structureType === STRUCTURE_LINK },
      )[0];

      if (!controllerLink && !controllerSite) {
        const pos = this.findSpotNear(room, room.controller.pos, 3);
        if (pos) {
          room.createConstructionSite(pos, STRUCTURE_LINK);
          return;
        }
      }
    }

    // 优先级 3: Source Links (远程采集)
    for (const source of analysis.sources) {
      // 只有当 Source 离 Storage 较远 (>10) 时才配 Link
      if (room.storage && source.pos.getRangeTo(room.storage) < 10) continue;

      const sourceLink = source.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: (s) => s.structureType === STRUCTURE_LINK,
      })[0];
      const sourceSite = source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 2, {
        filter: (s) => s.structureType === STRUCTURE_LINK,
      })[0];

      if (!sourceLink && !sourceSite) {
        const pos = this.findSpotNear(room, source.pos, 2);
        if (pos) {
          room.createConstructionSite(pos, STRUCTURE_LINK);
          return;
        }
      }
    }
  },

  /**
   * 规划 Extractor (矿物采集)
   */
  planExtractor: function (room) {
    const minerals = room.find(FIND_MINERALS);
    if (minerals.length === 0) return;

    const mineral = minerals[0];
    const existing = mineral.pos
      .lookFor(LOOK_STRUCTURES)
      .find((s) => s.structureType === STRUCTURE_EXTRACTOR);
    const site = mineral.pos
      .lookFor(LOOK_CONSTRUCTION_SITES)
      .find((s) => s.structureType === STRUCTURE_EXTRACTOR);

    if (!existing && !site) {
      room.createConstructionSite(mineral.pos, STRUCTURE_EXTRACTOR);
    }
  },

  /**
   * 规划终端 (Terminal)
   */
  planTerminal: function (room, analysis) {
    if (
      room.terminal ||
      room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_TERMINAL,
      }).length > 0
    )
      return;

    // 选址：优先在 Storage 旁边 (Range 2)，方便资源互转
    let targetPos = room.storage ? room.storage.pos : analysis.spawn.pos;
    const bestPos = this.findSpotNear(room, targetPos, 2);

    if (bestPos) {
      console.log(`[Planner] 规划 Terminal @ ${bestPos.x},${bestPos.y}`);
      room.createConstructionSite(bestPos, STRUCTURE_TERMINAL);
    }
  },

  /**
   * 规划实验室 (Labs)
   * 简单的集群布局
   */
  planLabs: function (room, analysis) {
    const rcl = room.controller.level;
    const maxLabs = CONTROLLER_STRUCTURES[STRUCTURE_LAB][rcl] || 0;
    if (maxLabs === 0) return;

    const existing = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LAB,
    });
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_LAB,
    });

    if (existing.length + sites.length >= maxLabs) return;
    if (sites.length > 0) return; // 每次规划一个

    // 寻找 Lab 集群中心
    // 应该离 Spawn/Storage 有一定距离 (5-10)，但不要太远
    // 简单的策略：在 Storage 周围找一块空地
    let center = room.storage ? room.storage.pos : analysis.spawn.pos;
    
    // 如果已经有 Lab，就在现有 Lab 旁边扩展
    if (existing.length > 0) {
      center = existing[0].pos;
    }

    // 搜索空位
    // 优先在现有 Lab 周围 1 格找
    // 如果没有 Lab，就在 Storage 周围 3-5 格找
    let range = existing.length > 0 ? 1 : 5;
    let bestPos = this.findSpotNear(room, center, range);

    // 如果找不到，扩大搜索范围
    if (!bestPos) bestPos = this.findSpotNear(room, center, range + 2);

    if (bestPos) {
      console.log(`[Planner] 规划 Lab (${existing.length + 1}/${maxLabs}) @ ${bestPos.x},${bestPos.y}`);
      room.createConstructionSite(bestPos, STRUCTURE_LAB);
    }
  },

  /**
   * 规划工厂 (Factory)
   */
  planFactory: function (room, analysis) {
    const factory = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_FACTORY,
    })[0];
    const site = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_FACTORY,
    })[0];

    if (factory || site) return;

    // 靠近 Storage/Terminal
    let target = room.terminal ? room.terminal.pos : (room.storage ? room.storage.pos : analysis.spawn.pos);
    const bestPos = this.findSpotNear(room, target, 2);

    if (bestPos) {
      console.log(`[Planner] 规划 Factory @ ${bestPos.x},${bestPos.y}`);
      room.createConstructionSite(bestPos, STRUCTURE_FACTORY);
    }
  },

  /**
   * 规划额外的 Spawn
   */
  planSpawns: function (room, analysis) {
    const rcl = room.controller.level;
    const maxSpawns = CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][rcl] || 1;
    
    const existing = room.find(FIND_MY_SPAWNS);
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_SPAWN,
    });

    if (existing.length + sites.length >= maxSpawns) return;
    if (sites.length > 0) return;

    // 新 Spawn 应该与主 Spawn 有一定距离，避免拥堵，但不要太远
    // 建议距离 5-8 格
    // 尝试在主 Spawn 周围寻找空地
    const mainSpawn = analysis.spawn;
    
    // 简单的螺旋搜索，从距离 5 开始
    let bestPos = null;
    for (let r = 5; r <= 10; r++) {
       bestPos = this.findSpotNear(room, mainSpawn.pos, r);
       if (bestPos) break;
    }

    if (bestPos) {
      console.log(`[Planner] 规划额外 Spawn (${existing.length + 1}/${maxSpawns}) @ ${bestPos.x},${bestPos.y}`);
      room.createConstructionSite(bestPos, STRUCTURE_SPAWN);
    }
  },

  /**
   * 规划大后期建筑 (PowerSpawn, Observer, Nuker)
   */
  planLateGameStructures: function (room, analysis) {
    // 1. PowerSpawn (RCL 8)
    if (!this.hasStructure(room, STRUCTURE_POWER_SPAWN)) {
        const target = room.storage ? room.storage.pos : analysis.spawn.pos;
        const pos = this.findSpotNear(room, target, 5); // 稍微远点没关系
        if (pos) {
            console.log(`[Planner] 规划 PowerSpawn @ ${pos.x},${pos.y}`);
            room.createConstructionSite(pos, STRUCTURE_POWER_SPAWN);
            return; // 每次只规划一个
        }
    }

    // 2. Observer (RCL 8)
    if (!this.hasStructure(room, STRUCTURE_OBSERVER)) {
        const pos = this.findSpotNear(room, analysis.spawn.pos, 8);
        if (pos) {
            console.log(`[Planner] 规划 Observer @ ${pos.x},${pos.y}`);
            room.createConstructionSite(pos, STRUCTURE_OBSERVER);
            return;
        }
    }

    // 3. Nuker (RCL 8)
    if (!this.hasStructure(room, STRUCTURE_NUKER)) {
        const target = room.storage ? room.storage.pos : analysis.spawn.pos;
        const pos = this.findSpotNear(room, target, 6);
        if (pos) {
            console.log(`[Planner] 规划 Nuker @ ${pos.x},${pos.y}`);
            room.createConstructionSite(pos, STRUCTURE_NUKER);
            return;
        }
    }
  },

  hasStructure: function(room, type) {
      return (
          room.find(FIND_STRUCTURES, { filter: s => s.structureType === type }).length > 0 ||
          room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === type }).length > 0
      );
  },

  /**
   * 规划道路 (Highways)
   */
  planRoads: function (room, analysis) {
    // 1. Spawn -> Sources
    analysis.sources.forEach((source) => {
      const path = analysis.spawn.pos.findPathTo(source, {
        ignoreCreeps: true,
        swampCost: 2,
      });
      this.buildHighway(room, path);
    });

    // 2. Spawn -> Controller
    const pathCtrl = analysis.spawn.pos.findPathTo(room.controller, {
      ignoreCreeps: true,
      swampCost: 2,
    });
    this.buildHighway(room, pathCtrl);

    // 3. Spawn -> Storage (如果存在)
    if (room.storage) {
      const pathToStorage = analysis.spawn.pos.findPathTo(room.storage, {
        ignoreCreeps: true,
        swampCost: 2,
      });
      this.buildHighway(room, pathToStorage);
    }
  },

  /**
   * 辅助：构建道路 (支持简易双车道)
   */
  buildHighway: function (room, path) {
    let sitesCreated = 0;
    const maxNewSites = 5; // 每次最多规划 5 个道路工地，防止刷屏

    for (let index = 0; index < path.length; index++) {
      // 检查全局工地限制
      const sites = Cache.getTick(`my_sites_${room.name}`, () =>
        room.find(FIND_MY_CONSTRUCTION_SITES),
      );
      if (sites.length > 10) break;
      if (sitesCreated >= maxNewSites) break;

      const step = path[index];
      const pos = new RoomPosition(step.x, step.y, room.name);

      // 1. 主车道
      if (room.getTerrain().get(step.x, step.y) !== TERRAIN_MASK_WALL) {
        // 检查是否已有路或工地
        const structures = pos.lookFor(LOOK_STRUCTURES);
        const hasRoad = structures.some(
          (s) => s.structureType === STRUCTURE_ROAD,
        );
        const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);

        if (!hasRoad && sites.length === 0) {
          const result = room.createConstructionSite(pos, STRUCTURE_ROAD);
          if (result === OK) sitesCreated++;
        }
      }

      // 2. 副车道 (可选) - 暂时省略以节省 CPU 和 能量
    }
  },

  /**
   * 辅助：在某位置附近找空位
   */
  findSpotNear: function (room, centerPos, range) {
    for (let x = centerPos.x - range; x <= centerPos.x + range; x++) {
      for (let y = centerPos.y - range; y <= centerPos.y + range; y++) {
        if (x < 2 || x > 47 || y < 2 || y > 47) continue;
        const pos = new RoomPosition(x, y, room.name);

        if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) continue;
        if (pos.lookFor(LOOK_STRUCTURES).length > 0) continue;
        if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) continue;
        if (pos.lookFor(LOOK_SOURCES).length > 0) continue;
        if (pos.lookFor(LOOK_MINERALS).length > 0) continue;

        return pos;
      }
    }
    return null;
  },

  /**
   * 通用容器规划器
   * @param {Room} room
   * @param {RoomPosition} centerPos 搜索中心
   * @param {number} range 搜索半径
   * @param {string} type 类型标识 (用于日志)
   * @param {RoomPosition} biasPos (可选) 偏向目标，选择靠近该目标的位置
   */
  planContainer: function (room, centerPos, range, type, biasPos?) {
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
        // let score = 0;
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
    const x = 35;
    const y = 1;
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

export default structurePlanner;
