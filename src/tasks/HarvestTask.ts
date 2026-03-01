import { TaskProcess } from "./TaskProcess";
import { runHarvest } from "./impl/harvest";
import { processRegistry } from "../core/ProcessRegistry";

export class HarvestTask extends TaskProcess {
  protected isValid(): boolean {
    const creep = this.creep;
    return !!creep && creep.store.getFreeCapacity() > 0;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const result = runHarvest(creep, this.data.targetId);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(HarvestTask, "HarvestTask");
