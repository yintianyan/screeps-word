import { TaskRunResult } from "../types";
import { smartMove } from "../move/smartMove";

export function runClaim(creep: Creep, targetId?: string): TaskRunResult {
  const controller = creep.room.controller;
  // If no controller or not in target room, targetId should handle it.
  // Actually, targetId for claim is usually the Controller ID.
  // But if we are in another room, we can't see the controller.
  // We assume the caller handles moving to the room OR we pass targetRoom.
  // TaskProcess usually takes targetId. If targetId is not visible, it fails?
  // No, smartMove handles targetRoom if provided in options, but here we just have targetId.
  // Standard TaskProcess assumes visibility or handles failure.
  // For Reserver, it usually moves to room first.
  
  if (!targetId) return { status: "failed", reason: "targetInvalid" };
  
  const target = Game.getObjectById(targetId as Id<StructureController>);
  if (!target) {
      // Not visible?
      // If we are not in the room of target, we fail?
      // Or we rely on creep memory to know targetRoom.
      // TaskProcess data can store targetRoom.
      // But runClaim only takes targetId.
      return { status: "failed", reason: "targetInvalid" };
  }
  
  if (!(target instanceof StructureController)) return { status: "failed", reason: "targetInvalid" };

  // Reserve
  const result = creep.reserveController(target);
  if (result === OK) return { status: "running" };
  
  if (result === ERR_NOT_IN_RANGE) {
    const moveResult = smartMove(creep, controller, { reusePath: 10, range: 1 });
    if (moveResult === ERR_NO_PATH) return { status: "running" };
    return { status: "running" };
  }
  
  if (result === ERR_INVALID_TARGET) return { status: "failed", reason: "targetInvalid" };
  
  return { status: "failed", reason: "unknown" };
}
