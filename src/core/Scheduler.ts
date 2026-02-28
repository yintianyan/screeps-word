import { ITask } from "../tasks/types";

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
