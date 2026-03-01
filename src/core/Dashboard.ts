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
      `| Room | RCL | Energy | Storage | Creeps (W/M/H/U/D) | Src (idle/total) | Mode | Hostiles |`,
    );

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller?.my) continue;

      const rcl = room.controller.level;
      const progress = room.controller.progress;
      const progressTotal = room.controller.progressTotal;
      const rclPct =
        progressTotal > 0
          ? ((progress / progressTotal) * 100).toFixed(1)
          : "100";

      const energy = room.energyAvailable;
      const capacity = room.energyCapacityAvailable;
      const energyPct = ((energy / capacity) * 100).toFixed(0);

      const storage = room.storage
        ? (room.storage.store.getUsedCapacity(RESOURCE_ENERGY) / 1000).toFixed(
            1,
          ) + "k"
        : "-";

      const creeps = room.find(FIND_MY_CREEPS);
      const counts: Record<string, number> = {
        worker: 0,
        miner: 0,
        hauler: 0,
        upgrader: 0,
        defender: 0,
      };
      creeps.forEach((c) => {
        const r = c.memory.role;
        if (counts[r] !== undefined) counts[r]++;
      });

      const creepStr = `${counts.worker}/${counts.miner}/${counts.hauler}/${counts.upgrader}/${counts.defender}`;
      const sources = room.find(FIND_SOURCES).length;
      const idleSources = room.memory.strategy?.idleSourceCount ?? 0;
      const srcStr = `${idleSources}/${sources}`;
      const mode = room.memory.strategy?.mode ?? "-";
      const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
      const hostileStr = hostiles > 0 ? `🛑 ${hostiles}` : "✅";

      console.log(
        `| ${roomName.padEnd(4)} | ${rcl} (${rclPct}%) | ${energy.toString().padEnd(4)} (${energyPct}%) | ${storage.padEnd(6)} | ${creepStr.padEnd(14)} | ${srcStr.padEnd(14)} | ${mode.padEnd(6)} | ${hostileStr} |`,
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
