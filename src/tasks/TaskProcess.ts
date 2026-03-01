import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { Cache } from "../core/Cache";

export interface TaskData {
  creepName: string;
  targetId?: string;
  [key: string]: unknown;
}

export abstract class TaskProcess extends Process {
  public get data(): TaskData {
    return this.kernel.getProcessMemory(this.pid) as unknown as TaskData;
  }

  public get creep(): Creep | undefined {
    return Game.creeps[this.data.creepName];
  }

  public run(): void {
    const creep = this.creep;
    if (!creep) {
      this.kill();
      return;
    }

    // Auto-terminate if creep has been reassigned to a different task
    if (creep.memory.taskId && creep.memory.taskId !== this.pid) {
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

  protected abstract isValid(): boolean;
  protected abstract execute(): void;

  protected complete(): void {
    const creep = this.creep;
    if (creep) {
        delete creep.memory.taskId;
        delete creep.memory.targetId;
    }
    this.kill();
  }
  
  protected fail(reason: string): void {
      Cache.getTick(`taskFail:${reason}`, () => {
        console.log(`[Task] ${this.pid} failed: ${reason}`);
        return true;
      });
      this.complete();
  }
}
