import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { smartMove } from "../tasks/move/smartMove";
import { config } from "../config";
import { getRouteRooms } from "../core/RoutePlanner";

// 定义 RoomIntel 数据访问器
export class RoomIntel {
  static get(roomName: string): RoomIntelData | undefined {
    return Memory.intel?.rooms[roomName];
  }

  static set(roomName: string, data: RoomIntelData) {
    if (!Memory.intel) Memory.intel = { rooms: {}, requests: [] };
    Memory.intel.rooms[roomName] = data;
  }

  static requestScout(roomName: string) {
    if (!Memory.intel) Memory.intel = { rooms: {}, requests: [] };
    if (!Memory.intel.requests.includes(roomName) && !Memory.intel.rooms[roomName]) {
      Memory.intel.requests.push(roomName);
    }
  }

  static getRequests(): string[] {
    return Memory.intel?.requests || [];
  }

  static clearRequest(roomName: string) {
    if (!Memory.intel) return;
    const idx = Memory.intel.requests.indexOf(roomName);
    if (idx >= 0) Memory.intel.requests.splice(idx, 1);
  }

  // 扫描房间并更新 Intel
  static scan(room: Room) {
    const data: RoomIntelData = {
      updatedAt: Game.time,
      owner: room.controller?.owner?.username,
      rcl: room.controller?.level,
      hostiles: room.find(FIND_HOSTILE_CREEPS).length,
      towers: room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).length,
      invaderCore: room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_INVADER_CORE }).length > 0,
      sources: room.find(FIND_SOURCES).map(s => ({ x: s.pos.x, y: s.pos.y, id: s.id })),
      mineral: room.find(FIND_MINERALS).map(m => ({ x: m.pos.x, y: m.pos.y, type: m.mineralType, id: m.id }))[0],
      exits: Game.map.describeExits(room.name),
      sk: isSourceKeeperRoom(room.name),
      center: isCenterRoom(room.name)
    };
    
    // 如果是无主房且无敌对，尝试标记为安全
    // (这里可以扩展更多逻辑，比如记录资源丰富度)
    
    this.set(room.name, data);
    this.clearRequest(room.name);
  }

  // 新增：通过 Observer 扫描
  static scanWithObserver(roomName: string) {
    // 找到一个可用的 Observer
    for (const myRoomName in Game.rooms) {
        const room = Game.rooms[myRoomName];
        if (!room.controller?.my || room.controller.level < 8) continue;
        
        const observer = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_OBSERVER })[0] as StructureObserver;
        if (observer) {
            // Observer 只能观察 Range 10 以内的房间? 不，Observer 射程无限，但消耗 CPU 较高
            // 实际上 Observer 射程是 10 个房间半径 (linear distance <= 10)
            if (Game.map.getRoomLinearDistance(myRoomName, roomName) <= 10) {
                observer.observeRoom(roomName);
                // 观察结果会在下一个 tick 的 Game.rooms[roomName] 中出现
                // 我们需要一种机制来在下个 tick 处理它
                // 简单方案：添加一个 "observing" 标记到内存，下个 tick 检查
                return true;
            }
        }
    }
    return false;
  }
}

// 辅助函数：判断房间类型
function isSourceKeeperRoom(roomName: string): boolean {
  const parsed = /^[WE]([0-9]+)[NS]([0-9]+)$/.exec(roomName);
  if (!parsed) return false;
  const x = parseInt(parsed[1], 10) % 10;
  const y = parseInt(parsed[2], 10) % 10;
  return (x >= 4 && x <= 6 && y >= 4 && y <= 6);
}

function isCenterRoom(roomName: string): boolean {
  const parsed = /^[WE]([0-9]+)[NS]([0-9]+)$/.exec(roomName);
  if (!parsed) return false;
  const x = parseInt(parsed[1], 10) % 10;
  const y = parseInt(parsed[2], 10) % 10;
  return (x === 5 && y === 5);
}

/**
 * 侦查进程
 * 
 * 职责：
 * 1. 维护全图 Intel 数据库。
 * 2. 调度 Scout Creep 去探索未知或过期的房间。
 * 3. 自动扫描相邻房间。
 */
export class ScoutProcess extends Process {
  constructor(pid: string, parentPID: string, priority = 40) {
    super(pid, parentPID, priority);
  }

