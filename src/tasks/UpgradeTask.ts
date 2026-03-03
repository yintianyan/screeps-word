import { TaskProcess } from "./TaskProcess";
import { runUpgrade } from "./impl/upgrade";
import { processRegistry } from "../core/ProcessRegistry";

/**
 * 升级任务
 * 
 * 控制 Creep 升级房间控制器 (Controller)。
 */
export class UpgradeTask extends TaskProcess {
  protected isValid(): boolean {
    const creep = this.creep;
    return !!creep && creep.store.getUsedCapacity() > 0 && !!creep.room.controller?.my;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const result = runUpgrade(creep);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(UpgradeTask, "UpgradeTask");
