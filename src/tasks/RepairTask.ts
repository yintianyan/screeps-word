import { TaskProcess } from "./TaskProcess";
import { runRepair } from "./impl/repair";
import { processRegistry } from "../core/ProcessRegistry";

export class RepairTask extends TaskProcess {
  protected isValid(): boolean {
    const creep = this.creep;
    return !!creep && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const result = runRepair(creep, this.data.targetId);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(RepairTask, "RepairTask");
