const Cache = require("core.cache");
const Lifecycle = require("module.lifecycle");

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
   * Standard Kernel Module Interface
   */
  run: function (room) {
    // Run rebalancing every 5 ticks
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

    // Use Cache to get sources (Heap Cached)
    const sources = Cache.getHeap(`sources_${room.name}`, () =>
      room.find(FIND_SOURCES),
    );
    const sourceCount = sources.length;

    // Use Cache to get creeps by role (Tick Cached)
    // Filter out non-operational creeps (dying ones) to avoid double counting
    const allHaulers = Cache.getCreepsByRole(room, "hauler");
    const haulers = allHaulers.filter((c) => Lifecycle.isOperational(c));

    if (haulers.length > 0) {
      targets.harvester = sourceCount * 1;
    } else {
      targets.harvester = sourceCount;
    }

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

    // 3. Smart Spender Balancing
    // Use Cache for construction sites
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

    // Use Cache for containers
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

    targets.builder = 0;

    // === 3. Builder Regulation ===
    // 只有当存储能量 > 70% 时，才允许进行大规模建造
    // 例外：关键设施 (Spawn/Extension/Tower) 即使低能量也允许少量建造
    if (criticalSites.length > 0) {
      targets.builder = 2; // 关键设施优先
    } else if (sites.length > 0) {
      if (storedPercentage > 0.7) {
        // 能源充足，全力建造
        targets.builder = 3;
      } else if (storedPercentage > 0.4) {
        // 能源一般，维持最低建造 (1个)
        targets.builder = 1;
      } else {
        // 能源不足 (< 40%)，停止建造，专注挖矿
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
    // Use Cache
    const sources = Cache.getHeap(`sources_${room.name}`, () =>
      room.find(FIND_SOURCES),
    );

    // 检查是否有全局等待情况 (Upgrader/Builder Starvation)
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

      // 1. 检查 Container 积压 (Use Cached Structures if possible, but findInRange is specific)
      // Optimization: Get all containers from cache and filter by range manually (cheaper than findInRange)
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

      // 2. 检查掉落能量 (Tick Cache for all dropped resources)
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
    // Only rebalance healthy haulers
    const haulers = Cache.getCreepsByRole(room, "hauler").filter(
      (c) => c.ticksToLive > 100 && Lifecycle.isOperational(c),
    );

    // ... (Rest of logic is same, but using cached haulers)
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
        `[Population] Rebalancing Haulers: Surplus ${surplus.length}, Deficit ${deficit.reduce((a, b) => a + b.amount, 0)}`,
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
            `[Population] Reassigning ${creep.name} from Source ${oldSource} to ${item.id}`,
          );
        }
      }
    }
  },
};

module.exports = populationModule;
