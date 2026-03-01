import { TaskProcess } from "./TaskProcess";
import { runRecycle } from "./impl/recycle";
import { processRegistry } from "../core/ProcessRegistry";

export class RecycleTask extends TaskProcess {
  protected isValid(): boolean {
    return !!this.creep;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const result = runRecycle(creep, this.data.targetId);

    if (result.status === "completed") {
      this.complete();
    } else if (result.status === "failed") {
      this.fail(result.reason);
    }
  }
}

processRegistry.register(RecycleTask, "RecycleTask");
