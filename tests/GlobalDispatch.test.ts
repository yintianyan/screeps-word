import { GlobalDispatch } from '../src/ai/GlobalDispatch';
import { Task, TaskPriority, TaskType } from '../src/types/dispatch';

describe('GlobalDispatch', () => {
  beforeEach(() => {
    // Reset Memory
    (global as any).Memory = {
      dispatch: undefined,
      creeps: {}
    };
    (global as any).Game = {
      creeps: {},
      time: 100
    };
    (global as any).FIND_MY_CREEPS = 101;
  });

  test('should handle undefined Memory.dispatch gracefully', () => {
    const room = {
      name: 'W1N1',
      find: jest.fn().mockReturnValue([])
    } as any;

    expect(() => GlobalDispatch.run(room)).not.toThrow();
  });

  test('should initialize Memory.dispatch structure', () => {
    GlobalDispatch.init();
    expect(Memory.dispatch).toBeDefined();
    expect(Memory.dispatch.tasks).toBeDefined();
    expect(Memory.dispatch.queues).toBeDefined();
    expect(Memory.dispatch.queues[TaskPriority.MEDIUM]).toBeDefined();
  });

  test('should handle missing task in queue', () => {
    GlobalDispatch.init();
    const taskId = 'missing_task';
    Memory.dispatch.queues[TaskPriority.NORMAL].push(taskId);

    const room = {
      name: 'W1N1',
      find: jest.fn().mockReturnValue([{
        id: 'creep1',
        memory: { role: 'harvester' },
        pos: { x: 25, y: 25, roomName: 'W1N1', getRangeTo: () => 0 },
        getActiveBodyparts: () => 1,
        store: { getCapacity: () => 50 }
      }])
    } as any;

    GlobalDispatch.run(room);
    
    // Should remove missing task from queue
    expect(Memory.dispatch.queues[TaskPriority.NORMAL]).toHaveLength(0);
  });

  test('should handle task with undefined creepsAssigned', () => {
    GlobalDispatch.init();
    const task: Task = {
      id: 'task1',
      type: TaskType.HARVEST,
      priority: TaskPriority.NORMAL,
      targetId: 'source1',
      pos: { x: 25, y: 25, roomName: 'W1N1' } as RoomPosition,
      maxCreeps: 1,
      creationTime: 100
      // creepsAssigned is undefined
    } as Task;

    Memory.dispatch.tasks[task.id] = task;
    Memory.dispatch.queues[TaskPriority.NORMAL].push(task.id);

    const creep = {
      id: 'creep1',
      memory: { role: 'harvester' },
      pos: { x: 25, y: 25, roomName: 'W1N1', getRangeTo: () => 0 },
      getActiveBodyparts: () => 1,
      store: { getCapacity: () => 50 }
    } as any;

    const room = {
      name: 'W1N1',
      find: jest.fn().mockReturnValue([creep])
    } as any;

    GlobalDispatch.run(room);

    // Should initialize creepsAssigned and assign creep
    const updatedTask = Memory.dispatch.tasks[task.id];
    expect(updatedTask.creepsAssigned).toBeDefined();
    expect(updatedTask.creepsAssigned).toHaveLength(1);
    expect(updatedTask.creepsAssigned[0]).toBe('creep1');
  });
});
