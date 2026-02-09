
// Task Types
export type TaskType = 
  | 'HARVEST' 
  | 'TRANSFER' 
  | 'UPGRADE' 
  | 'BUILD' 
  | 'REPAIR' 
  | 'DEFEND' 
  | 'ATTACK' 
  | 'HEAL' 
  | 'SCOUT' 
  | 'CLAIM' 
  | 'RESERVE' 
  | 'PICKUP';

// Priority Levels
export enum TaskPriority {
  CRITICAL = 0, // Emergency defense, spawn refill
  HIGH = 1,     // Tower refill, decay prevention
  NORMAL = 2,   // Regular harvesting, upgrading
  LOW = 3,      // Wall building, road repair
  IDLE = 4      // Scouting, signing controller
}

// Task Interface
export interface Task {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  sourceId?: string;     // Where to get resource (if needed)
  targetId: string;      // Where to perform action
  pos: RoomPosition;     // Target position
  amount?: number;       // Amount of resource needed/transferring
  creepsAssigned: string[]; // IDs of creeps assigned
  maxCreeps: number;     // Max concurrent creeps
  requirements?: {
    bodyParts?: BodyPartConstant[];
    minEnergy?: number;
    minCapacity?: number;
  };
  creationTime: number;
  expiryTime?: number;   // When to drop task if not picked up
  data?: any;
}

// Dispatch Memory Structure
export interface DispatchMemory {
  tasks: { [id: string]: Task };
  assignments: { [creepId: string]: string }; // creepId -> taskId
  queues: { [priority in TaskPriority]: string[] }; // priority -> taskIds
}

// Creep Extension
declare global {
  interface CreepMemory {
    taskId?: string;
    taskType?: TaskType;
    dispatch?: {
        state: 'IDLE' | 'WORKING' | 'MOVING';
    }
  }
}
