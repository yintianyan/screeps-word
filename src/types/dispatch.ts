// Task Types
export enum TaskType {
  HARVEST = "harvest",
  BUILD = "build",
  UPGRADE = "upgrade",
  REPAIR = "repair",
  HAUL = "haul",
  REMOTE_HARVEST = "remote_harvest", // [NEW]
  REMOTE_HAUL = "remote_haul", // [NEW]
  SCOUT = "scout", // [NEW]
  ATTACK = "attack",
}

// Priority Levels
export enum TaskPriority {
  CRITICAL = 0, // Emergency defense, spawn refill
  HIGH = 1, // Tower refill, decay prevention
  MEDIUM = 2, // [NEW] User Defined Medium
  NORMAL = 3, // Regular harvesting, upgrading
  LOW = 4, // Wall building, road repair
  IDLE = 5, // Scouting, signing controller
}

// Task Interface
export interface Task {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  sourceId?: string; // Where to get resource (if needed)
  targetId: string; // Where to perform action
  pos: RoomPosition; // Target position
  amount?: number; // Amount of resource needed/transferring
  creepsAssigned: string[]; // IDs of creeps assigned
  maxCreeps: number; // Max concurrent creeps
  requirements?: {
    bodyParts?: BodyPartConstant[];
    minEnergy?: number;
    minCapacity?: number;
  };
  creationTime: number;
  expiryTime?: number; // When to drop task if not picked up

  // [NEW] Stability & Prediction
  locked?: boolean; // If true, do not reassign even if idle
  sticky?: boolean; // If true, creep keeps this task until explicitly completed
  estimatedDuration?: number; // Ticks
  validRoles?: string[]; // Preferred roles

  data?: any;
}

export interface SpawnTask {
  id: string;
  roomName: string;
  role: string;
  priority: TaskPriority;
  body: BodyPartConstant[];
  memory: CreepMemory;
  requestTime: number;
}

// Dispatch Memory Structure
export interface DispatchMemory {
  tasks: { [id: string]: Task };
  assignments: { [creepId: string]: string }; // creepId -> taskId
  queues: { [priority in TaskPriority]: string[] }; // priority -> taskIds
  spawnQueue: SpawnTask[]; // [NEW] Centralized Spawn Queue
}

// Creep Extension
declare global {
  interface CreepMemory {
    taskId?: string;
    taskType?: TaskType;
    dispatch?: {
      state: "IDLE" | "WORKING" | "MOVING";
    };
  }
}
