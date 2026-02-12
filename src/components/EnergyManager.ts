import Cache from "./memoryManager";

export enum CrisisLevel {
  NONE = 0, // No crisis, abundant energy
  LOW = 1, // Warning, start saving
  MEDIUM = 2, // Cut builders
  HIGH = 3, // Cut upgrader speed
  CRITICAL = 4, // Emergency, only spawn and defense
}

interface RCLConfig {
  minEnergy: number; // Minimum energy to be considered "Safe" (Level 0/1 transition)
  crisisThreshold: number; // Energy below this is CRITICAL (Level 4)
  upgraderBudget: {
    [key in CrisisLevel]: number; // Allowed WORK parts per tick or count
  };
  builderBudget: {
    [key in CrisisLevel]: number; // Allowed WORK parts
  };
}

const DEFAULT_CONFIG: Record<number, RCLConfig> = {
  0: {
    minEnergy: 300,
    crisisThreshold: 100,
    upgraderBudget: {
      [CrisisLevel.NONE]: 5,
      [CrisisLevel.LOW]: 3,
      [CrisisLevel.MEDIUM]: 2,
      [CrisisLevel.HIGH]: 1,
      [CrisisLevel.CRITICAL]: 0,
    },
    builderBudget: {
      [CrisisLevel.NONE]: 5,
      [CrisisLevel.LOW]: 3,
      [CrisisLevel.MEDIUM]: 1,
      [CrisisLevel.HIGH]: 0,
      [CrisisLevel.CRITICAL]: 0,
    },
  },
  // Early Game (RCL 1-3)
  1: {
    minEnergy: 300,
    crisisThreshold: 200,
    upgraderBudget: {
      [CrisisLevel.NONE]: 5,
      [CrisisLevel.LOW]: 3,
      [CrisisLevel.MEDIUM]: 2,
      [CrisisLevel.HIGH]: 1,
      [CrisisLevel.CRITICAL]: 1, // Always allow 1 to prevent downgrade
    },
    builderBudget: {
      [CrisisLevel.NONE]: 3,
      [CrisisLevel.LOW]: 2,
      [CrisisLevel.MEDIUM]: 1,
      [CrisisLevel.HIGH]: 0,
      [CrisisLevel.CRITICAL]: 0,
    },
  },
  2: {
    minEnergy: 550,
    crisisThreshold: 300,
    upgraderBudget: {
      [CrisisLevel.NONE]: 5,
      [CrisisLevel.LOW]: 4,
      [CrisisLevel.MEDIUM]: 3,
      [CrisisLevel.HIGH]: 2,
      [CrisisLevel.CRITICAL]: 1,
    },
    builderBudget: {
      [CrisisLevel.NONE]: 3,
      [CrisisLevel.LOW]: 2,
      [CrisisLevel.MEDIUM]: 1,
      [CrisisLevel.HIGH]: 0,
      [CrisisLevel.CRITICAL]: 0,
    },
  },
  3: {
    minEnergy: 800,
    crisisThreshold: 400,
    upgraderBudget: {
      [CrisisLevel.NONE]: 10,
      [CrisisLevel.LOW]: 5,
      [CrisisLevel.MEDIUM]: 3,
      [CrisisLevel.HIGH]: 2,
      [CrisisLevel.CRITICAL]: 1,
    },
    builderBudget: {
      [CrisisLevel.NONE]: 5,
      [CrisisLevel.LOW]: 3,
      [CrisisLevel.MEDIUM]: 1,
      [CrisisLevel.HIGH]: 0,
      [CrisisLevel.CRITICAL]: 0,
    },
  },
  // Mid Game (Storage Available)
  4: {
    minEnergy: 10000,
    crisisThreshold: 2000,
    upgraderBudget: {
      [CrisisLevel.NONE]: 20,
      [CrisisLevel.LOW]: 10,
      [CrisisLevel.MEDIUM]: 5,
      [CrisisLevel.HIGH]: 2,
      [CrisisLevel.CRITICAL]: 1,
    },
    builderBudget: {
      [CrisisLevel.NONE]: 10,
      [CrisisLevel.LOW]: 5,
      [CrisisLevel.MEDIUM]: 2,
      [CrisisLevel.HIGH]: 0,
      [CrisisLevel.CRITICAL]: 0,
    },
  },
  5: {
    minEnergy: 20000,
    crisisThreshold: 5000,
    upgraderBudget: {
      [CrisisLevel.NONE]: 30,
      [CrisisLevel.LOW]: 15,
      [CrisisLevel.MEDIUM]: 8,
      [CrisisLevel.HIGH]: 4,
      [CrisisLevel.CRITICAL]: 2, // Allow 2 to maintain ramparts/downgrade safely
    },
    builderBudget: {
      [CrisisLevel.NONE]: 15,
      [CrisisLevel.LOW]: 8,
      [CrisisLevel.MEDIUM]: 4,
      [CrisisLevel.HIGH]: 1,
      [CrisisLevel.CRITICAL]: 0,
    },
  },
  6: {
    minEnergy: 50000,
    crisisThreshold: 10000,
    upgraderBudget: {
      [CrisisLevel.NONE]: 40,
      [CrisisLevel.LOW]: 20,
      [CrisisLevel.MEDIUM]: 10,
      [CrisisLevel.HIGH]: 5,
      [CrisisLevel.CRITICAL]: 2,
    },
    builderBudget: {
      [CrisisLevel.NONE]: 20,
      [CrisisLevel.LOW]: 10,
      [CrisisLevel.MEDIUM]: 5,
      [CrisisLevel.HIGH]: 2,
      [CrisisLevel.CRITICAL]: 0,
    },
  },
  // Late Game
  7: {
    minEnergy: 100000,
    crisisThreshold: 20000,
    upgraderBudget: {
      [CrisisLevel.NONE]: 50, // Max boost
      [CrisisLevel.LOW]: 25,
      [CrisisLevel.MEDIUM]: 12,
      [CrisisLevel.HIGH]: 6,
      [CrisisLevel.CRITICAL]: 3, // RCL 7 needs more maintenance
    },
    builderBudget: {
      [CrisisLevel.NONE]: 25,
      [CrisisLevel.LOW]: 12,
      [CrisisLevel.MEDIUM]: 6,
      [CrisisLevel.HIGH]: 3,
      [CrisisLevel.CRITICAL]: 0,
    },
  },
  8: {
    minEnergy: 200000, // 200k buffer
    crisisThreshold: 50000, // 50k is panic mode for RCL 8
    upgraderBudget: {
      [CrisisLevel.NONE]: 15, // RCL 8 capped at 15 energy/tick usually unless boosted
      [CrisisLevel.LOW]: 10,
      [CrisisLevel.MEDIUM]: 5,
      [CrisisLevel.HIGH]: 2,
      [CrisisLevel.CRITICAL]: 1, // Just maintain
    },
    builderBudget: {
      [CrisisLevel.NONE]: 30,
      [CrisisLevel.LOW]: 15,
      [CrisisLevel.MEDIUM]: 8,
      [CrisisLevel.HIGH]: 4,
      [CrisisLevel.CRITICAL]: 0,
    },
  },
};

