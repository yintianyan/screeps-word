import { Process, ProcessStatus } from "./Process";
import { KernelMemory } from "./types";
import { processRegistry } from "./ProcessRegistry";
import { config } from "../config";

export class Kernel {
  private processTable: { [pid: string]: Process } = {};
  private memory: KernelMemory;
  private sortedTick = -1;
  private sortedLen = 0;
  private sortedPids: string[] = [];

  private getScheduledPids(): string[] {
    const len = this.memory.processIndex.length;
    if (
      this.sortedTick !== Game.time &&
      (this.sortedTick === -1 || len !== this.sortedLen || Game.time % 5 === 0)
    ) {
      const pids = [...this.memory.processIndex];
      pids.sort((a, b) => {
        const pA = this.processTable[a];
        const pB = this.processTable[b];
        return (pB ? pB.priority : 0) - (pA ? pA.priority : 0);
      });
      this.sortedPids = pids;
      this.sortedTick = Game.time;
      this.sortedLen = len;
    }
    return this.sortedPids;
  }

  private killMany(pids: string[]): void {
    if (pids.length === 0) return;

    const childrenByParent: Record<string, string[]> = {};
    for (const pid of this.memory.processIndex) {
      const pMem = this.memory.processTable[pid];
      if (!pMem) continue;
      const parent = pMem.parentPID;
      if (!childrenByParent[parent]) childrenByParent[parent] = [];
      childrenByParent[parent].push(pid);
    }

    const killSet = new Set<string>();
    const stack = [...pids];
    for (const pid of pids) killSet.add(pid);

    while (stack.length > 0) {
      const pid = stack.pop();
      if (!pid) continue;
      const kids = childrenByParent[pid];
      if (!kids) continue;
      for (const childPid of kids) {
        if (killSet.has(childPid)) continue;
        killSet.add(childPid);
        stack.push(childPid);
      }
    }

    for (const pid of killSet) {
      const process = this.processTable[pid];
      if (process) {
        try {
          process.onExit?.();
        } catch (e: unknown) {
          console.log(`[Kernel] Error in onExit for ${pid}: ${String(e)}`);
        }
        delete this.processTable[pid];
      }
      if (this.memory.processTable[pid]) {
        delete this.memory.processTable[pid];
      }
    }

    this.memory.processIndex = this.memory.processIndex.filter(
      (pid) => !killSet.has(pid),
    );
    this.sortedTick = -1;
  }

