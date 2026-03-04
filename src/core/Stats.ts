import { TrafficManager } from "./TrafficManager";

type CpuStats = {
  bucket: number;
  used: number;
  limit: number;
  scheduler: number;
};

function ensureStats(): StatsMemory {
  if (!Memory.stats) {
    Memory.stats = {
      rooms: {},
      cpu: { bucket: 0, used: 0, limit: 0, scheduler: 0 },
      time: 0,
    };
  }
  const stats = Memory.stats;
  if (!stats.rooms) stats.rooms = {};
  if (!stats.cpu) stats.cpu = { bucket: 0, used: 0, limit: 0, scheduler: 0 };
  if (!stats.time) stats.time = 0;
  return stats;
}

function countCreepsByRole(room: Room): Record<string, number> {
  const counts: Record<string, number> = {};
  const creeps = room.find(FIND_MY_CREEPS);
  for (const creep of creeps) {
    const role = creep.memory.role || "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

/**
 * 记录 CPU 统计信息
 *
 * @param stats CPU 使用情况
 */
export function recordCpuStats(stats: CpuStats): void {
  const mem = ensureStats();
  mem.cpu = stats;
  mem.time = Game.time;
}

export function recordTrafficStats(): void {
  const mem = ensureStats();
  mem.traffic = TrafficManager.getTelemetrySnapshot();
}

/**
 * 记录房间统计信息
 *
 * 包括：RCL, 能量, Creep 数量, Storage 储量, 敌对 Creep 等。
 * 数据存储在 Memory.stats.rooms[roomName].history 中，用于 Grafana 或 Dashboard 展示。
 * 
 * 优化：默认 maxHistory 减少至 5，避免 Memory 过大导致 CPU 解析开销。
 * 如需长期存储，建议使用 RawMemory。
 *
 * @param room 目标房间
 * @param maxHistory 保留的历史记录长度 (默认 5)
 */
export function recordRoomStats(room: Room, maxHistory = 5): void {
  const mem = ensureStats();
  if (!mem.rooms[room.name]) mem.rooms[room.name] = { history: [] };
  const strategy = room.memory.strategy;
  const sources = room.find(FIND_SOURCES);

  const entry: RoomStatsEntry = {
    time: Game.time,
    energy: room.energyAvailable,
    energyCapacity: room.energyCapacityAvailable,
    creepCounts: countCreepsByRole(room),
    cpu: 0,
    rcl: room.controller?.level ?? 0,
    rclProgress: room.controller?.progress ?? 0,
    storage: room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    enemyCount: room.find(FIND_HOSTILE_CREEPS).length,
    mode: strategy?.mode,
    sourceCount: sources.length,
    idleSourceCount: strategy?.idleSourceCount,
    minerCoverage: strategy?.minerCoverage,
  };

  const history = mem.rooms[room.name].history;
  history.push(entry);
  if (history.length > maxHistory)
    history.splice(0, history.length - maxHistory);
}
