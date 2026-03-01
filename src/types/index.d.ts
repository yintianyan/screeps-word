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
    mode?: string;
    sourceCount?: number;
    idleSourceCount?: number;
    minerCoverage?: number;
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
    kernel: KernelMemory;
    _logFlood: unknown;
  }

  interface RoomMemory {
    avoid?: unknown;
    energyLevel?: "CRITICAL" | "LOW" | "MEDIUM" | "HIGH";
    strategy?: {
      mode: "recover" | "economy" | "build" | "upgrade" | "defense";
      lastEval: number;
      lastSwitch: number;
      minerCoverage: number;
      idleSourceCount: number;
    };
    remotes?: string[];
    planner?: {
      layout: "stamp" | "bunker";
      anchor?: { x: number; y: number };
    };
    buildFocus?: {
      siteId: string;
      lastProgress: number;
      lastTick: number;
    };
    defenseLastHostile?: number;
    defense?: {
      hostiles: number;
      lastSeen: number;
      canFight: boolean;
    };
    links?: {
      source?: string[];
      hub?: string;
      controller?: string;
      lastScan?: number;
      lastPlan?: number;
    };
    scout?: {
      lastScan: number;
      status: "pending" | "active" | "completed";
      targetRoom?: string;
    };
    labs?: {
      inputs: string[];
      outputs: string[];
      reaction: string | null;
    };
    remote?: {
      [roomName: string]: {
        stats?: {
          lastCalc: number;
          distance: number;
          neededCarryParts: number;
          sourceCount: number;
        };
        sources?: {
          [sourceId: string]: {
            containerPos?: { x: number; y: number };
            containerId?: string;
            lastPlan?: number;
          };
        };
        reserver?: {
          targetRoom: string;
          ticksToEnd: number;
          assigned: boolean;
        };
        threat?: {
          level: number;
          lastSeen: number;
          hostiles: number;
          hasKeeper?: boolean;
        };
      };
    };
    mining?: {
      [sourceId: string]: {
        containerPos?: { x: number; y: number };
        containerId?: string;
        lastPlan?: number;
      };
    };
    metrics?: {
      idleRate: number;
      lastUpdate: number;
      workerCount: number;
      idleWorkerCount: number;
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
      kernel: import("../core/Kernel").Kernel;
    }
  }
}
