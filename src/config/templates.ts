
import { TaskType } from "../types/dispatch";

export interface BodyTemplate {
  base: BodyPartConstant[];
  grow: BodyPartConstant[];
  maxGrow: number; // Max number of grow sets
  maxParts?: number; // Hard limit on total parts
  role: string;
}

export const CreepTemplates: { [key: string]: BodyTemplate } = {
  harvester: {
    role: "harvester",
    base: [WORK, CARRY, MOVE],
    grow: [WORK],
    maxGrow: 4, // 5 WORK total = 10 energy/tick
  },
  hauler: {
    role: "hauler",
    base: [CARRY, MOVE],
    grow: [CARRY, MOVE],
    maxGrow: 15, // 32 parts max
  },
  upgrader: {
    role: "upgrader",
    base: [WORK, CARRY, MOVE],
    grow: [WORK, WORK, MOVE],
    maxGrow: 10,
  },
  builder: {
    role: "builder",
    base: [WORK, CARRY, MOVE],
    grow: [WORK, CARRY, MOVE],
    maxGrow: 5,
  },
  // New roles for dispatch system
  defender: {
    role: "defender",
    base: [TOUGH, MOVE, ATTACK, MOVE],
    grow: [ATTACK, MOVE],
    maxGrow: 5,
  },
  repairer: {
    role: "repairer", // Specialized repairer if needed
    base: [WORK, CARRY, MOVE],
    grow: [WORK, CARRY, MOVE],
    maxGrow: 5,
  }
};

export const RoleToTaskMap: { [role: string]: TaskType[] } = {
  harvester: [TaskType.HARVEST],
  hauler: [TaskType.TRANSFER, TaskType.PICKUP, TaskType.HAUL],
  upgrader: [TaskType.UPGRADE],
  builder: [TaskType.BUILD, TaskType.REPAIR, TaskType.TRANSFER],
  defender: [TaskType.DEFEND, TaskType.ATTACK],
  repairer: [TaskType.REPAIR]
};
