import { EnergyManager, CrisisLevel } from "../../components/EnergyManager";

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
        return;
      }

      // 2. 治疗受伤的己方 Creep (战斗支援)
      const closestDamagedCreep = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
        filter: (creep) => creep.hits < creep.hitsMax,
      });
      if (closestDamagedCreep) {
        tower.heal(closestDamagedCreep);
        return;
      }

      // 3. 紧急维修 (Rampart/Wall 即将破碎) - 无论能量多少都要修
      const criticalWall = tower.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (s) =>
          (s.structureType === STRUCTURE_RAMPART ||
            s.structureType === STRUCTURE_WALL) &&
          s.hits < 1000,
      });
      if (criticalWall) {
        tower.repair(criticalWall);
        return;
      }

      // 4. 常规维修 (只有能量充足时才修，保留 50% 能量防守)
      // 在危机模式下，彻底禁止维修，节省每一滴能量用于孵化和防御
      const level = EnergyManager.getLevel(room);
      const isCrisis = level >= CrisisLevel.HIGH; // HIGH or CRITICAL

      if (
        !isCrisis &&
        tower.store.getUsedCapacity(RESOURCE_ENERGY) >
          tower.store.getCapacity(RESOURCE_ENERGY) * 0.5
      ) {
        // 4.1 优先修路和容器
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

        // 4.2 其次修墙 (Rampart/Wall) - 逐步加固到安全线 (比如 50k)
        // 只有能量很充裕 (>70%) 才干这个
        if (
          tower.store.getUsedCapacity(RESOURCE_ENERGY) >
          tower.store.getCapacity(RESOURCE_ENERGY) * 0.7
        ) {
          const wallTarget = 50000; // 目标血量
          const wallToRepair = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: (s) =>
              (s.structureType === STRUCTURE_RAMPART ||
                s.structureType === STRUCTURE_WALL) &&
              s.hits < wallTarget,
          });

          if (wallToRepair) {
            tower.repair(wallToRepair);
            return;
          }
        }
      }
    });
  },
};

export default towerModule;
