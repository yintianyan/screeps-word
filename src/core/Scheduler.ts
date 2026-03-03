import { ITask } from "../tasks/types";

/**
 * 任务调度器 (实验性)
 *
 * 目前 Kernel 已经内置了基于 Process 的调度逻辑。
 * 这个 Scheduler 类可能用于未来更细粒度的任务调度，或者作为备用调度方案。
 * 目前代码中暂时没有重度使用。
 */
export class Scheduler {
  private tasks: { [id: string]: ITask } = {};

  constructor() {}

  public addTask(task: ITask): void {
    this.tasks[task.id] = task;
  }

  public getTask(id: string): ITask | undefined {
    return this.tasks[id];
  }

  public removeTask(id: string): void {
    delete this.tasks[id];
  }

  public getTasksByPriority(): ITask[] {
    return Object.values(this.tasks).sort((a, b) => b.priority - a.priority);
  }

  public run(): void {}
}

export const scheduler = new Scheduler();
