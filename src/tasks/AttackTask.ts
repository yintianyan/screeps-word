import { TaskProcess } from "./TaskProcess";
import { runAttack } from "./impl/attack";
import { processRegistry } from "../core/ProcessRegistry";

export class AttackTask extends TaskProcess {
  protected isValid(): boolean {
    return !!this.creep;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const result = runAttack(creep, this.data.targetId);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(AttackTask, "AttackTask");
