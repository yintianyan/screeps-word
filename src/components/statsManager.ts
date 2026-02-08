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

export default class StatsManager {
  static run(room: Room) {
    this.analyzeCreepEfficiency(room);

    if (Game.time % 10 === 0) {
      this.recordRoomStats(room);
      this.cleanupHistory();
    }
  }

  private static recordRoomStats(room: Room) {
    if (!Memory.stats) Memory.stats = { rooms: {} };
    if (!Memory.stats.rooms[room.name])
      Memory.stats.rooms[room.name] = { history: [] };

    const stats: RoomStats = {
      energy: room.energyAvailable,
      energyCapacity: room.energyCapacityAvailable,
      creepCounts: this.getCreepCounts(room),
      cpu: Game.cpu.getUsed(),
      rcl: room.controller ? room.controller.level : 0,
      rclProgress: room.controller
        ? (room.controller.progress / room.controller.progressTotal) * 100
        : 0,
      storage: room.storage
        ? room.storage.store.getUsedCapacity(RESOURCE_ENERGY)
        : 0,
      enemyCount: room.find(FIND_HOSTILE_CREEPS).length,
    };

    // Store history (keep last 100 entries = 1000 ticks)
    const history = Memory.stats.rooms[room.name].history;
    history.push({ time: Game.time, ...stats });
    if (history.length > 100) history.shift();
  }

  private static getCreepCounts(room: Room): Record<string, number> {
    const counts: Record<string, number> = {};
    const creeps = room.find(FIND_MY_CREEPS);
    creeps.forEach((c) => {
      const role = c.memory.role || "unknown";
      counts[role] = (counts[role] || 0) + 1;
    });
    return counts;
  }

  private static analyzeCreepEfficiency(room: Room) {
    const creeps = room.find(FIND_MY_CREEPS);
    creeps.forEach((creep) => {
      if (!creep.memory.efficiency) {
        creep.memory.efficiency = {
          workingTicks: 0,
          idleTicks: 0,
          totalTicks: 0,
        };
      }

      const eff = creep.memory.efficiency;
      eff.totalTicks++;

      // Heuristic for "working": not idle, not waiting
      // Better heuristic: if moving or fatigue or store not empty and not full...
      // Simplest: if store is changing or moving?
      // Let's stick to the simple one:
      // Working = (Has Energy) OR (Harvesting/Working)
      // Idle = (Empty & Not Moving)

      // If full or partially full, we assume it's doing something useful (carrying/working)
      // If empty, it should be moving to source.

      if (creep.store.getUsedCapacity() > 0) {
        eff.workingTicks++;
      } else {
        // Empty
        if (creep.fatigue > 0 || creep.memory._move) {
          eff.workingTicks++; // Moving to source
        } else {
          // Empty and not moving? Idle.
          // Except Harvester sitting on source?
          if (creep.memory.role === "harvester") {
            // Harvester is working if it's near source?
            // Simplified: Harvester is always working unless container full?
            eff.workingTicks++;
          } else {
            eff.idleTicks++;
          }
        }
      }
    });
  }

  private static cleanupHistory() {
    // Global cleanup if needed
  }

  static getTrend(
    roomName: string,
    key: keyof RoomStats,
    window: number = 10,
  ): number {
    const history = Memory.stats?.rooms[roomName]?.history || [];
    if (history.length < 2) return 0;

    const end = history[history.length - 1][key] as number;
    const start = history[Math.max(0, history.length - window)][key] as number;

    return end - start;
  }
}
