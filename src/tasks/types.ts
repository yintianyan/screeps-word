export type TaskType =
  | "harvest"
  | "transfer"
  | "upgrade"
  | "build"
  | "repair"
  | "attack"
  | "heal"
  | "pickup"
  | "withdraw";

export interface ITask {
  id: string;
  type: TaskType;
  targetId?: string;
  priority: number;
}

export type TaskRunResult =
  | { status: "running" }
  | { status: "completed" }
  | {
      status: "failed";
      reason:
        | "pathBlocked"
        | "targetInvalid"
        | "notEnoughResources"
        | "unknown";
    };