  private maintenance(): void {
    if (Game.time % 10 !== 0) return;

    const now = Game.time;
    const timeout = config.SPAWN.JOB_TIMEOUT;
    const pids = this.memory.processIndex;
    const toKill: string[] = [];
    const bestSpawnJobByKey = new Map<
      string,
      { pid: string; priority: number; createdAt: number }
    >();

    for (const pid of pids) {
      const pMem = this.memory.processTable[pid];
      if (!pMem) {
        toKill.push(pid);
        continue;
      }

      if (pMem.status === ProcessStatus.Dead) {
        toKill.push(pid);
        continue;
      }

      if (pMem.type !== "SpawnJob") continue;

      const data = pMem.data as Record<string, unknown> | undefined;
      if (!data) continue;

      const createdAt = typeof data.createdAt === "number" ? data.createdAt : now;
      if (typeof data.createdAt !== "number") data.createdAt = createdAt;

      if (now - createdAt > timeout) {
        toKill.push(pid);
        continue;
      }

      const roomName = typeof data.roomName === "string" ? data.roomName : "";
      const role = typeof data.role === "string" ? data.role : "";
      if (!roomName || !role) continue;

      const key = `${roomName}|${role}`;
      const prev = bestSpawnJobByKey.get(key);
      if (!prev) {
        bestSpawnJobByKey.set(key, { pid, priority: pMem.priority, createdAt });
        continue;
      }

      const currentBetter =
        pMem.priority > prev.priority ||
        (pMem.priority === prev.priority && createdAt > prev.createdAt);

      if (currentBetter) {
        toKill.push(prev.pid);
        bestSpawnJobByKey.set(key, { pid, priority: pMem.priority, createdAt });
      } else {
        toKill.push(pid);
      }
    }

    this.killMany(toKill);

    if (Game.time % 100 === 0) {
      const total = this.memory.processIndex.length;
      if (total > 300) {
        const byType: Record<string, number> = {};
        for (const pid of this.memory.processIndex) {
          const t = this.memory.processTable[pid]?.type ?? "unknown";
          byType[t] = (byType[t] ?? 0) + 1;
        }
        const top = Object.entries(byType)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8);
        console.log(`[KernelGC] processes=${total} top=${JSON.stringify(top)}`);
      }
    }
  }

  constructor() {
    global.kernel = this;
    if (!Memory.kernel) {
      Memory.kernel = {
        processTable: {},
        processIndex: [],
      };
    }
    this.memory = Memory.kernel;
    this.loadProcesses();
  }

  private loadProcesses(): void {
    for (const pid of this.memory.processIndex) {
      const pMem = this.memory.processTable[pid];
      if (!pMem) {
        const index = this.memory.processIndex.indexOf(pid);
        if (index > -1) this.memory.processIndex.splice(index, 1);
        continue;
      }

      const ProcessClass = processRegistry.get(pMem.type);
      if (ProcessClass) {
        try {
          const process = new ProcessClass(
            pMem.pid,
            pMem.parentPID,
            pMem.priority,
          );
          process.status = pMem.status;
          this.processTable[pid] = process;
        } catch (e: unknown) {
          const msg =
            e instanceof Error ? e.stack ?? e.message : `NonError: ${String(e)}`;
          console.log(
            `[Kernel] Failed to load process ${pid} (${pMem.type}): ${msg}`,
          );
          this.killProcess(pid);
        }
      } else {
        console.log(
          `[Kernel] Process type ${pMem.type} not found for pid ${pid}`,
        );
        this.killProcess(pid);
      }
    }
  }

  public run(): void {
    const cpuLimit = Game.cpu.limit;
    const bucket = Game.cpu.bucket;

    this.maintenance();

    const throttled = bucket < config.CPU.BUCKET_LIMIT;
    const critical = bucket < config.CPU.CRITICAL_BUCKET;
    const minPriority = critical
      ? config.CPU.CRITICAL_MIN_PRIORITY
      : throttled
        ? config.CPU.THROTTLE_MIN_PRIORITY
        : -Infinity;

    const pids = this.getScheduledPids();
    const sample =
      bucket < config.CPU.BUCKET_LIMIT && Game.time % 10 === 0;
    const byType = sample ? ({} as Record<string, number>) : null;

    for (const pid of pids) {
      if (
        Game.cpu.getUsed() > cpuLimit * 0.9 &&
        bucket < config.CPU.BUCKET_LIMIT &&
        Game.time % config.CPU.THROTTLE_LOG_INTERVAL === 0
      ) {
        console.log(`[Kernel] CPU throttling`);
        break;
      }

      const process = this.processTable[pid];
      if (!process) continue;

      if (process.status === ProcessStatus.Dead) {
        this.killProcess(pid);
        continue;
      }

      if (process.status === ProcessStatus.Sleeping) {
        const pMem = this.memory.processTable[pid];
        if (
          pMem.sleepInfo &&
          Game.time >= pMem.sleepInfo.start + pMem.sleepInfo.duration
        ) {
          process.status = ProcessStatus.Running;
          pMem.status = ProcessStatus.Running;
          delete pMem.sleepInfo;
        } else {
          continue;
        }
      }

      if (process.status === ProcessStatus.Suspended) continue;

      if (process.priority < minPriority && process.constructor.name !== "SpawnJob")
        continue;

      try {
        const before = sample ? Game.cpu.getUsed() : 0;
        process.run();
        if (sample && byType) {
          const after = Game.cpu.getUsed();
          const t = process.constructor.name;
          byType[t] = (byType[t] ?? 0) + (after - before);
        }
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.stack ?? e.message : `NonError: ${String(e)}`;
        console.log(`[Kernel] Process ${pid} crashed: ${msg}`);
        this.killProcess(pid);
      }
    }

    if (sample && byType) {
      const top = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);
      if (top.length > 0) {
        console.log(`[KernelProf] top=${JSON.stringify(top)}`);
      }
    }
  }

  public addProcess(process: Process): void {
    const pid = process.pid;
    if (this.processTable[pid]) {
      console.log(`[Kernel] Process ${pid} already exists!`);
      return;
    }

    this.processTable[pid] = process;
    this.memory.processTable[pid] = {
      pid: process.pid,
      parentPID: process.parentPID,
      type: process.constructor.name,
      priority: process.priority,
      status: process.status,
      data: {},
    };
    this.memory.processIndex.push(pid);
    
    // Trigger onInit hook
    try {
        process.onInit?.();
    } catch (e: unknown) {
        console.log(`[Kernel] Error in onInit for ${pid}: ${String(e)}`);
    }
  }

  public killProcess(pid: string): void {
    this.killMany([pid]);
  }

  public getProcessMemory(pid: string): Record<string, unknown> {
    const p = this.memory.processTable[pid];
    if (!p) return {};
    if (!p.data) p.data = {};
    return p.data;
  }

  public getProcessType(pid: string): string | undefined {
    return this.memory.processTable[pid]?.type;
  }

  public getChildren(pid: string): string[] {
    return this.memory.processIndex.filter(childPid => {
        const childMem = this.memory.processTable[childPid];
        return childMem && childMem.parentPID === pid;
    });
  }
}
