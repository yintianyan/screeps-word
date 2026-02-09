export interface RoomSnapshot {
  timestamp: number;
  roomName: string;
  rcl: {
    level: number;
    progress: number;
    progressTotal: number;
  };
  energy: {
    available: number;
    capacity: number;
    storage: number;
    terminal: number;
  };
  resources: Record<ResourceConstant, number>;
  census: Record<string, number>; // role -> count
  construction: {
    sites: number;
    progress: number;
    progressTotal: number;
  };
  threat: {
    level: number; // 0: Safe, 1: Scout, 2: Invader, 3: Player Attack
    hostiles: number;
    owner?: string;
  };
  cpu: {
    bucket: number;
    used: number;
  };
}

export interface DataStore {
  rooms: Record<string, RoomSnapshot>;
  global: {
    gcl: number;
    gpl: number;
    credits: number;
    cpu: number;
  };
  history: Record<string, RoomSnapshot[]>; // Limited history
  alerts: Alert[];
}

export interface Alert {
  id: string;
  timestamp: number;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  roomName?: string;
  acknowledged: boolean;
}

export const ALERT_THRESHOLDS = {
  ENERGY_CRITICAL: 300,
  RCL_DOWNGRADE: 5000,
  HOSTILE_DETECTED: 1,
};
