import { TaskProcess } from "./TaskProcess";
import { runWithdraw } from "./impl/withdraw";
import { processRegistry } from "../core/ProcessRegistry";

/**
 * 取物任务
 * 
 * 控制 Creep 从 Storage, Container, Tombstone 等结构取出资源。
 */
export class WithdrawTask extends TaskProcess {
  protected isValid(): boolean {
    const creep = this.creep;
    return !!creep && creep.store.getFreeCapacity() > 0;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const result = runWithdraw(creep, this.data.targetId);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(WithdrawTask, "WithdrawTask");
