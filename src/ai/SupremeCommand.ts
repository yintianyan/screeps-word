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
    // [Fix] Include Container energy for RCL 3 rooms without storage
    let storedEnergy = 0;
    if (room.storage) {
      storedEnergy = room.storage.store[RESOURCE_ENERGY];
    } else {
      const containers = room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }) as StructureContainer[];
      storedEnergy = containers.reduce(
        (sum, c) => sum + c.store[RESOURCE_ENERGY],
        0,
      );

      // Add current spawn energy (important for early game)
      storedEnergy += room.energyAvailable;
    }

    // Thresholds:
    // RCL 3: Crisis < 2000 (Basically empty containers)
    // RCL 4+: Crisis < 5000
    const threshold =
      room.controller && room.controller.level >= 4 ? 5000 : 2000;

    if (
      storedEnergy < threshold &&
      room.controller &&
      room.controller.level >= 3
    ) {
      // Severe energy crisis in established room
      if (room.memory.energyLevel !== "CRITICAL") {
        room.memory.energyLevel = "CRITICAL";
        console.log(
          `[SupremeCommand] 🚨 ENERGY CRISIS DECLARED in ${room.name} (Stored: ${storedEnergy} < ${threshold})`,
        );
      }
    } else {
      // Recovery mechanism: If energy is back to safe levels, clear CRITICAL
      // Hysteresis: Require 2x threshold to exit crisis
      if (
        room.memory.energyLevel === "CRITICAL" &&
        storedEnergy > threshold * 1.5
      ) {
        room.memory.energyLevel = "LOW"; // Reset to LOW or calculate properly
        console.log(
          `[SupremeCommand] ✅ ENERGY CRISIS RESOLVED in ${room.name} (Stored: ${storedEnergy})`,
        );
      }
    }
  }
}
