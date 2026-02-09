import { describe, expect, test, beforeEach } from "@jest/globals";
import { GlobalDispatch } from "../src/ai/GlobalDispatch";
import { TaskPriority } from "../src/types/dispatch";

// Mock Memory and Game
(global as any).Memory = {};
(global as any).Game = { time: 0, creeps: {} };

describe("GlobalDispatch", () => {
  beforeEach(() => {
    (global as any).Memory = { dispatch: undefined };
  });

  test("init should create memory structure if missing", () => {
    GlobalDispatch.init();
    expect((global as any).Memory.dispatch).toBeDefined();
    expect(
      (global as any).Memory.dispatch.queues[TaskPriority.MEDIUM],
    ).toBeDefined();
  });

  test("init should patch missing queues (migration)", () => {
    // Setup old memory without MEDIUM
    (global as any).Memory.dispatch = {
      tasks: {},
      assignments: {},
      queues: {
        [TaskPriority.CRITICAL]: [],
        [TaskPriority.HIGH]: [],
        // MEDIUM missing
        [TaskPriority.NORMAL]: [],
        [TaskPriority.LOW]: [],
        [TaskPriority.IDLE]: [],
      },
      spawnQueue: [],
    };

    GlobalDispatch.init();

    expect(
      (global as any).Memory.dispatch.queues[TaskPriority.MEDIUM],
    ).toBeDefined();
    expect(
      Array.isArray(
        (global as any).Memory.dispatch.queues[TaskPriority.MEDIUM],
      ),
    ).toBe(true);
  });
});
