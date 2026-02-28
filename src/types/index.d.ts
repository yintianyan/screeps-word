import { DispatchMemory, LifecycleMemory } from "./dispatch";
import { KernelMemory } from "../core/types";

declare global {
  interface CreepMemory {
    role: string;
    room: string;
    working: boolean;
    taskId?: string;
    targetId?: string;
    taskStart?: number;
    _move?: unknown;

    sourceId?: string;
    hauling?: boolean;
    idleTicks?: number;
    requestingEnergy?: boolean;
    waitingTicks?: number;
    efficiency?: {
      workingTicks: number;
      idleTicks: number;
      totalTicks: number;
    };
    targetRoom?: string;
    homeRoom?: string;
    _moveRequest?: unknown;
  }

  interface RoomStats {
    energy: number;
    energyCapacity: number;
    creepCounts: Record<string, number>;
    cpu: number;
    rcl: number;
    rclProgress: number;
    storage: number;
    enemyCount: number;
  }

  interface RoomStatsEntry extends RoomStats {
    time: number;
  }

  interface StatsMemory {
    rooms: Record<
      string,
      {
        history: RoomStatsEntry[];
      }
    >;
    cpu: {
      bucket: number;
      used: number;
      limit: number;
      scheduler: number;
    };
    time: number;
  }

  interface Memory {
    uuid: number;
    log: unknown;
    watch: unknown;
    config: {
      taskManager?: {
        maxQueueLength: number;
        maxRetry: number;
        ttl: {
          completed: number;
          failed: number;
          pending: number;
        };
        cleanupInterval: number;
      };
    };
    stats?: StatsMemory;
    lifecycle: LifecycleMemory;
    dispatch: DispatchMemory;
    datastore: import("./stats").DataStore;
    kernel: KernelMemory;
    _logFlood: unknown;
  }

  interface RoomMemory {
    avoid?: unknown;
    energyLevel?: "CRITICAL" | "LOW" | "MEDIUM" | "HIGH";
    remotes?: string[];
    planner?: {
      layout: "stamp" | "bunker";
      anchor?: { x: number; y: number };
    };
    scout?: {
      lastScan: number;
      status: "pending" | "active" | "completed";
    };
    remote?: {
      [roomName: string]: {
        reserver?: {
          targetRoom: string;
          ticksToEnd: number;
          assigned: boolean;
        };
        threat?: {
          level: number;
          lastSeen: number;
          hostiles: number;
        };
      };
    };
  }

  interface Room {
    _laneMatrices?: unknown;
    _populationTargets?: Record<string, number>;
    _populationTargetsTick?: number;
  }

  namespace NodeJS {
    interface Global {
      log: unknown;
    }
  }
}
