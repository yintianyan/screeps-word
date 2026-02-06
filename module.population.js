const populationModule = {
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
      // 用户要求每个 Source 2 人
      targets.harvester = sourceCount * 2;
    } else {
      // 没搬运工，优先保证每个 Source 有一个 Harvester，然后立刻孵化 Hauler
      targets.harvester = sourceCount;
    }

    // 2. Hauler:
    // 根据 Harvester 数量和掉落的能量来定
    // 采用 1:1 配比，确保每个矿点都有专人运输，避免单 Hauler 忙不过来
    const droppedEnergy = room.find(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY,
    });
    const totalDropped = droppedEnergy.reduce(
      (sum, res) => sum + res.amount,
      0,
    );

    // 基础 Hauler：现在 Harvester 翻倍了，但产出没变，所以 Hauler 不需要翻倍
    // 保持每个 Source 至少有 1 个 Hauler，如果路途遥远或者产出快，可以适当增加
    // 这里设定为 Source 数量 + 1 (冗余)
    targets.hauler = sourceCount + 1;

    // 如果掉落能量很多 (>1000)，额外增加 Hauler 抢救
    if (totalDropped > 1000) {
      targets.hauler += 1;
    }

    // 至少 1 个 Hauler (如果已有 Harvester)
    if (targets.harvester > 0 && targets.hauler < 1) {
      targets.hauler = 1;
    }

    // 3. Builder:
    // 取决于是否有工地
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    const containerSites = sites.filter(
      (s) => s.structureType === STRUCTURE_CONTAINER,
    );

    if (sites.length > 0) {
      if (containerSites.length > 0) {
        // 紧急基建模式：有 Container 要造，提高 Builder 数量
        targets.builder = 3;
      } else {
        // 普通建造模式
        targets.builder = Math.min(3, 1 + Math.floor(sites.length / 5));
      }
    } else {
      targets.builder = 0;
    }

    // 4. Upgrader:
    // 如果有 Container 正在建造，减少 Upgrader 以节省能量和 Spawn 队列
    if (containerSites.length > 0) {
      targets.upgrader = 1;
    } else {
      // 正常模式：根据能量富裕程度调整
      const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
      if (energyRatio > 0.8) {
        targets.upgrader = 3;
      } else if (energyRatio > 0.3) {
        targets.upgrader = 2;
      } else {
        targets.upgrader = 1; // 至少保持 1 个升级防止掉级
      }
    }

    return targets;
  },
};

module.exports = populationModule;
