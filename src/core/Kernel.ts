import { Process, ProcessStatus } from "./Process";
import { KernelMemory } from "./types";
import { processRegistry } from "./ProcessRegistry";
import { config } from "../config";
import { Debug } from "./Debug";

/**
 * 内核 (Kernel)
 * 
 * 系统的核心调度器，负责管理所有进程 (Process) 的生命周期。
 * 
 * 主要职责：
 * 1. 进程管理：创建、销毁、暂停、恢复进程。
 * 2. 调度执行：根据优先级调度进程运行。
 * 3. 内存管理：持久化进程状态到 Memory.kernel。
 * 4. CPU 保护：监控 CPU 使用率，防止 Bucket 耗尽 (Throttling)。
 * 5. 垃圾回收：定期清理僵死进程和超时任务。
 */
export class Kernel {
  // 进程表：存储所有活跃的 Process 实例
  private processTable: { [pid: string]: Process } = {};
  // 内核内存：引用全局 Memory.kernel
  private memory: KernelMemory;
  // 调度缓存相关
  private sortedTick = -1;
  private sortedLen = 0;
  private sortedPids: string[] = [];

  private syncMemory(): void {
    if (!Memory.kernel) {
      Memory.kernel = {
        processTable: {},
        processIndex: [],
      };
    }
    this.memory = Memory.kernel;
  }

  /**
   * 获取按优先级排序的 PID 列表
   * 
   * 包含缓存机制，同一 tick 内多次调用直接返回缓存结果。
   * 每 5 tick 强制重排序一次，确保优先级变更能及时生效。
   */
  private getScheduledPids(): string[] {
    this.syncMemory();
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

  /**
   * 批量终止进程
   * 
   * 递归终止指定 PID 及其所有子进程。
   * 
   * @param pids 要终止的进程 ID 列表
   */
  private killMany(pids: string[]): void {
    this.syncMemory();
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

  /**
   * 系统维护
   * 
   * 每 10 tick 运行一次。
   * 功能：
   * 1. 清理 Memory 中存在但实例不存在的僵死进程。
   * 2. 清理状态为 Dead 的进程。
   * 3. 清理超时的 SpawnJob (孵化任务)。
   * 4. 优化 SpawnJob：如果同一房间同一角色有多个孵化任务，保留优先级最高的。
   * 5. 打印进程统计信息 (每 100 tick)。
   */
  private maintenance(): void {
    this.syncMemory();
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

  /**
   * 初始化内核
   * 
   * 1. 挂载全局 global.kernel。
   * 2. 初始化 Memory.kernel 结构。
   * 3. 从 Memory 加载所有进程实例。
   */
  constructor() {
    global.kernel = this;
    this.syncMemory();
    this.loadProcesses();
  }

  /**
   * 从内存加载进程
   * 
   * 遍历 Memory.kernel.processIndex，实例化所有进程。
   * 如果进程类未在 ProcessRegistry 中注册，或者加载失败，则杀死该进程。
   */
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

  /**
   * 运行内核主循环
   * 
   * 1. 执行维护任务 (Maintenance)。
   * 2. 计算 CPU 限制和最低运行优先级 (根据 Bucket 状态)。
   * 3. 获取调度列表并遍历执行进程：
   *    - 检查 CPU 是否超限 (Throttling)。
   *    - 跳过 Dead/Suspended 进程。
   *    - 处理 Sleeping 进程的唤醒逻辑。
   *    - 执行 Process.run()。
   *    - 捕获并记录进程崩溃错误。
   * 4. 采样并记录 CPU 消耗最高的进程类型 (Kernel Profiler)。
   * 5. 刷新 Debug 指标。
   */
  public run(): void {
    this.syncMemory();
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
    Debug.gauge("kernel.processes", this.memory.processIndex.length);
    Debug.gauge("kernel.scheduled", pids.length);
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
        if (!pMem) {
          this.killProcess(pid);
          continue;
        }
        if (
          pMem.sleepInfo &&
          Game.time >= pMem.sleepInfo.start + pMem.sleepInfo.duration
        ) {
          process.status = ProcessStatus.Running;
          pMem.status = ProcessStatus.Running;
          delete pMem.sleepInfo;
        } else if (!pMem.sleepInfo) {
          process.status = ProcessStatus.Running;
          pMem.status = ProcessStatus.Running;
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
        Debug.setKernelTop(top);
        Debug.event("kernel_prof", top);
      }
    }
    Debug.flushTick();
  }

  /**
   * 添加新进程
   * 
   * @param process 新创建的进程实例
   */
  public addProcess(process: Process): void {
    this.syncMemory();
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
    this.syncMemory();
    const p = this.memory.processTable[pid];
    if (!p) return {};
    if (!p.data) p.data = {};
    return p.data;
  }

  public getProcessType(pid: string): string | undefined {
    this.syncMemory();
    return this.memory.processTable[pid]?.type;
  }

  public getChildren(pid: string): string[] {
    this.syncMemory();
    return this.memory.processIndex.filter(childPid => {
        const childMem = this.memory.processTable[childPid];
        return childMem && childMem.parentPID === pid;
    });
  }
}
