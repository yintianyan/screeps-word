import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { Cache } from "../core/Cache";
import { Debug } from "../core/Debug";

/**
 * 任务数据接口
 * 存储在 ProcessMemory.data 中
 */
export interface TaskData {
  creepName: string; // 执行任务的 Creep 名称
  targetId?: string; // 目标对象 ID
  [key: string]: unknown;
}

/**
 * 任务进程基类
 * 
 * 所有具体任务 (HarvestTask, UpgradeTask 等) 都继承此类。
 * 封装了 Creep 的获取、任务有效性检查、完成和失败处理。
 */
export abstract class TaskProcess extends Process {
  // 获取类型安全的任务数据
  public get data(): TaskData {
    return this.kernel.getProcessMemory(this.pid) as unknown as TaskData;
  }

  // 获取执行任务的 Creep 实例
  public get creep(): Creep | undefined {
    return Game.creeps[this.data.creepName];
  }

  /**
   * 任务主循环
   * 
   * 1. 检查 Creep 是否存在。
   * 2. 检查任务是否被篡改 (Orphaned Check)。
   * 3. 同步 targetId 到 Creep 内存。
   * 4. 检查任务有效性 (isValid)。
   * 5. 执行具体逻辑 (execute)。
   */
  public run(): void {
    const creep = this.creep;
    if (!creep) {
      this.kill();
      return;
    }

    if (creep.memory.taskId && creep.memory.taskId !== this.pid) {
      const mem = creep.memory as unknown as Record<string, unknown>;
      Debug.event(
        "task_orphaned",
        {
          taskPid: this.pid,
          taskType: this.kernel.getProcessType(this.pid),
          currentTaskId: creep.memory.taskId,
          currentTaskType:
            typeof creep.memory.taskId === "string"
              ? this.kernel.getProcessType(creep.memory.taskId)
              : undefined,
          ttl: creep.ticksToLive ?? null,
          role: String(mem.role ?? ""),
          homeRoom: typeof mem.homeRoom === "string" ? mem.homeRoom : "",
          retire: mem.retire === true,
          storeUsed: creep.store.getUsedCapacity(),
        },
        { creep: creep.name, room: creep.room.name, pid: this.pid },
      );
      this.kill();
      return;
    }

    const targetId = this.data.targetId;
    if (typeof targetId === "string" && targetId.length > 0) {
      creep.memory.targetId = targetId;
    } else {
      delete creep.memory.targetId;
    }
    
    // Check if task is still valid
    if (!this.isValid()) {
        this.complete();
        return;
    }

    this.execute();
  }

  // 抽象方法：检查任务是否有效
  protected abstract isValid(): boolean;
  // 抽象方法：执行任务逻辑
  protected abstract execute(): void;

  /**
   * 任务完成
   * 清理 Creep 内存中的任务信息，并终止进程。
   */
  protected complete(): void {
    const creep = this.creep;
    if (creep) {
        delete creep.memory.taskId;
        delete creep.memory.targetId;
    }
    this.kill();
  }
  
  /**
   * 任务失败
   * 记录失败原因，触发 task_failed 事件，并终止进程。
   * 
   * @param reason 失败原因
   */
  protected fail(reason: string): void {
      const creep = this.creep;
      if (creep) {
        Debug.event(
          "task_failed",
          {
            taskPid: this.pid,
            taskType: this.kernel.getProcessType(this.pid),
            reason,
            targetId: (creep.memory as any).targetId,
          },
          { creep: creep.name, room: creep.room.name, pid: this.pid },
        );
      }
      Cache.getTick(`taskFail:${reason}`, () => {
        console.log(`[Task] ${this.pid} failed: ${reason}`);
        return true;
      });
      this.complete();
  }
}
