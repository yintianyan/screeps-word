import { Process, ProcessStatus } from "./Process";
import { KernelMemory } from "./types";
import { processRegistry } from "./ProcessRegistry";

export class Kernel {
  private processTable: { [pid: string]: Process } = {};
  private memory: KernelMemory;

  constructor() {
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
        } catch (e) {
          console.log(
            `[Kernel] Failed to load process ${pid} (${pMem.type}): ${e}`,
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

    const pids = this.memory.processIndex.sort((a, b) => {
      const pA = this.processTable[a];
      const pB = this.processTable[b];
      return (pB ? pB.priority : 0) - (pA ? pA.priority : 0);
    });

    for (const pid of pids) {
      if (Game.cpu.getUsed() > cpuLimit * 0.9 && bucket < 1000) {
        console.log(
          `[Kernel] CPU Throttling activated. Skipping low priority processes.`,
        );
        break;
      }

      const process = this.processTable[pid];
      if (!process) continue;

      if (process.status === ProcessStatus.Dead) {
        this.killProcess(pid);
        continue;
      }

      if (process.status === ProcessStatus.Suspended) continue;

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

      try {
        process.run();
      } catch (e: any) {
        console.log(`[Kernel] Process ${pid} crashed: ${e.stack}`);
        this.killProcess(pid);
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
  }

  public killProcess(pid: string): void {
    if (this.processTable[pid]) {
      delete this.processTable[pid];
    }
    if (this.memory.processTable[pid]) {
      delete this.memory.processTable[pid];
    }
    const index = this.memory.processIndex.indexOf(pid);
    if (index > -1) {
      this.memory.processIndex.splice(index, 1);
    }
  }

  public getProcessMemory(pid: string): any {
    return this.memory.processTable[pid]?.data || {};
  }
}
