import { TaskProcess } from "./TaskProcess";
import { runPickup } from "./impl/pickup";
import { processRegistry } from "../core/ProcessRegistry";

export class PickupTask extends TaskProcess {
  protected isValid(): boolean {
    const creep = this.creep;
    return !!creep && creep.store.getFreeCapacity() > 0;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const result = runPickup(creep, this.data.targetId);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(PickupTask, "PickupTask");
