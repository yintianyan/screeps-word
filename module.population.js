const populationModule = {
  // === 配置区域 (Config) ===
  config: {
    // 角色基础配比
    ratios: {
      harvesterPerSource: 2, // 每个 Source 2 个 Harvester (保证采集速率跟上运输效率)
      haulerBaseCount: 1, // 基础 Hauler 数量 (冗余)
    },
    // 角色上限 (防止无限繁殖)
    limits: {
      builder: 3,
      upgrader: 3,
      hauler: 6,
    },
  },

  /** @param {Room} room **/
  calculateTargets: function (room) {
    const targets = {
      harvester: 0,
      upgrader: 0,
      builder: 0,
      hauler: 0,
    };

    // 1. Harvester:
    // 基础数量 = Source 数量
    // 如果没有 Container/Link，且没有 Hauler，需要更多 Harvester 来弥补运输时间
    const sources = room.find(FIND_SOURCES);
    const sourceCount = sources.length;
    const haulers = room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "hauler",
    });

    if (haulers.length > 0) {
      // 有搬运工，Harvester 只需要负责挖
      // 用户要求: 每个资源点分配两个采集者
      targets.harvester = sourceCount * 2;
    } else {
      // 没搬运工，优先保证每个 Source 有一个 Harvester，然后立刻孵化 Hauler
      targets.harvester = sourceCount;
    }

    // 2. Hauler:
    // 采用智能分配算法 (getHaulerNeeds)
    // 根据每个 Source 的积压情况动态计算需求
    const haulerNeeds = this.getHaulerNeeds(room);
    targets.hauler = 0;
    for (const sourceId in haulerNeeds) {
      targets.hauler += haulerNeeds[sourceId];
    }

    // 限制 Hauler 上限
    targets.hauler = Math.min(targets.hauler, this.config.limits.hauler);

    // 至少 1 个 Hauler (如果已有 Harvester)
    if (targets.harvester > 0 && targets.hauler < 1) {
      targets.hauler = 1;
    }

    // 3. Smart Spender Balancing (Builder vs Upgrader)
    // 智能平衡建造者和升级者：基于“建设紧迫度”和“能量水平”
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    const criticalSites = sites.filter(
      (s) =>
        s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_TOWER ||
        s.structureType === STRUCTURE_STORAGE ||
        s.structureType === STRUCTURE_CONTAINER,
    );

    // 能量水平评估
    // 1. Spawn/Extension 充能率
    const energyRatio = room.energyAvailable / room.energyCapacityAvailable;

    // 2. Storage 储量 (如果还没有 Storage，暂时视为 0)
    const storageEnergy = room.storage
      ? room.storage.store[RESOURCE_ENERGY]
      : 0;

    // 3. Container 积压量 (如果有大量积压，说明消费端太慢)
    let containerBacklog = 0;
    const containers = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    containers.forEach((c) => (containerBacklog += c.store[RESOURCE_ENERGY]));

    // 默认配置
    targets.builder = 0;

    if (criticalSites.length > 0) {
      // === 关键基建模式 (Critical Infrastructure) ===
      // 优先保证基建速度 (Extensions/Towers/Storage)
      targets.builder = 2; // 至少 2 个 Builder
      targets.upgrader = 1; // 仅维持 Controller 不降级，节省能量给基建
    } else if (sites.length > 0) {
      // === 普通维护模式 (Maintenance/Roads) ===
      // 均衡发展
      targets.builder = 1; // 1 个 Builder 慢慢修路

      // Upgrader 根据能量决定
      if (storageEnergy > 50000 || containerBacklog > 5000) {
        targets.upgrader = 2; // 积压较多，允许 2 个
      } else {
        targets.upgrader = 1;
      }
    } else {
      // === 极速发展模式 (Development) ===
      // 全力冲刺 RCL
      targets.builder = 0;

      // 动态计算 Upgrader 数量
      // 基础: 1
      targets.upgrader = 1;

      // 如果能量极其富裕，大幅增加
      if (storageEnergy > 100000) {
        targets.upgrader = 3; // 甚至可以更多，但先限制在 3
      } else if (storageEnergy > 20000 || containerBacklog > 4000) {
        targets.upgrader = 2;
      }

      // 如果 Spawn 能量也是满的，且 Hauler 闲置率高（难以直接获取闲置率，用 Container 满载来推断）
      // 如果 Container 几乎都满了 (>1800)，说明运不出去也用不掉
      const fullContainers = containers.filter(
        (c) => c.store[RESOURCE_ENERGY] > 1800,
      );
      if (fullContainers.length >= 2 && energyRatio > 0.9) {
        targets.upgrader = Math.max(targets.upgrader, 3);
        console.log(
          "⚡ Energy Surplus Detected: Boosting Upgrader count to consume excess energy.",
        );
      }
    }

    // 4. 紧急覆盖 (Emergency Overrides)
    // 如果控制器即将降级 (< 4000 ticks)，强制进入救援模式
    if (room.controller && room.controller.ticksToDowngrade < 4000) {
      console.log("🚨 紧急警报：控制器即将降级！进入救援模式！");
      targets.upgrader = this.config.limits.upgrader;
      targets.builder = 0; // 暂停基建
    }

    // 限制上限
    targets.builder = Math.min(targets.builder, this.config.limits.builder);
    targets.upgrader = Math.min(targets.upgrader, this.config.limits.upgrader);

    // 5. 搬运工保留 (Hauler Reservation)
    // 如果有 Upgrader 工作，必须额外保留至少 1 个 Hauler 作为专用/机动运力
    // 防止所有 Hauler 都绑定在 Source 上，导致 Controller 端断供
    if (targets.upgrader > 0) {
      targets.hauler += 1;
    }
    // 再次检查 Hauler 上限
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
    const sources = room.find(FIND_SOURCES);

    // 检查是否有全局等待情况 (Upgrader/Builder Starvation)
    // 如果 Upgrader 等待时间过长，说明运力不足，给每个 Source 都增加配额
    let globalBoost = 0;
    const upgraders = room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "upgrader",
    });
    const avgIdle =
      upgraders.reduce((sum, c) => sum + (c.memory.idleTicks || 0), 0) /
      (upgraders.length || 1);
    if (avgIdle > 20) {
      console.log(`🚨 运力告急：Upgrader 平均等待 ${avgIdle.toFixed(1)} ticks`);
      globalBoost = 1;
    }

    // 手动干预配置
    const overrides =
      Memory.config && Memory.config.haulerOverrides
        ? Memory.config.haulerOverrides
        : {};

    sources.forEach((source) => {
      if (overrides[source.id] !== undefined) {
        needs[source.id] = overrides[source.id];
        return;
      }

      let count = this.config.ratios.haulerBaseCount; // 基础值 (1)

      // 1. 检查 Container 积压
      const container = source.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      })[0];

      if (container) {
        const energy = container.store[RESOURCE_ENERGY];
        if (energy > 1800) {
          count += 2; // 严重积压
        } else if (energy > 1000) {
          count += 1; // 轻度积压
        }
      }

      // 2. 检查掉落能量
      const dropped = source.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY,
      });
      const droppedAmount = dropped.reduce((sum, r) => sum + r.amount, 0);
      if (droppedAmount > 500) {
        count += 1;
      }

      // 3. 应用全局加速
      count += globalBoost;

      // 4. 限制单矿最大搬运工
      count = Math.min(count, 3);

      needs[source.id] = count;
    });

    return needs;
  },

  /**
   * 动态平衡搬运工分配
   * 将多余的搬运工从富裕的 Source 调拨到紧缺的 Source
   * @param {Room} room
   */
  rebalanceHaulers: function (room) {
    const needs = this.getHaulerNeeds(room);
    const haulers = room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "hauler" && c.ticksToLive > 100,
    });

    // 1. 统计现状
    const currentCounts = {};
    const surplus = []; // [creep, sourceId]
    const deficit = []; // [sourceId, amount]

    // 初始化计数
    Object.keys(needs).forEach((id) => (currentCounts[id] = 0));

    haulers.forEach((c) => {
      if (c.memory.sourceId) {
        currentCounts[c.memory.sourceId] =
          (currentCounts[c.memory.sourceId] || 0) + 1;
      }
    });

    // 2. 识别过剩和短缺
    for (const sourceId in needs) {
      const diff = (currentCounts[sourceId] || 0) - needs[sourceId];
      if (diff > 0) {
        // 找出该 Source 下所有的 Hauler
        const sourceHaulers = haulers.filter(
          (c) => c.memory.sourceId === sourceId,
        );
        // 标记多余的 Hauler (取 diff 个)
        for (let i = 0; i < diff; i++) {
          if (sourceHaulers[i]) {
            surplus.push(sourceHaulers[i]);
          }
        }
      } else if (diff < 0) {
        deficit.push({ id: sourceId, amount: -diff });
      }
    }

    // 3. 执行调拨
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

          // 执行重新分配
          creep.memory.sourceId = item.id;
          delete creep.memory.targetId; // 清除旧目标的锁定
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
