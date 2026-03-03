import { TaskProcess } from "./TaskProcess";
import { runTransfer } from "./impl/transfer";
import { processRegistry } from "../core/ProcessRegistry";

/**
 * 转移任务
 * 
 * 控制 Creep 将能量转移到 Spawn, Extension, Tower, Storage 等结构。
 */
export class TransferTask extends TaskProcess {
  protected isValid(): boolean {
    const creep = this.creep;
    return !!creep && creep.store.getUsedCapacity() > 0;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const resourceType =
      typeof this.data.resourceType === "string"
        ? (this.data.resourceType as ResourceConstant)
        : RESOURCE_ENERGY;
    const result = runTransfer(creep, this.data.targetId, resourceType);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(TransferTask, "TransferTask");
