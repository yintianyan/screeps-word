import Cache from "./memoryManager";
import { GlobalDispatch } from "../ai/GlobalDispatch";
import { TaskPriority, TaskType } from "../types/dispatch";

// 链路类型定义
export enum LinkType {
  SOURCE = "source",      // 发送端：Source 附近
  HUB = "hub",            // 中枢：Storage/Spawn 附近，可收可发
  CONTROLLER = "controller" // 接收端：Controller 附近
}

const linkManager = {
  run: function (room: Room) {
    // 1. 获取并分类 Link
    const links = Cache.getTick(`links_${room.name}`, () =>
      room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_LINK,
      }),
    ) as StructureLink[];

    if (links.length < 2) return;

    // 初始化分类容器
    if (!room.memory.links) room.memory.links = {};
    const mem = room.memory.links;

    // 每 100 tick 或分类缺失时重新分类
    if (Game.time % 100 === 0 || !mem.source || !mem.hub || !mem.controller) {
      this.categorizeLinks(room, links);
    }

    const sourceLinks = (mem.source || []).map(id => Game.getObjectById(id)).filter(l => l) as StructureLink[];
    const hubLink = Game.getObjectById(mem.hub) as StructureLink | null;
    const controllerLink = Game.getObjectById(mem.controller) as StructureLink | null;

    // 2. Link 传输逻辑 (Source -> Hub/Controller)
    this.runTransferLogic(sourceLinks, hubLink, controllerLink);

    // 3. 任务生成逻辑 (HubLink 交互)
    this.generateTasks(room, hubLink, controllerLink);
  },

  /**
   * 自动分类 Link
   */
  categorizeLinks: function(room: Room, links: StructureLink[]) {
    const mem = room.memory.links || {};
    mem.source = [];
    mem.hub = null;
    mem.controller = null;

    const sources = room.find(FIND_SOURCES);
    const storage = room.storage;
    const controller = room.controller;

    links.forEach(link => {
      // Source Link: 2格内有 Source
      if (sources.some(s => s.pos.inRangeTo(link, 2))) {
        mem.source.push(link.id);
        return;
      }
      
      // Controller Link: 3格内有 Controller
      if (controller && link.pos.inRangeTo(controller, 3)) {
        mem.controller = link.id;
        return;
      }

      // Hub Link: 2格内有 Storage 或 3格内有 Spawn
      // 优先判定为 Hub，如果没有 Storage 但有 Spawn 也算
      if ((storage && link.pos.inRangeTo(storage, 2)) || 
          (room.find(FIND_MY_SPAWNS).some(s => s.pos.inRangeTo(link, 3)))) {
        mem.hub = link.id;
      }
    });
    
    room.memory.links = mem;
  },

  /**
   * 执行传输逻辑
   * 策略：SourceLink 优先填满 ControllerLink，其次填满 HubLink
   */
  runTransferLogic: function(sources: StructureLink[], hub: StructureLink | null, controller: StructureLink | null) {
    const CONTROLLER_WANT = 600; // 升级专线期望值
    const HUB_WANT = 400;        // 中枢期望值

    sources.forEach(source => {
      if (source.cooldown > 0 || source.store[RESOURCE_ENERGY] < 400) return;

      // 1. 优先满足 Controller
      if (controller && controller.store[RESOURCE_ENERGY] < CONTROLLER_WANT) {
        source.transferEnergy(controller);
        return;
      }

      // 2. 其次满足 Hub
      if (hub && hub.store[RESOURCE_ENERGY] < HUB_WANT) {
        source.transferEnergy(hub);
        return;
      }
    });

    // 3. Hub 向 Controller 供能 (中继模式)
    // 条件：Hub 能量充足 (>600) 且 Controller 缺能 (<400)
    // 注意：禁止 Hub 向 SourceLink 发送能量 (SourceLink 列表不在此处作为目标)
    if (hub && controller && hub.cooldown === 0 && 
        hub.store[RESOURCE_ENERGY] > 600 && 
        controller.store[RESOURCE_ENERGY] < 400) {
        hub.transferEnergy(controller);
    }
  },

  /**
   * 生成搬运任务
   * 策略：
   * 1. HubLink 满 -> 搬去 Storage (Withdraw)
   * 2. HubLink 空且 ControllerLink 空 -> 从 Storage 搬来 (Transfer)
   */
  generateTasks: function(room: Room, hub: StructureLink | null, controller: StructureLink | null) {
    if (!hub) return;

    // A. HubLink 溢出处理 (Hub -> Storage)
    // 策略修改：只要 Hub 能量 > 400 且 Controller 不需要，就视为需要搬运
    // 避免 Hub 能量堆积到 800 才搬，导致 SourceLink 无法发送
    // 同时，保留一部分给 Controller (200-400缓冲)
    
    // 如果 Controller 需要能量，优先让 Hub 留着发给 Controller
    const controllerNeeds = controller ? (800 - controller.store[RESOURCE_ENERGY]) > 0 : false;
    const threshold = controllerNeeds ? 600 : 400;

    if (hub.store[RESOURCE_ENERGY] >= threshold) {
      const taskId = `LINK_EMPTY_${hub.id}`;
      // [FIX] REMOVED "room.storage.store.getFreeCapacity() > 0" CHECK
      // If Storage is full, Hauler can still pick up and fill other things (Spawn, Towers, Upgraders).
      // Or they will just hold it. But we MUST clear the Link to unblock SourceLinks.
      // If Hauler picks up and has nowhere to go, that's a separate problem (Storage full).
      // But blocking the Link network is worse.
      
      if (!GlobalDispatch.getTask(taskId)) {
        GlobalDispatch.registerTask({
          id: taskId,
          type: TaskType.PICKUP, // 从 Link 取
          priority: TaskPriority.HIGH, // 及时清空以免阻塞 SourceLink
          targetId: hub.id,
          pos: hub.pos,
          maxCreeps: 1,
          creepsAssigned: [],
          requirements: { bodyParts: [CARRY], minCapacity: 50 },
          validRoles: ["hauler"],
          estimatedDuration: 20,
          creationTime: Game.time,
          autoRemove: true,
          data: { resource: RESOURCE_ENERGY, amount: hub.store[RESOURCE_ENERGY] },
        });
      }
    }
    
    // [NEW] SourceLink 溢出保护
    // 如果 SourceLink 满了但无法发送（Hub/Controller 也是满的，或冷却中），生成临时 PICKUP 任务
    // 防止 Harvester 堵塞
    const sources = (room.memory.links?.source || []).map(id => Game.getObjectById(id)).filter(l => l) as StructureLink[];
    sources.forEach(source => {
        // [FIX] Don't make hauler withdraw from SourceLink unless critical
        // This causes the "transport to source" loop if HubLink is also near SourceLink (rare but possible)
        // Or if HubLink is full, Hauler picks up from SourceLink, then has nowhere to go but Storage.
        // That is fine.
        
        // But the user said: "Hauler moves from source link -> storage, then link transfers back".
        // This implies HubLink is sending to SourceLink? We fixed that.
        // OR: SourceLink transfers to HubLink, AND Hauler withdraws from SourceLink.
        // This is double handling.
        
        // Only withdraw if SourceLink is FULL (800) and Cooldown > 0 (can't transfer).
        // Or if HubLink is full.
        
        if (source.store[RESOURCE_ENERGY] >= 750) { // Very full
            const taskId = `LINK_DRAIN_${source.id}`;
            const hubFull = hub ? hub.store.getFreeCapacity(RESOURCE_ENERGY) < 50 : true;
            
            // Only generate task if we CANNOT transfer via link network
             if ((source.cooldown > 5 || hubFull) && !GlobalDispatch.getTask(taskId)) {
                  GlobalDispatch.registerTask({
                     id: taskId,
                     type: TaskType.PICKUP,
                     priority: TaskPriority.NORMAL,
                     targetId: source.id,
                     pos: source.pos,
                     maxCreeps: 1,
                     creepsAssigned: [],
                     requirements: { bodyParts: [CARRY], minCapacity: 50 },
                     validRoles: ["hauler"],
                     estimatedDuration: 20,
                     creationTime: Game.time,
                     autoRemove: true,
                     data: { resource: RESOURCE_ENERGY, amount: source.store[RESOURCE_ENERGY] },
                  });
             }
        }
    });

    // B. Controller 缺能处理 (Storage -> Hub -> Controller)
    // 当 ControllerLink 能量极低 (< 200) 且 Hub 也没能量时，需要从 Storage 补充到 Hub
    // (Hub 收到后会在 runTransferLogic 中转发给 Controller，或者由 Hauler 直接填 ControllerLink 如果没有 Hub?)
    // 这里我们只负责填 Hub，利用 Hub 的转发能力。
    // 如果没有 SourceLink 供能，Hub 就变成了发送端。
    
    // 检查 Controller 需求
    const controllerNeed = controller ? (600 - controller.store[RESOURCE_ENERGY]) : 0;
    
    // 如果 Controller 很缺，且 Hub 也很缺 (< 200)，说明 SourceLink 供不上，需要 Storage 介入
    if (controller && controllerNeed > 400 && hub.store[RESOURCE_ENERGY] < 400 && room.storage && room.storage.store[RESOURCE_ENERGY] > 5000) {
       const taskId = `LINK_FILL_${hub.id}`;
       if (!GlobalDispatch.getTask(taskId)) {
         GlobalDispatch.registerTask({
           id: taskId,
           type: TaskType.TRANSFER, // 填入 Hub
           priority: TaskPriority.HIGH,
           targetId: hub.id,
           pos: hub.pos,
           maxCreeps: 1,
           creepsAssigned: [],
           requirements: { bodyParts: [CARRY], minCapacity: 50 },
           validRoles: ["hauler"],
           estimatedDuration: 20,
           creationTime: Game.time,
           autoRemove: true,
           data: { resource: RESOURCE_ENERGY },
         });
       }
    }
  }
};

export default linkManager;
