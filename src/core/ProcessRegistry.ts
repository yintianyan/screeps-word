import { Process } from "./Process";

type ProcessConstructor = new (
  pid: string,
  parentPID: string,
  priority?: number,
) => Process;

/**
 * 进程注册表
 * 
 * 用于维护所有 Process 类的构造函数映射。
 * Kernel 在从 Memory 恢复进程时，需要通过类名 (string) 查找对应的构造函数。
 */
class ProcessRegistry {
  private registry: { [key: string]: ProcessConstructor } = {};

  /**
   * 注册进程类
   * 
   * @param processClass 进程类的构造函数
   * @param name 进程类名 (必须唯一)
   */
  public register(processClass: ProcessConstructor, name: string): void {
    this.registry[name] = processClass;
  }

  /**
   * 获取进程类
   * 
   * @param name 进程类名
   */
  public get(name: string): ProcessConstructor | undefined {
    return this.registry[name];
  }
}

export const processRegistry = new ProcessRegistry();
