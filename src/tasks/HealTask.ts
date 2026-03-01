import { TaskProcess } from "./TaskProcess";
import { runHeal } from "./impl/heal";
import { processRegistry } from "../core/ProcessRegistry";

export class HealTask extends TaskProcess {
  protected isValid(): boolean {
    const creep = this.creep;
    return !!creep && creep.getActiveBodyparts(HEAL) > 0;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const result = runHeal(creep, this.data.targetId);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(HealTask, "HealTask");
