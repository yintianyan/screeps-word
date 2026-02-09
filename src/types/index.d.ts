
import { DispatchMemory } from './dispatch';

declare global {
  // Memory extension samples
  interface CreepMemory {
    role: string;
    room?: string;
    working?: boolean;
    sourceId?: string; // For Harvester
    targetId?: string; // For Hauler
    hauling?: boolean; // For Hauler
    idleTicks?: number;
    requestingEnergy?: boolean;
    waitingTicks?: number;
    efficiency?: {
      workingTicks: number;
      idleTicks: number;
      totalTicks: number;
    };
    _move?: any;
    _moveRequest?: any;
    [key: string]: any;
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
  }

  interface Memory {
    uuid: number;
    log: any;
    watch: any;
    profiler: any;
    config: any;
    stats: StatsMemory;
    lifecycle: any; // Add lifecycle
    dispatch: DispatchMemory; // [NEW] Global Dispatch Memory
    _logFlood: any;
  }

  interface RoomMemory {
    avoid?: any;
    energyLevel?: "CRITICAL" | "LOW" | "MEDIUM" | "HIGH";
    [key: string]: any;
  }

  namespace NodeJS {
    interface Global {
      log: any;
      [key: string]: any;
    }
  }
}
