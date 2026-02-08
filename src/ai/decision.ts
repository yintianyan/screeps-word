import Task from "./task";
import config from "../config/constants";

export default class Brain {
  room: Room;
  tasks: Task[];
  energyState: string = "NORMAL";

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

    // 1. Spawn/Extension filling (High Priority)
    const energyStructures = this.room.find(FIND_STRUCTURES, {
      filter: (s) =>
        (s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_EXTENSION) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });

    energyStructures.forEach((s) => {
      const priority =
        this.energyState === "EMERGENCY"
          ? config.PRIORITY.EMERGENCY
          : config.PRIORITY.HIGH;
      this.tasks.push(new Task("transfer_spawn", s.id, priority));
    });

    // 2. Construction Sites
    const sites = this.room.find(FIND_CONSTRUCTION_SITES);
    sites.forEach((s) => {
      this.tasks.push(new Task("build", s.id, config.PRIORITY.MEDIUM));
    });

    // 3. Upgrading
    if (this.room.controller) {
      this.tasks.push(
        new Task("upgrade", this.room.controller.id, config.PRIORITY.LOW),
      );
    }

    // Add more task generators...
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
      if (!task.isValid()) return;

      const score = task.getScore(creep);
      if (score > maxScore) {
        maxScore = score;
        bestTask = task;
      }
    });

    return bestTask;
  }
}
