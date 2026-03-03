import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { config } from "../config";

interface SpawnJobData {
  roomName: string;
  body: BodyPartConstant[];
  role: string;
  memory: Record<string, unknown>;
  spawnName: string;
}

/**
 * 孵化任务 (SpawnJob)
 * 
 * 代表一个具体的 Creep 孵化请求。
 * 这是一个短生命周期的进程，任务完成后即销毁。
 * 
 * 功能：
 * 1. 等待 Spawn 空闲。
 * 2. 检查房间能量是否足够。
 * 3. 调用 spawnCreep 执行孵化。
 * 4. 处理超时和错误。
 */
export class SpawnJob extends Process {
  public get data(): SpawnJobData {
    return this.kernel.getProcessMemory(this.pid) as unknown as SpawnJobData;
  }

  public run(): void {
    const { roomName, body, role, memory, spawnName } = this.data;
    const room = Game.rooms[roomName];

    if (!room) {
      console.log(`[SpawnJob] Room ${roomName} not visible, killing job ${this.pid}`);
      this.kill();
      return;
    }

    const jobMem = this.kernel.getProcessMemory(this.pid) as unknown as {
      createdAt?: number;
    };
    if (!jobMem.createdAt) {
      jobMem.createdAt = Game.time;
    }

    const timeout = config.SPAWN.JOB_TIMEOUT;
    if (Game.time - (jobMem.createdAt || Game.time) > timeout) {
      console.log(
        `[SpawnJob] Job ${this.pid} (${role}) timed out after ${timeout} ticks. Killing.`,
      );
      this.kill();
      return;
    }

    if (Game.creeps[spawnName]) {
      this.kill();
      return;
    }

    const spawns = room.find(FIND_MY_SPAWNS);
    const freeSpawns = spawns.filter((s) => !s.spawning);
    if (freeSpawns.length === 0) {
      this.sleep(config.SPAWN.JOB_SLEEP);
      return;
    }

    const spawn = freeSpawns[0];
    const cost = this.bodyCost(body);

    // If room is in recovery mode (very low energy), we should try to spawn ANY helper if possible
    // But SpawnJob is generic, so logic should be in SpawnerProcess.
    // Here we just check if we can afford the requested body.
    if (room.energyAvailable < cost) {
       // Wait for energy
      this.sleep(config.SPAWN.JOB_SLEEP);
      return;
    }

    const result = spawn.spawnCreep(body, spawnName, {
      memory: { ...memory, role, room: roomName, working: false },
    });

    if (result === OK) {
      console.log(`[SpawnJob] Spawning ${spawnName} (${role}) in ${roomName}`);
      this.kill();
      return;
    }

    if (result === ERR_NAME_EXISTS) {
      // Maybe previous tick succeeded but we didn't catch it? Or random collision.
      // If creep exists, we are done.
      if (Game.creeps[spawnName]) {
          this.kill();
          return;
      }
      // If name exists but not in Game.creeps (e.g. spawning), also done.
      // Actually ERR_NAME_EXISTS usually means there is a creep with that name.
      this.kill();
      return;
    }
    
    // If busy, just wait
    if (result === ERR_BUSY) {
      this.sleep(config.SPAWN.JOB_SLEEP);
      return;
    }

    if (result === ERR_NOT_ENOUGH_ENERGY) {
       // Should be caught by check above, but double check
      this.sleep(config.SPAWN.JOB_SLEEP);
      return;
    }

    console.log(`[SpawnJob] Error spawning ${spawnName}: ${result}`);
    // For other errors (invalid args, etc), kill to avoid infinite loop
    this.kill();
  }

  private bodyCost(body: BodyPartConstant[]): number {
    let cost = 0;
    for (const part of body) cost += BODYPART_COST[part];
    return cost;
  }
}

processRegistry.register(SpawnJob, "SpawnJob");