  public run(): void {
    // 0. 处理 Observer 观察结果
    // 如果上个 tick 使用了 Observer，当前 tick Game.rooms[roomName] 应该可见
    // 这里简单地：遍历 Intel 请求，如果房间可见，直接扫描
    const requests = RoomIntel.getRequests();
    for (const req of requests) {
        if (Game.rooms[req]) {
            RoomIntel.scan(Game.rooms[req]);
        }
    }

    // 1. 自动生成侦查请求 (扫描所有 My Room 的邻居)
    if (Game.time % 100 === 0) {
      for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller?.my) continue;
        
        const exits = Game.map.describeExits(roomName);
        if (!exits) continue;
        
        for (const dir in exits) {
          const neighbor = exits[dir as unknown as DirectionConstant];
          if (!neighbor) continue;
          
          const intel = RoomIntel.get(neighbor);
          // 如果 Intel 过期 (> 5000 ticks) 或不存在，则请求侦查
          if (!intel || Game.time - intel.updatedAt > 5000) {
             RoomIntel.requestScout(neighbor);
          }
        }
      }
    }

    // 2. 调度 Scout 或 Observer
    if (requests.length === 0) return;

    // 优先使用 Observer 扫描
    for (const req of requests) {
        if (RoomIntel.scanWithObserver(req)) {
            // Observer 已启动，下个 tick 会自动扫描
            // 可以继续处理其他请求，或者等待
            // 由于 Observer 每个 tick 只能看一个房间，每个房间只能用一个 Observer
            // 这里暂且不做复杂调度，只尝试一次
        }
    }

    // 找到一个有空闲 Spawn 的房间来生成 Scout
    // 简单起见，遍历所有 My Room，看谁能生
    for (const roomName in Game.rooms) {
       const room = Game.rooms[roomName];
       if (!room.controller?.my || room.controller.level < 3) continue; // RCL3 以上才开始搞侦查
       if (room.energyAvailable < 50) continue; // Scout 很便宜

       // 检查是否已有 Scout
       const existingScout = room.find(FIND_MY_CREEPS, { filter: c => c.memory.role === 'scout' })[0];
       if (existingScout) {
          // 如果有 Scout，且它闲着，分配任务
          if (!existingScout.memory.targetRoom && requests.length > 0) {
             // 找一个最近的未探索房间
             // 简单处理：取第一个。优化：按距离排序
             const target = requests[0]; // 暂取第一个
             existingScout.memory.targetRoom = target;
          }
          continue;
       }

       // 没有 Scout，且有任务，生一个
       // 限制：每个房间最多维护 1 个 Scout，避免爆铺
       const spawns = room.find(FIND_MY_SPAWNS, { filter: s => !s.spawning });
       if (spawns.length > 0 && requests.length > 0) {
          spawns[0].spawnCreep([MOVE], `scout_${Game.time}`, {
             memory: {
                role: 'scout',
                room: room.name,
                working: false
             }
          });
       }
    }

    // 3. 驱动 Scout 行为 (也可以拆分为 ScoutTask，这里为了简单直接写在 Process 里)
    // 实际上更好的做法是：ScoutProcess 负责生成，Creep 的 run 逻辑在 CreepManager 或 RoleScout 里
    // 但鉴于目前架构，我们在这里遍历所有 scout 并驱动它们
    for (const name in Game.creeps) {
       const creep = Game.creeps[name];
       if (creep.memory.role !== 'scout') continue;
       this.runScout(creep);
    }
  }

  private runScout(creep: Creep) {
    // 1. 扫描当前房间
    // 每到一个新房间，或者每隔一段时间，更新 Intel
    if (!creep.memory._lastScan || creep.memory._lastScan !== creep.room.name || Game.time % 50 === 0) {
       RoomIntel.scan(creep.room);
       creep.memory._lastScan = creep.room.name;
    }

    // 2. 确定目标
    if (!creep.memory.targetRoom) {
       const requests = RoomIntel.getRequests();
       if (requests.length > 0) {
          // 简单的贪心：找最近的
          // 优化：此处应使用 RoutePlanner 估算距离，但为了性能暂用 Game.map.getRoomLinearDistance
          let best = requests[0];
          let minDesc = Game.map.getRoomLinearDistance(creep.room.name, best);
          
          for (const req of requests) {
             const dist = Game.map.getRoomLinearDistance(creep.room.name, req);
             if (dist < minDesc) {
                minDesc = dist;
                best = req;
             }
          }
          creep.memory.targetRoom = best;
       } else {
          // 无任务，回收或发呆
          // 可以让它去周围随机游荡？暂且不动
          return;
       }
    }

    // 3. 移动到目标
    const target = creep.memory.targetRoom;
    if (target) {
       if (creep.room.name === target) {
          // 到达目标，任务完成
          RoomIntel.scan(creep.room); // 再次确认扫描
          delete creep.memory.targetRoom;
          // 移除请求 (scan 内部已做，但双重保险)
          RoomIntel.clearRequest(target);
       } else {
          // 寻路
          // 使用 smartMove，需允许跨房
          smartMove(creep, new RoomPosition(25, 25, target), { range: 20, reusePath: 50 });
       }
    }
  }
}

processRegistry.register(ScoutProcess, "ScoutProcess");
