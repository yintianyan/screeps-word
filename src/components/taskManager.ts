import Cache from "./memoryManager";
import priorityModule from "../config/priority";

const TaskManager = {
  // === 任务难度阈值 (Thresholds) ===
  config: {
    // 建造难度 (progressTotal)
    construction: {
      LOW: 1000, // < 1000: 小工程 (Extensions)
      MEDIUM: 10000, // < 10000: 中等工程 (Containers)
      HIGH: 50000, // > 50000: 大工程 (Spawn, Storage)
    },
    // 维修难度 (hits to repair)
    repair: {
      LOW: 5000,
      MEDIUM: 20000,
      HIGH: 100000,
    },
    // 运输负载 (accumulated energy)
    transport: {
      LOW: 1000,
      MEDIUM: 3000,
      HIGH: 8000,
    },
  },

  /**
   * 分析房间内的任务负载
   * @param {Room} room
   */
  analyze: function (room: Room) {
    const constructionLoad = this.getConstructionLoad(room);
    const repairLoad = this.getRepairLoad(room);
    const transportLoad = this.getTransportLoad(room);

    // 存储到 Heap 缓存或 Memory 中，供 Population 使用
    // 使用 Cache.getHeap 来存储分析结果，每 10 tick 更新一次
    // 但这里是 analyze 函数，应该是被调用的。
    // 我们返回结果。
    return {
      construction: constructionLoad,
      repair: repairLoad,
      transport: transportLoad,
    };
  },

  /**
   * 计算建造负载
   */
  getConstructionLoad: function (room: Room) {
    const sites = Cache.getTick(`sites_${room.name}`, () =>
      room.find(FIND_MY_CONSTRUCTION_SITES),
    );

    let totalProgressNeeded = 0;
    let maxPriority = -1;
    let maxStructureType = null;
    let maxCost = 0;

    sites.forEach((s) => {
      const needed = s.progressTotal - s.progress;
      totalProgressNeeded += needed;
      
      const p = priorityModule.getPriority(s.structureType);
      if (p > maxPriority) {
          maxPriority = p;
          maxStructureType = s.structureType;
          maxCost = needed;
      } else if (p === maxPriority) {
          if (needed > maxCost) {
             maxCost = needed;
          }
      }
    });

    let difficulty = "NONE";
    if (totalProgressNeeded > 0) {
      if (totalProgressNeeded < this.config.construction.LOW)
        difficulty = "LOW";
      else if (totalProgressNeeded < this.config.construction.MEDIUM)
        difficulty = "MEDIUM";
      else difficulty = "HIGH";
    }

    return {
      total: totalProgressNeeded,
      difficulty: difficulty,
      primaryTarget: maxStructureType,
      count: sites.length,
    };
  },

  /**
   * 计算维修负载 (仅计算非墙类关键设施)
   */
  getRepairLoad: function (room: Room) {
    // 仅扫描路、Container、Rampart (低血量)
    const targets = room.find(FIND_STRUCTURES, {
      filter: (s) => {
        if (s.structureType === STRUCTURE_WALL) return false;
        if (
          s.structureType === STRUCTURE_RAMPART &&
          s.hits > 10000
        )
          return false;
        return s.hits < s.hitsMax * 0.8;
      },
    });

    let totalRepairNeeded = 0;
    targets.forEach((s) => {
      totalRepairNeeded += s.hitsMax - s.hits;
    });

    let difficulty = "NONE";
    if (totalRepairNeeded > 0) {
      if (totalRepairNeeded < this.config.repair.LOW) difficulty = "LOW";
      else if (totalRepairNeeded < this.config.repair.MEDIUM)
        difficulty = "MEDIUM";
      else difficulty = "HIGH";
    }

    return {
      total: totalRepairNeeded,
      difficulty: difficulty,
      count: targets.length,
    };
  },

  /**
   * 计算运输负载 (积压能量)
   */
  getTransportLoad: function (room: Room) {
    // 统计 Container 和 Dropped Resources 的总能量
    const containers = Cache.getStructures(room, STRUCTURE_CONTAINER);
    let piledEnergy = 0;

    containers.forEach((c) => {
      piledEnergy += c.store[RESOURCE_ENERGY];
    });

    const dropped = Cache.getTick(`dropped_${room.name}`, () =>
      room.find(FIND_DROPPED_RESOURCES),
    );
    dropped.forEach((r) => {
      if (r.resourceType === RESOURCE_ENERGY) {
        piledEnergy += r.amount;
      }
    });

    // 减去 Storage 的能量 (那是终点，不是负载)
    // 但如果 Storage 满了，可能也算某种负载？暂不考虑。

    let difficulty = "NONE";
    if (piledEnergy > this.config.transport.HIGH) difficulty = "HIGH";
    else if (piledEnergy > this.config.transport.MEDIUM) difficulty = "MEDIUM";
    else if (piledEnergy > this.config.transport.LOW) difficulty = "LOW";

    return {
      total: piledEnergy,
      difficulty: difficulty,
    };
  },
};

export default TaskManager;
