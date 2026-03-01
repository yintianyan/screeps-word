import { TaskProcess } from "./TaskProcess";
import { runTransfer } from "./impl/transfer";
import { processRegistry } from "../core/ProcessRegistry";

export class TransferTask extends TaskProcess {
  protected isValid(): boolean {
    const creep = this.creep;
    return !!creep && creep.store.getUsedCapacity() > 0;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const result = runTransfer(creep, this.data.targetId);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(TransferTask, "TransferTask");
