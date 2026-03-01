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
    if (Game.time - jobMem.createdAt > timeout) {
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

    const spawns = room.find(FIND_MY_SPAWNS).filter((s) => !s.spawning);
    if (spawns.length === 0) {
      this.sleep(config.SPAWN.JOB_SLEEP);
      return;
    }

    const spawn = spawns[0];
    const cost = this.bodyCost(body);

    if (room.energyAvailable < cost) {
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
      this.kill();
      return;
    }

    if (result === ERR_NOT_ENOUGH_ENERGY || result === ERR_BUSY) {
      this.sleep(config.SPAWN.JOB_SLEEP);
      return;
    }

    console.log(`[SpawnJob] Error spawning ${spawnName}: ${result}`);
  }

  private bodyCost(body: BodyPartConstant[]): number {
    let cost = 0;
    for (const part of body) cost += BODYPART_COST[part];
    return cost;
  }
}

processRegistry.register(SpawnJob, "SpawnJob");