export class EnergyManager {
  /**
   * Calculate current Crisis Level based on RCL and stored energy
   */
  static update(room: Room) {
    if (!room.controller) return;

    const rcl = room.controller.level;
    const config = DEFAULT_CONFIG[rcl] || DEFAULT_CONFIG[0];

    // Calculate Total Stored Energy
    let totalEnergy = room.energyAvailable;

    // Add Containers
    const containers = Cache.getStructures(
      room,
      STRUCTURE_CONTAINER,
    ) as StructureContainer[];
    totalEnergy += containers.reduce(
      (sum, c) => sum + c.store[RESOURCE_ENERGY],
      0,
    );

    // Add Storage
    if (room.storage) {
      totalEnergy += room.storage.store[RESOURCE_ENERGY];
    }

    // Add Terminal (Optional, usually for trading, but counts as asset)
    if (room.terminal) {
      totalEnergy += room.terminal.store[RESOURCE_ENERGY];
    }

    // Determine Level
    // Hysteresis: If previous level exists, use buffer to avoid flickering?
    // Simplified for now: Direct mapping

    let level = CrisisLevel.NONE;

    if (totalEnergy < config.crisisThreshold) {
      level = CrisisLevel.CRITICAL;
    } else if (totalEnergy < config.minEnergy * 0.3) {
      level = CrisisLevel.HIGH;
    } else if (totalEnergy < config.minEnergy * 0.6) {
      level = CrisisLevel.MEDIUM;
    } else if (totalEnergy < config.minEnergy) {
      level = CrisisLevel.LOW;
    } else {
      level = CrisisLevel.NONE;
    }

    // Save to Memory
    if (!room.memory.energyManager) room.memory.energyManager = {};
    const oldLevel = room.memory.energyManager.level;

    if (oldLevel !== level) {
      console.log(
        `[Energy] Room ${room.name} (RCL ${rcl}) Crisis Level: ${CrisisLevel[oldLevel]} -> ${CrisisLevel[level]} (Energy: ${totalEnergy})`,
      );
      room.memory.energyManager.level = level;
      room.memory.energyManager.totalEnergy = totalEnergy;
    } else {
      // Just update energy count
      room.memory.energyManager.totalEnergy = totalEnergy;
    }
  }

  static getLevel(room: Room): CrisisLevel {
    return room.memory.energyManager?.level || CrisisLevel.NONE;
  }

  static getBudget(room: Room, type: "upgrader" | "builder"): number {
    if (!room.controller) return 0;
    const rcl = room.controller.level;
    const config = DEFAULT_CONFIG[rcl] || DEFAULT_CONFIG[0];
    const level = this.getLevel(room);

    if (type === "upgrader") {
      // [Safety Check] If downgrade imminent, override budget
      if (room.controller.ticksToDowngrade < 2000) {
        return Math.max(config.upgraderBudget[level], 1); // Force at least 1
      }
      return config.upgraderBudget[level];
    } else {
      return config.builderBudget[level];
    }
  }

  static getStatusReport(room: Room): string {
    const level = this.getLevel(room);
    const energy = room.memory.energyManager?.totalEnergy || 0;
    const rcl = room.controller?.level || 0;
    return `[Energy Crisis System] Room: ${room.name} | RCL: ${rcl} | Level: ${CrisisLevel[level]} | Energy: ${energy}`;
  }
}
