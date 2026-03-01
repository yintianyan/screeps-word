import { TaskProcess } from "./TaskProcess";
import { runRangedAttack } from "./impl/rangedAttack";
import { processRegistry } from "../core/ProcessRegistry";

export class RangedAttackTask extends TaskProcess {
  protected isValid(): boolean {
    return !!this.creep;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const result = runRangedAttack(creep, this.data.targetId);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(RangedAttackTask, "RangedAttackTask");
