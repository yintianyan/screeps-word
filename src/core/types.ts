import { ProcessStatus } from "./Process";

/**
 * 进程内存结构
 * 存储在 Memory.kernel.processTable 中
 */
export interface ProcessMemory {
  pid: string; // 进程 ID
  parentPID: string; // 父进程 ID
  type: string; // 进程类名
  priority: number; // 优先级
  status: ProcessStatus; // 当前状态
  sleepInfo?: {
    // 休眠信息
    start: number; // 开始休眠的 tick
    duration: number; // 休眠时长
  };
  data: Record<string, unknown>; // 进程自定义数据
}

/**
 * 内核内存结构
 * 存储在 Memory.kernel 中
 */
export interface KernelMemory {
  processTable: { [pid: string]: ProcessMemory }; // 所有进程的内存数据
  processIndex: string[]; // 进程 ID 索引列表
}
