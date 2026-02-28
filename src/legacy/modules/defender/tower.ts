import { EnergyManager, CrisisLevel } from "../../components/EnergyManager";
import StructureCache from "../../utils/structureCache";

const towerModule = {
  run: function (room: Room) {
    // 查找房间内的所有塔
    const towers = StructureCache.getMyStructures(room, STRUCTURE_TOWER) as StructureTower[];

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
      // [Optimization] Use StructureCache
      const ramparts = StructureCache.getMyStructures(room, STRUCTURE_RAMPART) as StructureRampart[];
      const walls = StructureCache.getStructures(room, STRUCTURE_WALL) as StructureWall[];
      
      let criticalTarget: Structure | null = null;
      let minHits = Infinity;

      // Find lowest hits critical structure
      for (const s of [...ramparts, ...walls]) {
          if (s.hits < 1000) {
              if (s.hits < minHits) {
                  minHits = s.hits;
                  criticalTarget = s;
              }
          }
      }

      if (criticalTarget) {
        tower.repair(criticalTarget);
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
        const roads = StructureCache.getStructures(room, STRUCTURE_ROAD) as StructureRoad[];
        const containers = StructureCache.getStructures(room, STRUCTURE_CONTAINER) as StructureContainer[];
        
        let repairTarget: Structure | null = null;
        
        // Find closest damaged road/container
        // Check containers first (more valuable)
        for (const s of containers) {
            if (s.hits < s.hitsMax * 0.8) {
                repairTarget = s;
                break; // Repair first found? Or closest? Let's just repair one.
            }
        }
        
        if (!repairTarget) {
             for (const s of roads) {
                if (s.hits < s.hitsMax * 0.8) {
                    // Optimization: Only repair if in range to avoid scanning map?
                    // Or just pick first.
                    repairTarget = s;
                    break;
                }
            }
        }

        if (repairTarget) {
          tower.repair(repairTarget);
          return;
        }

        // 4.2 其次修墙 (Rampart/Wall) - 逐步加固到安全线 (比如 50k)
        // 只有能量很充裕 (>70%) 才干这个
        if (
          tower.store.getUsedCapacity(RESOURCE_ENERGY) >
          tower.store.getCapacity(RESOURCE_ENERGY) * 0.7
        ) {
          const wallTarget = 50000; // 目标血量
          
          // Find lowest hits wall/rampart under target
          let fortifyTarget: Structure | null = null;
          let lowestHits = Infinity;
          
          for (const s of [...ramparts, ...walls]) {
              if (s.hits < wallTarget && s.hits < lowestHits) {
                  lowestHits = s.hits;
                  fortifyTarget = s;
              }
          }

          if (fortifyTarget) {
            tower.repair(fortifyTarget);
            return;
          }
        }
      }
    });
  },
};

export default towerModule;
