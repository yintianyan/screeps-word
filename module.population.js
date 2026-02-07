const Cache = require("./core.cache");
const Lifecycle = require("./module.lifecycle");

const populationModule = {
  // === 配置区域 (Config) ===
  config: {
    // 角色基础配比
    ratios: {
      harvesterPerSource: 1, // 每个 Source 1 个 Harvester (定点挖掘)
      haulerBaseCount: 1, // 基础 Hauler 数量
    },
    // 角色上限
    limits: {
      builder: 3,
      upgrader: 3,
      hauler: 6,
    },
  },

  /**
   * 标准内核模块接口
   */
  run: function (room) {
    // 每 5 tick 运行一次重新平衡
    if (Game.time % 5 === 0) {
      this.rebalanceHaulers(room);
    }
  },

  /** @param {Room} room **/
  calculateTargets: function (room) {
    const targets = {
      harvester: 0,
      upgrader: 0,
      builder: 0,
      hauler: 0,
    };

    // 使用缓存获取 Source (堆缓存)
    const sources = Cache.getHeap(`sources_${room.name}`, () =>
      room.find(FIND_SOURCES),
    );
    const sourceCount = sources.length;

    // 使用缓存获取各角色 Creep (Tick 缓存)
    // 过滤掉非活跃状态的 Creep (濒死者) 以避免重复计算
    const allHaulers = Cache.getCreepsByRole(room, "hauler");
    const haulers = allHaulers.filter((c) => Lifecycle.isOperational(c));

    // === 1. Harvester: 动态计算 ===
    // 基础目标：每个 Source 1 个
    // 危机模式 (Low Energy)：如果能量不足且 Creep 只有小体型，允许更多 Harvester 并行开采
    let harvesterTarget = 0;

    // 计算每个 Source 的可用空位 (cached)
    sources.forEach((source) => {
      const spots = Cache.getHeap(`spots_${source.id}`, () => {
        let count = 0;
        const terrain = room.getTerrain();
        for (let x = -1; x <= 1; x++) {
          for (let y = -1; y <= 1; y++) {
            if (x === 0 && y === 0) continue;
            if (
              terrain.get(source.pos.x + x, source.pos.y + y) !==
              TERRAIN_MASK_WALL
            ) {
              count++;
            }
          }
        }
        return count;
      });

      // 默认 1 个
      let desired = 1;

      // 危机检测：
      // 1. 能量极低 (< 40% 容量)
      // 2. 或者当前 Harvester 平均体型太小 (Work 部件少)
      // 简单判断：如果 room capacity > 800 但 current available < 400，说明可能刚死了一批大的，只能造小的
      // 我们允许填满所有空位，直到达到 source 上限 (3000/300 = 10 energy/tick = 5 WORK parts)
      // 如果都是小 creep (2 WORK), 需要 3 个才能抵 1 个大的

      const isEmergency =
        room.energyAvailable < room.energyCapacityAvailable * 0.4 ||
        room.energyAvailable < 400;

      if (isEmergency) {
        // 危机时刻，允许最大化开采 (但不超过空位数，也不超过 3 个)
        desired = Math.min(spots, 3);
        // 仅在 console 偶尔打印，避免刷屏
        if (Game.time % 20 === 0 && desired > 1) {
          console.log(
            `[Population] 🚨 能源危机 (Available: ${room.energyAvailable}) - Source ${source.id} 启用多采集者模式 (Target: ${desired})`,
          );
        }
      } else {
        // 正常时刻，检查是否需要 2 个 (针对 RCL 低但有多个空位的情况)
        // 如果 RCL < 3 (Capacity < 800)，单个 Creep 做不到 5 WORK + 1 CARRY + MOVE
        // 此时允许 2 个
        if (room.energyCapacityAvailable < 550 && spots >= 2) {
          desired = 2;
        }
      }

      harvesterTarget += desired;
    });

    targets.harvester = harvesterTarget;

    // 2. Hauler:
    const haulerNeeds = this.getHaulerNeeds(room);
    targets.hauler = 0;
    for (const sourceId in haulerNeeds) {
      targets.hauler += haulerNeeds[sourceId];
    }

    targets.hauler = Math.min(targets.hauler, this.config.limits.hauler);

    if (targets.harvester > 0 && targets.hauler < 1) {
      targets.hauler = 1;
    }

    // 3. 智能支出者平衡 (Smart Spender Balancing)
    // 使用缓存获取建筑工地
    const sites = Cache.getTick(`sites_${room.name}`, () =>
      room.find(FIND_CONSTRUCTION_SITES),
    );

    const criticalSites = sites.filter(
      (s) =>
        s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_TOWER ||
        s.structureType === STRUCTURE_STORAGE ||
        s.structureType === STRUCTURE_CONTAINER,
    );

    // 能量水平评估
    const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
    const storageEnergy = room.storage
      ? room.storage.store[RESOURCE_ENERGY]
      : 0;
    const storageCapacity = room.storage
      ? room.storage.store.getCapacity(RESOURCE_ENERGY)
      : 0;

    // 使用缓存获取容器
    const containers = Cache.getStructures(room, STRUCTURE_CONTAINER);
    let containerBacklog = 0;
    containers.forEach((c) => (containerBacklog += c.store[RESOURCE_ENERGY]));
    const containerCapacity = containers.length * 2000;

    // 计算总存储比例 (Storage Percentage)
    let storedPercentage = 0;
    if (storageCapacity > 0) {
      storedPercentage = storageEnergy / storageCapacity;
    } else if (containerCapacity > 0) {
      storedPercentage = containerBacklog / containerCapacity;
    }

    // === 状态机管理 (State Machine: Crisis Control) ===
    // 目标：进入能源危机后，停止所有消耗性能源的工作，直到恢复到一定阈值
    if (!room.memory.energyState) room.memory.energyState = "NORMAL";

    // 阈值设定 (20% 进入危机, 40% 恢复)
    const CRISIS_THRESHOLD = 0.2;
    const RECOVERY_THRESHOLD = 0.4;

    if (room.memory.energyState === "NORMAL") {
      if (storedPercentage < CRISIS_THRESHOLD) {
        room.memory.energyState = "CRISIS";
        console.log(
          `[Population] ⚠️ 能源告急！进入危机模式 (Storage: ${(storedPercentage * 100).toFixed(1)}%) - 停止升级与建筑`,
        );
      }
    } else if (room.memory.energyState === "CRISIS") {
      if (storedPercentage > RECOVERY_THRESHOLD) {
        room.memory.energyState = "NORMAL";
        console.log(
          `[Population] ✅ 能源恢复！解除危机模式 (Storage: ${(storedPercentage * 100).toFixed(1)}%) - 恢复生产`,
        );
      }
    }

    const isCrisis = room.memory.energyState === "CRISIS";

    targets.builder = 0;

    if (isCrisis) {
      // === 危机模式 ===
      // 停止一切非必要消耗
      targets.builder = 0;
      targets.upgrader = 0;

      // 唯一的例外：Controller 即将降级 ( < 4000 ticks )
      if (room.controller && room.controller.ticksToDowngrade < 4000) {
        console.log(
          `[Population] 🚨 紧急：Controller 即将降级，强制维持 Upgrader`,
        );
        targets.upgrader = 1;
      }
    } else {
      // === 正常模式 (NORMAL) ===

      // === 3. Builder Regulation ===
      // 只有当存储能量 > 70% 时，才允许进行大规模建造
      // 例外：关键设施 (Spawn/Extension/Tower) 即使低能量也允许少量建造
      if (criticalSites.length > 0) {
        targets.builder = 2; // 关键设施优先
      } else if (sites.length > 0) {
        if (storedPercentage > 0.5) {
          // 能源充足 (>50%)，全力建造
          targets.builder = 3;
        } else if (storedPercentage > 0.2) {
          // 能源一般 (>20%)，维持最低建造 (1个)
          targets.builder = 1;
        } else {
          // 能源不足 (< 20%)，停止建造，专注挖矿
          targets.builder = 0;
        }
      }

      // === 4. Upgrader Regulation ===
      // 根据存储比例调节 Upgrader 数量
      if (storedPercentage > 0.8) {
        targets.upgrader = 3; // 能源过剩，全力升级
      } else if (storedPercentage > 0.5) {
        targets.upgrader = 2; // 能源健康，适度升级
      } else {
        targets.upgrader = 1; // 能源紧缺，仅维持 Controller
      }

      // 额外逻辑：如果 Container 爆仓 (Storage 没建好时)，也允许升级
      if (storageCapacity === 0 && containerBacklog > containerCapacity * 0.8) {
        targets.upgrader = 2;
      }

      if (room.controller && room.controller.ticksToDowngrade < 4000) {
        targets.upgrader = this.config.limits.upgrader;
        targets.builder = 0;
      }
    }

    targets.builder = Math.min(targets.builder, this.config.limits.builder);
    targets.upgrader = Math.min(targets.upgrader, this.config.limits.upgrader);

    if (targets.upgrader > 0) {
      targets.hauler += 1;
    }
    targets.hauler = Math.min(targets.hauler, this.config.limits.hauler);

    return targets;
  },

  /**
   * 智能计算每个 Source 需要的 Hauler 数量
   * @param {Room} room
   * @returns {Object} { sourceId: number }
   */
  getHaulerNeeds: function (room) {
    const needs = {};
    // 使用缓存
    const sources = Cache.getHeap(`sources_${room.name}`, () =>
      room.find(FIND_SOURCES),
    );

    // 检查是否有全局等待情况 (Upgrader/Builder 饥饿)
    // 如果 Upgrader 等待时间过长，说明运力不足，给每个 Source 都增加配额
    let globalBoost = 0;
    const upgraders = Cache.getCreepsByRole(room, "upgrader").filter((c) =>
      Lifecycle.isOperational(c),
    );

    const avgIdle =
      upgraders.reduce((sum, c) => sum + (c.memory.idleTicks || 0), 0) /
      (upgraders.length || 1);
    if (avgIdle > 20) {
      globalBoost = 1;
    }

    const overrides =
      Memory.config && Memory.config.haulerOverrides
        ? Memory.config.haulerOverrides
        : {};

    sources.forEach((source) => {
      if (overrides[source.id] !== undefined) {
        needs[source.id] = overrides[source.id];
        return;
      }

      let count = this.config.ratios.haulerBaseCount;

      // 1. 检查 Container 积压 (尽可能使用缓存结构，但 findInRange 是特定的)
      // 优化：从缓存获取所有容器并手动过滤范围 (比 findInRange 便宜)
      const allContainers = Cache.getStructures(room, STRUCTURE_CONTAINER);
      const container = allContainers.find((c) => c.pos.inRangeTo(source, 2));

      if (container) {
        const energy = container.store[RESOURCE_ENERGY];
        if (energy > 1800) {
          count += 2;
        } else if (energy > 1000) {
          count += 1;
        }
      }

      // 2. 检查掉落能量 (掉落资源的 Tick 缓存)
      const allDropped = Cache.getTick(`dropped_${room.name}`, () =>
        room.find(FIND_DROPPED_RESOURCES),
      );
      const dropped = allDropped.filter(
        (r) => r.resourceType === RESOURCE_ENERGY && r.pos.inRangeTo(source, 3),
      );

      const droppedAmount = dropped.reduce((sum, r) => sum + r.amount, 0);
      if (droppedAmount > 500) {
        count += 1;
      }

      count += globalBoost;
      count = Math.min(count, 3);
      needs[source.id] = count;
    });

    return needs;
  },

  /**
   * 动态平衡搬运工分配
   */
  rebalanceHaulers: function (room) {
    const needs = this.getHaulerNeeds(room);
    // 仅重新平衡健康的 Hauler
    const haulers = Cache.getCreepsByRole(room, "hauler").filter(
      (c) => c.ticksToLive > 100 && Lifecycle.isOperational(c),
    );

    // ... (其余逻辑相同，但使用缓存的 Haulers)
    const currentCounts = {};
    const surplus = [];
    const deficit = [];

    Object.keys(needs).forEach((id) => (currentCounts[id] = 0));

    haulers.forEach((c) => {
      if (c.memory.sourceId) {
        currentCounts[c.memory.sourceId] =
          (currentCounts[c.memory.sourceId] || 0) + 1;
      }
    });

    for (const sourceId in needs) {
      const diff = (currentCounts[sourceId] || 0) - needs[sourceId];
      if (diff > 0) {
        const sourceHaulers = haulers.filter(
          (c) => c.memory.sourceId === sourceId,
        );
        for (let i = 0; i < diff; i++) {
          if (sourceHaulers[i]) {
            surplus.push(sourceHaulers[i]);
          }
        }
      } else if (diff < 0) {
        deficit.push({ id: sourceId, amount: -diff });
      }
    }

    if (surplus.length > 0 && deficit.length > 0) {
      console.log(
        `[Population] 重新平衡搬运工: 盈余 ${surplus.length}, 赤字 ${deficit.reduce((a, b) => a + b.amount, 0)}`,
      );
      let surplusIndex = 0;
      for (const item of deficit) {
        for (let i = 0; i < item.amount; i++) {
          if (surplusIndex >= surplus.length) break;
          const creep = surplus[surplusIndex++];
          const oldSource = creep.memory.sourceId;
          creep.memory.sourceId = item.id;
          delete creep.memory.targetId;
          creep.say("🔀 reassign");
          console.log(
            `[Population] 将 ${creep.name} 从 Source ${oldSource} 重新分配给 ${item.id}`,
          );
        }
      }
    }
  },
};

module.exports = populationModule;
