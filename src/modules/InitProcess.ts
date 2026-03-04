import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { OffenseProcess } from "./war/OffenseProcess";

/**
 * 初始化进程
 * 
 * 系统启动时运行的第一个进程。
 * 用于执行2一次性的初始化操作，例如挂载全局变量、检查 Memory 结构等。
 * 目前代码为空，保留作为扩展点。
 */
export class InitProcess extends Process {
  constructor(pid: string, parentPID: string, priority = 100) {
    super(pid, parentPID, priority);
  }

  public run(): void {
    const spawn = Object.values(Game.spawns)[0];
    if (!spawn) return;

    // Ensure OffenseProcess is running
    const offensePID = "OffenseManager";
    if (!this.kernel.getProcessMemory(offensePID)) {
      this.kernel.addProcess(new OffenseProcess(offensePID, this.pid, 40));
    }
  }
}

processRegistry.register(InitProcess, "InitProcess");
