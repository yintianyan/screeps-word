import { describe, expect, test, jest } from "@jest/globals";
import Role from "../src/ai/role";
import { TaskPriority, TaskType } from "../src/types/dispatch";

describe("Role HARVEST dump", () => {
  test("should transfer to link when container is near full", () => {
    (global as any).OK = 0;
    (global as any).ERR_NOT_IN_RANGE = -9;
    (global as any).ERR_FULL = -8;
    (global as any).FIND_STRUCTURES = 107;
    (global as any).STRUCTURE_LINK = "link";
    (global as any).STRUCTURE_CONTAINER = "container";
    (global as any).RESOURCE_ENERGY = "energy";

    (global as any).Source = class {};
    (global as any).Mineral = class {};
    (global as any).Structure = class {};

    const link = {
      id: "l1",
      structureType: "link",
      store: {
        getFreeCapacity: () => 800,
      },
      pos: {},
    } as any;

    const container = {
      id: "c1",
      structureType: "container",
      store: {
        getFreeCapacity: () => 0,
      },
      pos: {},
    } as any;

    const sourcePos = {
      findInRange: jest.fn((findType: any, range: number, opts: any) => {
        if (findType !== (global as any).FIND_STRUCTURES) return [];
        if (range === 2) {
          return opts.filter(link) ? [link] : [];
        }
        if (range === 1) {
          return opts.filter(container) ? [container] : [];
        }
        return [];
      }),
    };

    const source: any = Object.assign(new (global as any).Source(), {
      id: "s1",
      pos: sourcePos,
    });

    (global as any).Game = {
      getObjectById: (id: string) => (id === "s1" ? source : null),
    };

    const creep = {
      id: "cr1",
      name: "Harvester1",
      spawning: false,
      memory: { role: "harvester" },
      store: {
        getFreeCapacity: () => 0,
        getUsedCapacity: () => 50,
      },
      pos: {
        inRangeTo: () => true,
        getRangeTo: () => 1,
      },
      harvest: jest.fn(() => (global as any).ERR_FULL),
      transfer: jest.fn(() => (global as any).OK),
      drop: jest.fn(),
      say: jest.fn(),
    } as any;

    const moveSpy = jest.fn();
    (jest.spyOn(Role.prototype as any, "move") as any).mockImplementation(
      moveSpy,
    );

    const role = new Role(creep);
    role.runTask({
      id: "t1",
      type: TaskType.HARVEST,
      priority: TaskPriority.NORMAL,
      targetId: "s1",
      pos: sourcePos as any,
      creepsAssigned: [],
      maxCreeps: 1,
      creationTime: 0,
    } as any);

    expect(creep.transfer).toHaveBeenCalledWith(link, "energy");
  });
});

