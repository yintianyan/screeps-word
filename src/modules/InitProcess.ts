import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";

export class InitProcess extends Process {
  constructor(pid: string, parentPID: string, priority = 100) {
    super(pid, parentPID, priority);
  }

  public run(): void {
    const spawn = Object.values(Game.spawns)[0];
    if (!spawn) return;
  }
}

processRegistry.register(InitProcess, "InitProcess");
