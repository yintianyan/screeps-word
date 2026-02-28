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

  sleep(_ticks: number): void {
    this.status = ProcessStatus.Sleeping;
  }

  suspend(): void {
    this.status = ProcessStatus.Suspended;
  }

  kill(): void {
    this.status = ProcessStatus.Dead;
  }
}
