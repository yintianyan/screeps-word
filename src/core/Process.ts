import type { Kernel } from "./Kernel";

export enum ProcessStatus {
  Running = 0,
  Sleeping = 1,
  Suspended = 2,
  Dead = 3,
}

export interface IProcess {
  pid: string;
  parentPID: string;
  priority: number;
  status: ProcessStatus;

  run(): void;
  sleep(ticks: number): void;
  suspend(): void;
  kill(): void;
  
  // Lifecycle hooks
  onInit?(): void;
  onExit?(): void;
}

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
