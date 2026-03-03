import type { Kernel } from "./Kernel";

/**
 * 进程状态枚举
 */
export enum ProcessStatus {
  Running = 0,   // 运行中
  Sleeping = 1,  // 休眠中 (等待一段时间)
  Suspended = 2, // 挂起 (暂停执行，直到被显式唤醒)
  Dead = 3,      // 已死亡 (等待回收)
}

/**
 * 进程接口定义
 */
export interface IProcess {
  pid: string;          // 进程 ID
  parentPID: string;    // 父进程 ID
  priority: number;     // 优先级 (越高越优先)
  status: ProcessStatus;// 当前状态

  run(): void;          // 主运行逻辑
  sleep(ticks: number): void; // 休眠指定 tick 数
  suspend(): void;      // 挂起进程
  kill(): void;         // 杀死进程
  
  // 生命周期钩子
  onInit?(): void;      // 初始化时调用
  onExit?(): void;      // 退出/被杀时调用
}

/**
 * 进程基类
 * 
 * 所有业务逻辑进程都应继承此类。
 */
export abstract class Process implements IProcess {
  pid: string;
  parentPID: string;
  priority: number;
  status: ProcessStatus;

  constructor(pid: string, parentPID: string, priority = 50) {
    this.pid = pid;
    this.parentPID = parentPID;
    this.priority = priority;
    this.status = ProcessStatus.Running;
  }

  abstract run(): void;

  protected get kernel(): Kernel {
    return global.kernel;
  }

  sleep(ticks: number): void {
    this.status = ProcessStatus.Sleeping;
    // Note: Kernel needs to handle the actual sleep timer logic
    // We can access kernel now to register sleep if needed, but Kernel.run handles it via memory
    if (this.kernel) {
       // We could do this.kernel.sleepProcess(this.pid, ticks) if we had that method
       // But currently Kernel checks memory directly.
       // We need to update memory for sleep to work properly in Kernel.run()
       const kMem = Memory.kernel.processTable[this.pid];
       if (kMem) {
           kMem.status = ProcessStatus.Sleeping;
           kMem.sleepInfo = { start: Game.time, duration: ticks };
       }
    }
  }

  suspend(): void {
    this.status = ProcessStatus.Suspended;
  }

  kill(): void {
    this.status = ProcessStatus.Dead;
  }

  // Optional hooks for subclasses to override
  onInit(): void {}
  onExit(): void {}
}
