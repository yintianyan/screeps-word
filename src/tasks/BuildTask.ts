import { TaskProcess } from "./TaskProcess";
import { runBuild } from "./impl/build";
import { processRegistry } from "../core/ProcessRegistry";

export class BuildTask extends TaskProcess {
  protected isValid(): boolean {
    const creep = this.creep;
    return !!creep && creep.store.getUsedCapacity() > 0;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const result = runBuild(creep, this.data.targetId);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(BuildTask, "BuildTask");
