import Cache from "../components/memoryManager";

export enum Strategy {
  BOOTSTRAP = "BOOTSTRAP", // RCL 1-2, survival
  GROWTH = "GROWTH", // RCL 3-5, expansion
  FORTIFY = "FORTIFY", // Defense focus
  WAR = "WAR", // Active combat
}

export class SupremeCommand {
  static run(room: Room) {
    // 1. Determine Strategy
    const strategy = this.analyzeStrategy(room);

    // 2. Adjust Memory Flags (Global Dispatch communicates via Memory)
    if (!room.memory.strategy || room.memory.strategy !== strategy) {
      room.memory.strategy = strategy;
      console.log(
        `[SupremeCommand] Strategy changed to ${strategy} for ${room.name}`,
      );
    }

    // 3. Crisis Management
    this.checkCrisis(room);
  }

  private static analyzeStrategy(room: Room): Strategy {
    const rcl = room.controller?.level || 0;

    if (rcl < 3) return Strategy.BOOTSTRAP;

    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) return Strategy.WAR;

    // Check if we are under stress
    if (room.memory.energyLevel === "CRITICAL") return Strategy.BOOTSTRAP; // Fallback to survival logic

    return Strategy.GROWTH;
  }

  private static checkCrisis(room: Room) {
    // 1. Hostile Check
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
      room.memory.strategy = Strategy.WAR;
      // Trigger safe mode if critical?
      // if (room.controller?.safeModeAvailable && hostiles.length > 3) room.controller.activateSafeMode();
    }

    // 2. Energy Crisis Check
    const storedEnergy = room.storage
      ? room.storage.store[RESOURCE_ENERGY]
      : room.energyAvailable;
    if (storedEnergy < 5000 && room.controller && room.controller.level >= 3) {
      // Severe energy crisis in established room
      if (room.memory.energyLevel !== "CRITICAL") {
        room.memory.energyLevel = "CRITICAL";
        console.log(
          `[SupremeCommand] 🚨 ENERGY CRISIS DECLARED in ${room.name}`,
        );
      }
    }
  }
}
