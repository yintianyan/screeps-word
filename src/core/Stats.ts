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

export function recordCpuStats(stats: CpuStats): void {
  const mem = ensureStats();
  mem.cpu = stats;
  mem.time = Game.time;
}

export function recordRoomStats(room: Room, maxHistory = 100): void {
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
