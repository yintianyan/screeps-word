import Task from "./task";
import config from "../config/constants";
import StructureCache from "../utils/structureCache";

export default class Brain {
  room: Room;
  tasks: Task[];
  energyState: string = "NORMAL";

  // Cache: Room Name -> { brain instance, tick }
  private static cache: { [roomName: string]: { brain: Brain; tick: number } } =
    {};

  /**
   * Get the singleton Brain instance for this room and tick.
   * Analyzes and generates tasks only once per tick.
   */
  static getInstance(room: Room): Brain {
    if (!this.cache[room.name] || this.cache[room.name].tick !== Game.time) {
      const brain = new Brain(room);
      brain.run(); // Perform analysis and task generation
      this.cache[room.name] = { brain: brain, tick: Game.time };
    }
    return this.cache[room.name].brain;
  }

  constructor(room: Room) {
    this.room = room;
    // Task pool (cached per tick via heap or memory)
    this.tasks = [];
  }

  /**
   * Main Brain Loop
   */
  run() {
    // 1. Analyze Room State
    this.analyze();

    // 2. Generate Tasks
    this.generateTasks();
  }

  analyze() {
    this.energyState = this.room.energyAvailable < 300 ? "EMERGENCY" : "NORMAL";
    // More analysis...
  }

  generateTasks() {
    this.tasks = []; // Reset tasks for this tick

    // === HIGH FREQUENCY (Every Tick) ===
    // Critical Logistics: Spawn, Extension, Tower, Link

    // 1. Spawn/Extension filling (High Priority)
    // Use StructureCache to avoid room.find
    const spawns = StructureCache.getMyStructures(
      this.room,
      STRUCTURE_SPAWN,
    ) as StructureSpawn[];
    const extensions = StructureCache.getMyStructures(
      this.room,
      STRUCTURE_EXTENSION,
    ) as StructureExtension[];
    const energyStructures = [...spawns, ...extensions];

    energyStructures.forEach((s) => {
      if (s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        // Emergency: Priority 1000
        // Normal: LOGISTICS.SCORES.SPAWN (200)
        const isEmergency = this.energyState === "EMERGENCY";
        const priority = isEmergency ? 1000 : config.LOGISTICS.SCORES.SPAWN;
        this.tasks.push(
          new Task("transfer_spawn", s.id, priority, {}, ["hauler"]),
        );
      }
    });

    // 1.5 Source Links
    const links = StructureCache.getMyStructures(
      this.room,
      STRUCTURE_LINK,
    ) as StructureLink[];
    const sources = StructureCache.getSources(this.room);

    links.forEach((link) => {
      if (
        link.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
        sources.some((src) => link.pos.inRangeTo(src, 2))
      ) {
        this.tasks.push(
          new Task("transfer_link", link.id, config.LOGISTICS.SCORES.LINK, {}, [
            "hauler",
          ]),
        );
      }
    });

    // 3. Towers (Critical for Defense)
    const towers = StructureCache.getStructures(
      this.room,
      STRUCTURE_TOWER,
    ) as StructureTower[];
    towers.forEach((t) => {
      if (
        t.store.getFreeCapacity(RESOURCE_ENERGY) >
        config.LOGISTICS.THRESHOLDS.TOWER_REFILL
      ) {
        this.tasks.push(
          new Task("transfer_tower", t.id, config.LOGISTICS.SCORES.TOWER, {}, [
            "hauler",
          ]),
        );
      }
    });

    // === LOW FREQUENCY (Every 5 Ticks) ===
    // Logistics Support: Builders, Upgraders, Containers
    // Construction & Upgrading
    
    // We use Game.time % 5 to distribute load, BUT tasks are cleared every tick.
    // So we must generate them every tick OR persist them.
    // Since Brain.tasks is reset every tick, we MUST generate them every tick 
    // unless we change Brain to persist tasks across ticks.
    // 
    // Optimization: Only scan for these targets every 5 ticks, and cache the list of "Needy Targets"?
    // Or just keep it simple. The heaviest part is finding/filtering.
    // StructureCache makes finding fast. Filtering is fast JS.
    // So "Throttling" might not be necessary if Cache is good.
    // 
    // However, we can skip complex logic.
    
    // 2. Priority Builders
    const builders = StructureCache.getCreeps(this.room, "builder");
    builders.forEach((b) => {
      if (b.memory.priorityRequest) {
        this.tasks.push(
          new Task(
            "transfer_creep",
            b.id,
            config.LOGISTICS.SCORES.BUILDER_PRIORITY,
            {},
            ["hauler"],
          ),
        );
      }
    });

    // 4. Upgraders (Active)
    if (this.energyState !== "EMERGENCY") {
      const upgraders = StructureCache.getCreeps(this.room, "upgrader");
      upgraders.forEach((u) => {
        if (
          (u.memory.working || u.memory.requestingEnergy) &&
          u.store.getFreeCapacity(RESOURCE_ENERGY) >
            u.store.getCapacity() * config.LOGISTICS.THRESHOLDS.UPGRADER_REFILL
        ) {
          this.tasks.push(
            new Task(
              "transfer_creep",
              u.id,
              config.LOGISTICS.SCORES.UPGRADER,
              {},
              ["hauler"],
            ),
          );
        }
      });
    }

    // 5. Builders (Standard)
    if (this.energyState !== "EMERGENCY") {
      builders.forEach((b) => {
        if (
          (b.memory.working || b.memory.requestingEnergy) &&
          b.store[RESOURCE_ENERGY] <
            b.store.getCapacity() * config.LOGISTICS.THRESHOLDS.BUILDER_REFILL
        ) {
          this.tasks.push(
            new Task(
              "transfer_creep",
              b.id,
              config.LOGISTICS.SCORES.BUILDER,
              {},
              ["hauler"],
            ),
          );
        }
      });
    }

    // 6. Sink Containers (Buffers)
    if (this.energyState !== "EMERGENCY") {
      const containers = StructureCache.getStructures(
        this.room,
        STRUCTURE_CONTAINER,
      ) as StructureContainer[];
      
      const cacheTarget =
        (this.room.controller?.level || 1) < 4
          ? config.LOGISTICS.THRESHOLDS.CONTAINER_CACHE
          : config.LOGISTICS.THRESHOLDS.CONTAINER_CACHE_HIGH;

      containers.forEach((s) => {
          if (s.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return;
          
          // Optimization: Reuse cached sources
          let isSourceContainer = false;
          for (const source of sources) {
            if (s.pos.inRangeTo(source, 2)) {
                isSourceContainer = true;
                break;
            }
          }
          if (isSourceContainer) return;

          // Check if near Controller (Range 3) or Spawn (Range 3)
          const nearController =
            this.room.controller &&
            s.pos.inRangeTo(this.room.controller, 3);
          
          let nearSpawn = false;
          // Reuse cached spawns
          for (const sp of spawns) {
              if (s.pos.inRangeTo(sp, 3)) {
                  nearSpawn = true;
                  break;
              }
          }

          if ((nearController || nearSpawn) && s.store[RESOURCE_ENERGY] < cacheTarget) {
               this.tasks.push(
                new Task("transfer_container", s.id, config.LOGISTICS.SCORES.CONTAINER, {}, ["hauler"])
            );
          }
      });
    }

    // 7. Construction Sites (for Builders)
    const sites = StructureCache.getConstructionSites(this.room);
    sites.forEach((s) => {
      this.tasks.push(
        new Task(
          "build",
          s.id,
          config.LOGISTICS.SCORES.BUILDER,
          {},
          ["builder"],
        ),
      );
    });

    // 8. Upgrading (for Upgraders)
    if (this.room.controller) {
      this.tasks.push(
        new Task(
          "upgrade",
          this.room.controller.id,
          config.LOGISTICS.SCORES.UPGRADER,
          {},
          ["upgrader"],
        ),
      );
    }
  }

  /**
   * Get the best task for a creep
   * @param {Creep} creep
   * @returns {Task|null}
   */
  getBestTask(creep: Creep): Task | null {
    let bestTask = null;
    let maxScore = -Infinity;

    this.tasks.forEach((task) => {
      // Use Task.isValid checks (lightweight)
      // We skip heavy checks here because tasks are generated fresh this tick
      // But target might have become invalid in same tick (unlikely for structures, likely for creeps)
      // Let's trust generateTasks for now to be fast.
      // But getScore does simple checks.
      
      const score = task.getScore(creep);
      if (score > maxScore) {
        maxScore = score;
        bestTask = task;
      }
    });

    return bestTask;
  }
}
