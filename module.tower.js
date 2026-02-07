const towerModule = {
  run: function (room) {
    // 查找房间内的所有塔
    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    });

    towers.forEach((tower) => {
      // 1. 攻击敌人 (最高优先级)
      const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
      if (closestHostile) {
        tower.attack(closestHostile);
        return; // 攻击时不做其他事
      }

      // 2. 维修 (只有能量充足时才修，保留 50% 能量防守)
      // 在危机模式下，彻底禁止维修，节省每一滴能量用于孵化和防御
      const isCrisis = room.memory.energyState === "CRISIS";
      if (
        !isCrisis &&
        tower.store.getUsedCapacity(RESOURCE_ENERGY) >
          tower.store.getCapacity(RESOURCE_ENERGY) * 0.5
      ) {
        // 优先修路和容器 (损耗 > 20% 才修，避免频繁切换)
        const closestDamagedStructure = tower.pos.findClosestByRange(
          FIND_STRUCTURES,
          {
            filter: (structure) => {
              return (
                (structure.structureType === STRUCTURE_ROAD ||
                  structure.structureType === STRUCTURE_CONTAINER) &&
                structure.hits < structure.hitsMax * 0.8
              );
            },
          },
        );

        if (closestDamagedStructure) {
          tower.repair(closestDamagedStructure);
          return;
        }

        // 其次修墙 (Rampart/Wall) - 只修到 10k 血，避免耗光能量
        // const closestDamagedWall = ...
      }

      // 3. 治疗受伤的己方 Creep
      const closestDamagedCreep = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
        filter: (creep) => creep.hits < creep.hitsMax,
      });
      if (closestDamagedCreep) {
        tower.heal(closestDamagedCreep);
      }
    });
  },
};

module.exports = towerModule;
