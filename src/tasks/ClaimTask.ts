import { TaskProcess } from "./TaskProcess";
import { runClaim } from "./impl/claim";
import { processRegistry } from "../core/ProcessRegistry";

export class ClaimTask extends TaskProcess {
  protected isValid(): boolean {
    const creep = this.creep;
    return !!creep && !!creep.room.controller; // Usually must be in room
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    // We assume targetId is the controller ID, which we might not see if not in room
    // So we might need to rely on moving to room first?
    // Or we just pass targetId if we have it.
    // Actually, claim task is usually for Reserver who is already in room or moving to it.
    // If we are not in room, runClaim fails?
    // Let's modify runClaim to just be smart about moving if targetId is not visible but we know pos?
    // No, standard TaskProcess logic relies on targetId.
    
    const result = runClaim(creep, this.data.targetId);
    
    if (result.status === "completed") {
        this.complete();
    } else if (result.status === "failed") {
        this.fail(result.reason);
    }
  }
}

processRegistry.register(ClaimTask, "ClaimTask");
