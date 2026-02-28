import { ProcessStatus } from "./Process";

export interface ProcessMemory {
  pid: string;
  parentPID: string;
  type: string;
  priority: number;
  status: ProcessStatus;
  sleepInfo?: {
    start: number;
    duration: number;
  };
  data: any;
}

export interface KernelMemory {
  processTable: { [pid: string]: ProcessMemory };
  processIndex: string[];
}
