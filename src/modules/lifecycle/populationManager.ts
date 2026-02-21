import { EnergyManager, CrisisLevel } from "../../components/EnergyManager";
import { TaskPriority } from "../../types/dispatch";
import StructureCache from "../../utils/structureCache";

const PopulationManager = {
  // === Config ===
  config: {
    // Basic ratios
    ratios: {
      harvesterPerSource: 1, // Fixed mining
      haulerBaseCount: 1, // Base haulers
    },
    // Caps
    limits: {
      harvester: 2, // Per Source logic handles this
      builder: 2,
      upgrader: 2,
      hauler: 5,
      scout: 1,
      remote_harvester: 4,
      remote_hauler: 4,
      remote_reserver: 1,
      remote_defender: 2,
    },
  },

  /**
   * Calculate Target Counts
   * Cached per tick per room to save CPU
   */
  calculateTargets: function (room: Room): Record<string, number> {
    if (!room._populationTargets || room._populationTargetsTick !== Game.time) {
        room._populationTargets = this._calculateTargetsInternal(room);
        room._populationTargetsTick = Game.time;
    }
    return room._populationTargets;
  },

  _calculateTargetsInternal: function(room: Room): Record<string, number> {
    const targets: Record<string, number> = {
      harvester: 0,
      upgrader: 0,
      builder: 0,
      hauler: 0,
      scout: 0,
      remote_harvester: 0,
      remote_hauler: 0,
      remote_reserver: 0,
      remote_defender: 0,
    };

    const sources = StructureCache.getSources(room);
    const level = EnergyManager.getLevel(room);

    // === 1. Harvester ===
    let harvesterTarget = 0;
    sources.forEach((source) => {
      // Logic: 1 Harvester (min 5 WORK) per Source
      // Check existing harvesters
      const harvesters = StructureCache.getCreeps(room, "harvester").filter(
        (c) => c.memory.sourceId === source.id
      );
      
      const totalWork = harvesters.reduce((sum, c) => sum + c.getActiveBodyparts(WORK), 0);
      
      // If we have enough WORK (>=5), we need 1 creep (or however many make up 5 WORK)
      // Actually, we target "Slots" usually. But let's simplify: 1 per source.
      // If current WORK < 5, we need more.
      
      let desired = 1;
      if (totalWork < 5) {
          // If in crisis, allow multiple small harvesters
          if (level === CrisisLevel.CRITICAL) {
              // Check available spots
              const terrain = room.getTerrain();
              let spots = 0;
              for(let x=-1; x<=1; x++) {
                  for(let y=-1; y<=1; y++) {
                      if (terrain.get(source.pos.x+x, source.pos.y+y) !== TERRAIN_MASK_WALL) spots++;
                  }
              }
              desired = Math.min(spots, 3); // Max 3 small harvesters
          }
      }
      harvesterTarget += desired;
    });
    targets.harvester = harvesterTarget;

    // === 2. Hauler ===
    // Use Throughput Calculation
    targets.hauler = this.calculateHaulerNeeds(room, sources, level);

    // === 3. Upgrader ===
    // Budget Based
    const upgraderBudget = EnergyManager.getBudget(room, "upgrader");
    const upgraderCost = 5; // Assume 5 WORK per creep
    targets.upgrader = Math.ceil(upgraderBudget / upgraderCost);
    
    // Crisis Override
    if (level === CrisisLevel.CRITICAL) targets.upgrader = 0;
    if (room.controller && room.controller.ticksToDowngrade < 2000) targets.upgrader = 1; // Prevent downgrade

    // === 4. Builder ===
    const builderBudget = EnergyManager.getBudget(room, "builder");
    const builderCost = 5;
    targets.builder = Math.ceil(builderBudget / builderCost);
    
    // Construction Site Boost
    const sites = StructureCache.getConstructionSites(room);
    if (sites.length > 0) {
        // If critical sites (Spawn/Extension), force minimum
        const criticalSites = sites.filter(s => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION);
        if (criticalSites.length > 0) targets.builder = Math.max(targets.builder, 2);
        else targets.builder = Math.max(targets.builder, 1);
    } else {
        // Maintenance mode
        targets.builder = Math.min(targets.builder, 1);
    }
    
    if (level === CrisisLevel.CRITICAL) targets.builder = 0; // Stop building in crisis

    // === 5. Task Queue Expansion ===
    if (level !== CrisisLevel.CRITICAL && Memory.dispatch && Memory.dispatch.tasks) {
        // Count pending tasks by role
        const pendingCounts: Record<string, number> = {};
        for(const id in Memory.dispatch.tasks) {
            const task = Memory.dispatch.tasks[id];
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            if (task.status === 'pending' && task.priority <= TaskPriority.HIGH && task.validRoles) {
                task.validRoles.forEach(role => {
                    pendingCounts[role] = (pendingCounts[role] || 0) + 1;
                });
            }
        }
        
        // Add minimal boost
        for(const role in pendingCounts) {
            // Cap the boost to prevent explosion
            const boost = Math.min(2, Math.floor(pendingCounts[role] / 5));
            if (boost > 0) targets[role] = (targets[role] || 0) + boost;
        }
    }

    // === 6. Caps ===
    for (const role in this.config.limits) {
        targets[role] = Math.min(targets[role] || 0, this.config.limits[role]);
    }
    
    return targets;
  },

  calculateHaulerNeeds: function(room: Room, sources: Source[], level: CrisisLevel): number {
      let total = 0;
      
      // Calculate capacity of a standard hauler we can build
      const capacity = room.energyCapacityAvailable;
      const budget = level === CrisisLevel.CRITICAL ? room.energyAvailable : capacity;
      // 100 energy = 50 capacity (CARRY+MOVE)
      const singleHaulerCapacity = Math.floor(budget / 100) * 50;
      
      if (singleHaulerCapacity === 0) return 0; // Can't build haulers?
      
      // Drop point
      const storage = room.storage;
      const spawn = StructureCache.getMyStructures(room, STRUCTURE_SPAWN)[0];
      const dropPos = storage ? storage.pos : (spawn ? spawn.pos : null);
      
      if (!dropPos) return 0;

      sources.forEach(source => {
          const dist = source.pos.getRangeTo(dropPos);
          // Throughput: 10 energy/tick
          // Trip time: dist * 2 + 10
          const tripTime = dist * 2.2 + 10;
          const tripsPerTick = 1 / tripTime;
          const capacityPerTick = singleHaulerCapacity * tripsPerTick;
          
          const required = 10 / capacityPerTick;
          total += required;
      });
      
      // Round up
      let count = Math.ceil(total);
      
      // Boost for stockpile clearing
      const containers = StructureCache.getStructures(room, STRUCTURE_CONTAINER) as StructureContainer[];
      const totalStockpile = containers.reduce((sum, c) => sum + c.store[RESOURCE_ENERGY], 0);
      if (totalStockpile > 2000) count += 1;
      
      // Boost for dropped
      const dropped = room.find(FIND_DROPPED_RESOURCES, {filter: r => r.resourceType === RESOURCE_ENERGY});
      const droppedAmount = dropped.reduce((sum, r) => sum + r.amount, 0);
      if (droppedAmount > 1000) count += 1;

      // Crisis Override
      if (level === CrisisLevel.CRITICAL) return Math.max(1, Math.min(count, 2));

      return count;
  }
};

export default PopulationManager;
