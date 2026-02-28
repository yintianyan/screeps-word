import { EnergyManager, CrisisLevel } from "../../components/EnergyManager";
import { TaskPriority, TaskType } from "../../types/dispatch";
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
      sk_guard: 10,
      sk_miner: 10,
      sk_hauler: 20,
    },
  },

  // === Cache ===
  _cache: {} as Record<
    string,
    { tick: number; targets: Record<string, number> }
  >,

  _distanceCache: {} as Record<string, number>, // Key: "sourceId_dropPosId"

  /**
   * Implement IModule interface
   * Pre-calculates targets for the room
   */
  run: function (room: Room) {
    this.calculateTargets(room);
  },

  /**
   * Calculate Target Counts
   * Cached per tick per room to save CPU
   */
  calculateTargets: function (room: Room): Record<string, number> {
    if (!this._cache[room.name] || this._cache[room.name].tick !== Game.time) {
      this._cache[room.name] = {
        tick: Game.time,
        targets: this._calculateTargetsInternal(room),
      };
    }
    return this._cache[room.name].targets;
  },

  _calculateTargetsInternal: function (room: Room): Record<string, number> {
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
      sk_guard: 0,
      sk_miner: 0,
      sk_hauler: 0,
    };

    const sources = StructureCache.getSources(room);
    const level = EnergyManager.getLevel(room);

    // === Remote Mining Population ===
    if (room.memory.remotes && room.memory.remotes.length > 0) {
      // Only spawn remote creeps if base is stable
      if (level !== CrisisLevel.CRITICAL) {
        room.memory.remotes.forEach((remoteName) => {
          // Check Tasks for this remote
          // Count Harvesters needed
          const mineTasks = this.countTasks(
            TaskType.REMOTE_HARVEST,
            remoteName,
          );
          targets.remote_harvester =
            (targets.remote_harvester || 0) + mineTasks;

          // Count Haulers needed
          const haulTasks = this.sumTaskMaxCreeps(
            TaskType.REMOTE_HAUL,
            remoteName,
          );
          targets.remote_hauler = (targets.remote_hauler || 0) + haulTasks;

          // Count Reservers
          targets.remote_reserver =
            (targets.remote_reserver || 0) +
            this.countTasks(TaskType.REMOTE_RESERVE, remoteName);

          // Count Defenders
          targets.remote_defender =
            (targets.remote_defender || 0) +
            this.countTasks(TaskType.REMOTE_DEFEND, remoteName);

          // Count Scouts
          targets.scout =
            (targets.scout || 0) + this.countTasks(TaskType.SCOUT, remoteName);

          // Count SK Guards
          targets.sk_guard =
            (targets.sk_guard || 0) +
            this.countTasks(TaskType.SK_GUARD, remoteName);

          // Count SK Miners
          targets.sk_miner =
            (targets.sk_miner || 0) +
            this.countTasks(TaskType.SK_MINE, remoteName);

          // Count SK Haulers
          targets.sk_hauler =
            (targets.sk_hauler || 0) +
            this.sumTaskMaxCreeps(TaskType.SK_HAUL, remoteName);
        });
      }
    }

    // === 1. Harvester ===
    let harvesterTarget = 0;
    sources.forEach((source) => {
      // Logic: 1 Harvester (min 5 WORK) per Source
      // Check existing harvesters
      const harvesters = StructureCache.getCreeps(room, "harvester").filter(
        (c) => c.memory.sourceId === source.id,
      );

      const totalWork = harvesters.reduce(
        (sum, c) => sum + c.getActiveBodyparts(WORK),
        0,
      );

      let desired = 1;
      if (totalWork < 5) {
        // If in crisis, allow multiple small harvesters
        if (level === CrisisLevel.CRITICAL) {
          // Check available spots
          const terrain = room.getTerrain();
          let spots = 0;
          for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
              if (
                terrain.get(source.pos.x + x, source.pos.y + y) !==
                TERRAIN_MASK_WALL
              )
                spots++;
            }
          }
          desired = Math.min(spots, 3); // Max 3 small harvesters
        }
      }
      harvesterTarget += desired;
    });
    // [FIX] Ensure minimum 1 harvester per source if sources > 2
    // The loop above adds 'desired' (which is at least 1) for EACH source.
    // So if sources.length = 3, harvesterTarget = 3.
    // BUT the 'limits' config caps harvester at 2.
    // We need to override the limit if source count > limit.
    targets.harvester = harvesterTarget;
    this.config.limits.harvester = Math.max(this.config.limits.harvester, sources.length);

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
    if (room.controller && room.controller.ticksToDowngrade < 2000)
      targets.upgrader = 1; // Prevent downgrade

    // === 4. Builder ===
    const builderBudget = EnergyManager.getBudget(room, "builder");
    const builderCost = 5;
    targets.builder = Math.ceil(builderBudget / builderCost);

    // Construction Site Boost
    const sites = StructureCache.getConstructionSites(room);
    if (sites.length > 0) {
      // If critical sites (Spawn/Extension), force minimum
      const criticalSites = sites.filter(
        (s) =>
          s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_EXTENSION,
      );
      if (criticalSites.length > 0)
        targets.builder = Math.max(targets.builder, 2);
      else targets.builder = Math.max(targets.builder, 1);
    } else {
      // Maintenance mode
      targets.builder = Math.min(targets.builder, 1);
    }

    if (level === CrisisLevel.CRITICAL) targets.builder = 0; // Stop building in crisis

    // === 5. Task Queue Expansion ===
    if (
      level !== CrisisLevel.CRITICAL &&
      Memory.dispatch &&
      Memory.dispatch.tasks
    ) {
      // Count pending tasks by role
      const pendingCounts: Record<string, number> = {};
      for (const id in Memory.dispatch.tasks) {
        const task = Memory.dispatch.tasks[id];

        if (
          task.status === "pending" &&
          task.priority <= TaskPriority.HIGH &&
          task.validRoles
        ) {
          task.validRoles.forEach((role) => {
            pendingCounts[role] = (pendingCounts[role] || 0) + 1;
          });
        }
      }

      // Add minimal boost
      for (const role in pendingCounts) {
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

  countTasks: function (type: string, targetRoom?: string): number {
    if (!Memory.dispatch || !Memory.dispatch.tasks) return 0;
    let count = 0;
    for (const id in Memory.dispatch.tasks) {
      const task = Memory.dispatch.tasks[id];
      if (task.type === type && task.status !== "completed") {
        if (targetRoom) {
          // Check if task targets this room
          if (task.data && task.data.targetRoom === targetRoom) count++;
          else if (task.targetId === targetRoom) count++; // Scout task uses targetId as room name
        } else {
          count++;
        }
      }
    }
    return count;
  },

  sumTaskMaxCreeps: function (type: string, targetRoom?: string): number {
    if (!Memory.dispatch || !Memory.dispatch.tasks) return 0;
    let count = 0;
    for (const id in Memory.dispatch.tasks) {
      const task = Memory.dispatch.tasks[id];
      if (task.type === type && task.status !== "completed") {
        if (targetRoom && task.data && task.data.targetRoom === targetRoom) {
          count += task.maxCreeps || 1;
        }
      }
    }
    return count;
  },

  calculateHaulerNeeds: function (
    room: Room,
    sources: Source[],
    level: CrisisLevel,
  ): number {
    // 1. Check if room has functional Link network (e.g. >= 2 links)
    // If Link network exists, FORCE hauler target count to 1.
    // This effectively disables any boost logic for Haulers as well.
    const links = StructureCache.getMyStructures(room, STRUCTURE_LINK);
    if (links.length >= 2) {
      return 1;
    }

    let total = 0;

    // Calculate capacity of a standard hauler we can build
    const capacity = room.energyCapacityAvailable;
    // [FIX] Use capacity even in critical level if we have enough extension?
    // No, if critical, we might only have 300 available.
    // But we want to target the "ideal" count assuming we recover.
    // If we target ideal count based on 300-energy haulers, we will spawn TONS of small haulers.
    // Then when energy recovers, we have too many small ones.

    // Strategy: Target count should be based on BEST POSSIBLE hauler (RCL capacity).
    // If we are in crisis, we spawn smaller ones, but we might need MORE of them to match throughput?
    // OR we just accept lower throughput during crisis.
    // Spawning 20 small haulers is bad for CPU and traffic.
    // Better to spawn fewer, let them work, and upgrade them later.

    // So: Calculate target based on `energyCapacityAvailable`.
    // If we are currently spawning small ones, `Role` logic or `BodyFactory` handles the downsizing.
    // But `PopulationManager` decides COUNT.

    // If we use `energyCapacityAvailable`, a single hauler might carry 1000.
    // If we use `energyAvailable` (e.g. 300), it carries 200.
    // If we need 10/tick, we need 1 big hauler or 5 small haulers.
    // If we set target = 1 (based on big), but spawn 1 small, we fail to move energy.
    // If we set target = 5 (based on small), we spawn 5 small.
    // When energy recovers, we have 5 small haulers. We need to recycle them.

    // Compromise:
    // If Critical, use `energyAvailable` to ensure survival (move energy NOW).
    // If Normal/High, use `energyCapacityAvailable` to optimize count.

    // [OPTIMIZATION] The user wants to reduce count as capacity increases.
    // So we MUST use `energyCapacityAvailable` for the calculation in normal state.

    const budget =
      level === CrisisLevel.CRITICAL
        ? Math.max(300, room.energyAvailable)
        : capacity;
    // 100 energy = 1 CARRY + 1 MOVE (ideal) or 2 CARRY + 1 MOVE (road)
    // BodyFactory uses:
    // Hauler: [CARRY, CARRY, MOVE] = 150 energy -> 100 capacity.
    // So 1.5 energy -> 1 capacity.
    // Budget 1000 -> 666 capacity?
    // Let's check BodyFactory.generateHauler.
    // Usually it's 1:1 or 2:1.
    // Let's assume conservatively 1:1 cost for CARRY:MOVE (100 energy = 50 capacity).
    // Or 2:1 on roads (150 energy = 100 capacity).
    // Let's use 100 energy = 50 capacity as safe baseline.

    const singleHaulerCapacity = Math.floor(budget / 100) * 50;

    if (singleHaulerCapacity === 0) return 0;

    // Drop point
    const storage = room.storage;
    const spawn = StructureCache.getMyStructures(room, STRUCTURE_SPAWN)[0];
    const dropTarget = storage || spawn;
    const dropPos = dropTarget ? dropTarget.pos : null;

    if (!dropPos) return 0;

    // [New] Link Optimization
    // If we have Source Links, haulers are redundant for that source.
    // Check if source has link
    const sourceLinks = room.find(FIND_MY_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_LINK &&
        sources.some((src) => src.pos.inRangeTo(s, 2)),
    });

    sources.forEach((source) => {
      // If Source has Link nearby, SKIP hauler requirement for this source
      if (sourceLinks.some((link) => link.pos.inRangeTo(source, 2))) {
        // But wait, who moves energy from Link to Storage?
        // Usually Link transfers to Storage Link automatically?
        // Or a central creep?
        // If Link system is active, we assume energy teleports to Storage.
        // So 0 haulers needed for this source path.
        return;
      }

      // [OPTIMIZATION] Cache distance
      const cacheKey = `${source.id}_${dropTarget.id}`;
      let dist = this._distanceCache[cacheKey];

      if (dist === undefined) {
        dist = source.pos.getRangeTo(dropPos);
        this._distanceCache[cacheKey] = dist;
      }

      // Throughput: 10 energy/tick (Source generates 3000 in 300 ticks = 10/tick)
      // Trip time: dist * 2 (round trip) + 10 (load/unload buffer)
      // If roads, dist * 1. If plain, dist * 2.
      // Assume roads if RCL >= 3? Or check structure?
      // Let's assume plain speed (fatigue) worst case or average 1.5?
      // With CARRY+MOVE 1:1, speed is 1 on plain.
      // So Trip Time = dist * 2.

      const tripTime = dist * 2.2 + 10;
      const tripsPerTick = 1 / tripTime;
      const capacityPerTick = singleHaulerCapacity * tripsPerTick;

      const required = 10 / capacityPerTick;
      total += required;
    });

    // Base needs for non-source tasks (e.g. Storage -> Spawn, Dropped Energy)
    // Always keep at least 1-2 Haulers if we have Storage to move things around?
    // Or Upgrade Link?
    // If all sources have links, `total` will be 0.
    // But we need haulers to fill Spawn/Extensions from Storage!
    if (
      total === 0 &&
      room.storage &&
      room.storage.store[RESOURCE_ENERGY] > 0
    ) {
      // Need to fill Spawn
      total = 1; // [USER OVERRIDE] Keep only 1 hauler for base logistics (Storage -> Spawn/Upgrader)
    }

    // Round up
    let count = Math.ceil(total);

    // Boost for stockpile clearing
    // [OPTIMIZATION] Throttle this check?
    if (Game.time % 5 === 0) {
      const containers = StructureCache.getStructures(
        room,
        STRUCTURE_CONTAINER,
      ) as StructureContainer[];
      const totalStockpile = containers.reduce(
        (sum, c) => sum + (c.store ? c.store[RESOURCE_ENERGY] : 0),
        0,
      );
      // If we have a lot of energy piled up, we might need an extra hand temporarily.
      // But if our haulers are huge (1000 capacity), 1 extra is a lot.
      // Maybe only if > 2 * capacity?
      // [FIX] Disabled aggressive boost. If we have links, stockpile in container is irrelevant.
      // Harvesters put energy in Link.
      // Only Containers near Controller/Spawn might fill up?
      // If totalStockpile > singleHaulerCapacity * 5 ?
      // Let's remove this boost if Links exist.
      const hasLinks =
        room.find(FIND_MY_STRUCTURES, {
          filter: (s) => s.structureType === STRUCTURE_LINK,
        }).length > 0;
      if (!hasLinks && totalStockpile > singleHaulerCapacity * 2) count += 1;
    }

    // Boost for dropped
    if (Game.time % 10 === 0) {
      const dropped = room.find(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 100,
      });
      const droppedAmount = dropped.reduce((sum, r) => sum + r.amount, 0);
      // [FIX] Only boost if significant amount (> 1000)
      if (droppedAmount > Math.max(1000, singleHaulerCapacity)) count += 1;
    }

    // [New] Cap based on RCL to force reduction?
    // If RCL >= 4, we likely have storage and links.
    // If Links exist, Hauler need drops drastically!
    // We need to check for Links.
    if (level >= CrisisLevel.HIGH) {
      // Not quite right check, need check structure
      // Check for Source Links
      const sourceLinks = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_LINK,
      });
      if (sourceLinks.length >= 2) {
        // We have links! Haulers only need to move from Hub to Controller/Spawn?
        // Or Source -> Link is handled by Harvester?
        // If Source has a Link, Hauler traffic for that source is 0.
        // We should subtract that source from calculation.
        // Re-calc based on sources WITHOUT links?
        // This function is simple "total += required".
        // Let's refine it.
      }
    }

    // For now, let's just rely on the Capacity calculation.
    // As Capacity goes up (300 -> 1000), `capacityPerTick` goes up, `required` goes down.
    // E.g. Dist=20, Trip=54.
    // Cap=300 (Small): CapPerTick = 300/54 = 5.5. Req = 10/5.5 = 1.8 -> 2 Haulers.
    // Cap=1000 (Big): CapPerTick = 1000/54 = 18.5. Req = 10/18.5 = 0.54 -> 1 Hauler.
    // So the math already supports reduction!

    // Crisis Override
    if (level === CrisisLevel.CRITICAL) return Math.max(1, Math.min(count, 3));

    return count;
  },
};

export default PopulationManager;
