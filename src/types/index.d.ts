
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
    sourceType?: "storage" | "link" | "container" | "source";
    hauling?: boolean;
    fillCount?: number;
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
    _lastScan?: string;
    workerStickyTask?: {
      type: "pickup" | "harvest" | "withdraw" | "transfer" | "upgrade" | "build" | "repair";
      targetId?: string;
      resourceType?: ResourceConstant;
      until: number;
    };
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

  interface DebugEvent {
    time: number;
    tag: string;
    room?: string;
    creep?: string;
    pid?: string;
    data?: unknown;
  }

  interface DebugTick {
    time: number;
    counters?: Record<string, number>;
    gauges?: Record<string, number>;
    kernelTop?: Array<[string, number]>;
  }

  interface DebugStatsMemory {
    events?: DebugEvent[];
    ticks?: DebugTick[];
    counters?: Record<string, number>;
    gauges?: Record<string, number>;
    kernelTop?: Array<[string, number]>;
    lastFlush?: number;
  }

  interface TrafficRoomStats {
    stuckSamples: number;
    severeStuckSamples: number;
    oscillateSamples: number;
    noPathCount: number;
    pushRequests: number;
    pushSuccess: number;
    pushFallbackSuccess: number;
    yieldMoves: number;
    maxStuck: number;
    maxOscillate: number;
    lastStuckPos?: string;
    lastStuckCreep?: string;
    lastTargetPos?: string;
  }

  interface TrafficStatsMemory {
    time: number;
    moveSamples: number;
    stuckSamples: number;
    severeStuckSamples: number;
    oscillateSamples: number;
    noPathCount: number;
    pushRequests: number;
    pushSuccess: number;
    pushFallbackSuccess: number;
    yieldMoves: number;
    rooms: Record<string, TrafficRoomStats>;
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
    debug?: DebugStatsMemory;
    traffic?: TrafficStatsMemory;
  }

  // --- Room Intel Data Structure ---
  interface RoomIntelData {
    updatedAt: number; // 上次更新 tick
    owner?: string; // 拥有者
    rcl?: number; // RCL 等级
    
    // 地形与资源
    sources?: { x: number; y: number; id?: string }[];
    mineral?: { x: number; y: number; type: MineralConstant; id?: string };
    
    // 敌对信息
    hostiles?: number; // 敌方 Creep 数量
    towers?: number; // 敌方塔数量
    invaderCore?: boolean; // 是否有 Invader Core
    
    // 导航信息
    exits?: Partial<Record<DirectionConstant, string>>; // 出口连接的房间
    sk?: boolean; // 是否是 Source Keeper 房间
    center?: boolean; // 是否是中心房 (Highway/Sector Center)
  }
  
  interface IntelMemory {
    rooms: Record<string, RoomIntelData>;
    requests: string[]; // 待探索房间列表
  }

  interface WarSpawnRequest {
    id: string;
    roomName: string;
    role: string;
    body: BodyPartConstant[];
    priority: number;
    memory: CreepMemory;
    status: "pending" | "processing" | "completed";
  }

  interface WarMemory {
    spawnRequests: WarSpawnRequest[];
    campaigns: Record<string, CampaignData>;
  }

  interface CampaignData {
    targetRoom: string;
    type: "harass" | "dismantle" | "capture" | "drain";
    state: "spawning" | "rallying" | "attacking" | "completed" | "failed";
    squads: SquadData[];
    originRoom: string;
    startTime: number;
  }

  interface SquadData {
    id: string;
    type: "duo" | "quad" | "solo";
    creeps: string[]; // Creep names
    role: "attacker" | "healer" | "dismantler" | "claimer";
    state: "spawning" | "rallying" | "moving" | "engaging";
    rallyPos?: { x: number; y: number; roomName: string };
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
      debug?: {
        enabled?: boolean;
        sampleRate?: number;
        maxEvents?: number;
        maxTicks?: number;
        flushInterval?: number;
        roomFilter?: string[];
      };
    };
    stats?: StatsMemory;
    lifecycle: LifecycleMemory;
    dispatch: DispatchMemory;
    kernel: KernelMemory;
    intel?: IntelMemory; // 全局 Intel 内存
    war?: WarMemory; // 战争模块内存
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
      layout: "stamp" | "bunker" | "atlas" | "auto";
      anchor?: { x: number; y: number };
      dynamic?: {
        lastUpdate: number;
        anchor: { x: number; y: number };
        roads: string[];
        noBuild: string[];
      };
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
    traffic?: {
      heat?: {
        [pos: string]: {
          value: number;
          updatedAt: number;
        };
      };
      lastPrune?: number;
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
      War: {
        attack: (target: string, origin: string, type?: "harass" | "dismantle" | "capture" | "drain") => string;
        list: () => void;
        stop: (id: string) => void;
      };
    }
  }
}
