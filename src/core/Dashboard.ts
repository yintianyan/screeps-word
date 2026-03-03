/**
 * 控制台仪表盘
 *
 * 每 10 tick 在控制台打印一次系统状态概览。
 * 包含：CPU 使用率、Bucket、各房间状态 (RCL, 能量, Creep 统计, 敌对信息)。
 */
export class Dashboard {
  public static run(): void {
    if (Game.time % 10 !== 0) return; // Run every 10 ticks

    const cpu = Memory.stats?.cpu;
    if (!cpu) return;

    const bucketBar = this.progressBar(cpu.bucket, 10000, 10);

    console.log(
      `\n=== DASHBOARD [${Game.time}] CPU: ${cpu.used.toFixed(2)} | Bucket: ${cpu.bucket} ${bucketBar} ===`,
    );

    // Header
    console.log(
      `| Room | RCL | Energy | Storage | Creeps (W/M/H/di/U/D) | Src (idle/total) | Mode | Hostiles |`,
    );

    const roomsStats = Memory.stats.rooms;
    for (const roomName in roomsStats) {
      // Use cached stats if available and fresh enough (e.g. < 20 ticks old)
      // Otherwise fall back or skip
      const roomHistory = roomsStats[roomName].history;
      if (!roomHistory || roomHistory.length === 0) continue;

      const stats = roomHistory[roomHistory.length - 1];
      if (Game.time - stats.time > 20) continue; // Skip stale stats

      const rcl = stats.rcl;
      const rclPct =
        stats.rclProgress > 0 // Note: We don't have total progress in stats, assuming approximate or just showing raw
          ? ((stats.rclProgress / 1000000) * 100).toFixed(1) // Simplified, actual total depends on level
          : "100"; // Stats doesn't store progressTotal. Let's fix Stats.ts later to include it or just show raw.

      // Let's stick to using stats for what we have.
      // To calculate percentage correctly we need progressTotal.
      // Let's grab room object if visible to get progressTotal, otherwise use stored data.
      const room = Game.rooms[roomName];
      let rclDisplay = `${rcl}`;
      if (room && room.controller) {
        const progressTotal = room.controller.progressTotal;
        const pct =
          progressTotal > 0
            ? ((room.controller.progress / progressTotal) * 100).toFixed(1)
            : "100";
        rclDisplay = `${rcl} (${pct}%)`;
      }

      const energy = stats.energy;
      const capacity = stats.energyCapacity;
      const energyPct =
        capacity > 0 ? ((energy / capacity) * 100).toFixed(0) : "0";

      const storage =
        stats.storage > 0 ? (stats.storage / 1000).toFixed(1) + "k" : "-";

      const c = stats.creepCounts;
      const creepStr = `${c.worker || 0}/${c.miner || 0}/${c.hauler || 0}/${c.distributor || 0}/${c.upgrader || 0}/${c.defender || 0}`;

      const srcStr = `${stats.idleSourceCount ?? 0}/${stats.sourceCount}`;
      const mode = stats.mode ?? "-";
      const hostiles = stats.enemyCount;
      const hostileStr = hostiles > 0 ? `🛑 ${hostiles}` : "✅";

      console.log(
        `| ${roomName.padEnd(4)} | ${rclDisplay.padEnd(10)} | ${energy.toString().padEnd(4)} (${energyPct}%) | ${storage.padEnd(6)} | ${creepStr.padEnd(14)} | ${srcStr.padEnd(14)} | ${mode.padEnd(6)} | ${hostileStr} |`,
      );
    }
  }

  private static progressBar(
    value: number,
    max: number,
    width: number,
  ): string {
    const filled = Math.round(
      (Math.max(0, Math.min(value, max)) / max) * width,
    );
    const empty = width - filled;
    return (
      "[" +
      "=".repeat(Math.max(0, filled)) +
      " ".repeat(Math.max(0, empty)) +
      "]"
    );
  }
}
