import { TaskPriority } from "../types/dispatch";

const taskCleanup = {
  run: function () {
    if (!Memory.dispatch) return;

    console.log(
      `[Cleanup] Starting cleanup. Tasks: ${Object.keys(Memory.dispatch.tasks || {}).length}`,
    );

    // 1. Reset Tasks
    Memory.dispatch.tasks = {};
    Memory.dispatch.assignments = {};

    // 2. Reset Queues
    Memory.dispatch.queues = {
      [TaskPriority.CRITICAL]: [],
      [TaskPriority.HIGH]: [],
      [TaskPriority.MEDIUM]: [],
      [TaskPriority.NORMAL]: [],
      [TaskPriority.LOW]: [],
      [TaskPriority.IDLE]: [],
    };

    console.log(
      `[Cleanup] Complete. Tasks: ${Object.keys(Memory.dispatch.tasks).length}`,
    );
  },
};

export default taskCleanup;
