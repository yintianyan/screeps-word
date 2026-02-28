import populationModule from "../modules/lifecycle/populationManager"; // Fix import path
import { EnergyManager, CrisisLevel } from "./EnergyManager";
import StatsManager from "./statsManager";

const monitorModule = {
  run: function (room: Room) {
    if (!room) return;

    // Run stats collection
    StatsManager.run(room);

    // 1. 统计各角色数量和状态
    // [FIX] Use StructureCache or global Game.creeps to avoid discrepancies.
    // room.find(FIND_MY_CREEPS) returns active creeps in the room.
    // But Game.creeps contains ALL creeps (including those just spawned or in other rooms?).
    // If we only care about this room, room.find is correct.
    // However, if we have creeps moving between rooms (Remote), they might be missed or double counted?
    // Monitor is per room.
    
    // Potential issue: Spawning creeps?
    // Game.creeps includes spawning creeps.
    // room.find(FIND_MY_CREEPS) includes spawning creeps if they are in the room object list?
    // Let's verify: FIND_MY_CREEPS usually includes spawning creeps.
    
    // BUT, the user says "Game total > Monitor total".
    // Monitor counts: harvester, upgrader, builder, hauler.
    // What if there are other roles? (scout, remote_*, claimer)
    // The stats object only has 4 keys.
    // Any creep with a different role is ignored.
    
    const creeps = room.find(FIND_MY_CREEPS);
    const stats: Record<string, { count: number; idle: number; total: number }> = {
      harvester: { count: 0, idle: 0, total: 0 },
      upgrader: { count: 0, idle: 0, total: 0 },
      builder: { count: 0, idle: 0, total: 0 },
      hauler: { count: 0, idle: 0, total: 0 },
      // Add 'other' to catch missing ones
      other: { count: 0, idle: 0, total: 0 }
    };

    creeps.forEach((creep) => {
      const role = creep.memory.role || 'unknown';
      
      // If role is not in stats, add it dynamically or put in 'other'
      if (!stats[role]) {
          // Initialize if missing (e.g. remote_harvester)
          stats[role] = { count: 0, idle: 0, total: 0 };
      }
      
      stats[role].count++;
      stats[role].total++;
      
      if (creep.store.getUsedCapacity() === 0 && !creep.fatigue) {
          // stats[role].idle++;
      }
    });

    // 2. 绘制可视化面板
    const visual = new RoomVisual(room.name);
    const x = 1;
    const y = 1;

    // ...
    
    // 角色列表
    let row = room.storage ? y + 5.0 : y + 4.2;
    // Get all roles found
    const roles = Object.keys(stats).sort();

    roles.forEach((role) => {
      if (stats[role].count === 0) return; // Skip empty roles
      
      const info = stats[role];
      let color = "#ffffff";
      if (role === "harvester") color = "#ffaa00";
      else if (role === "hauler") color = "#00ffff";
      else if (role === "upgrader") color = "#ff00ff";
      else if (role === "builder") color = "#ffff00";
      else color = "#aaaaaa"; // Gray for others

      visual.text(`${role.toUpperCase()}:`, x, row, {
        align: "left",
        font: 0.6,
        color: color,
      });
      visual.text(`${info.count}`, x + 6, row, { // Increased spacing for longer role names
        align: "left",
        font: 0.6,
        color: "#ffffff",
      });
      row += 0.8;
    });

    // 效率监控 (Efficiency)
    row += 0.5;
    visual.text(`📈 效率监控:`, x, row, {
      align: "left",
      font: 0.7,
      color: "#ffffff",
    });
    row += 0.8;

    // Calculate average efficiency per role
    const roleEff: Record<string, { work: number; total: number }> = {};
    creeps.forEach((c) => {
      if (!c.memory.efficiency) return;
      const role = c.memory.role;
      if (!roleEff[role]) roleEff[role] = { work: 0, total: 0 };
      roleEff[role].work += c.memory.efficiency.workingTicks;
      roleEff[role].total += c.memory.efficiency.totalTicks;
    });

    for (const r in roleEff) {
      const eff = roleEff[r];
      const percent = Math.floor((eff.work / eff.total) * 100);
      let color = "#00ff00";
      if (percent < 50) color = "#ffff00";
      if (percent < 20) color = "#ff0000";

      visual.text(`${r}: ${percent}%`, x, row, {
        align: "left",
        font: 0.5,
        color: color,
      });
      row += 0.6;
    }

    // 3. 矿源运输状态 (Transport Status)
    row += 1.0;
    visual.text(`🚚 运输线状态:`, x, row, {
      align: "left",
      font: 0.7,
      color: "#00ffff",
    });
    row += 0.8;

    const sources = room.find(FIND_SOURCES);
    const energyLevel = EnergyManager.getLevel(room);
    const haulerNeeds = populationModule.calculateHaulerNeeds(room, sources, energyLevel); // Return number, not map
    const haulers = room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "hauler",
    });

    // Total Comparison
    const totalNeeded = haulerNeeds;
    const totalCurrent = haulers.length;
    let totalColor = "#00ff00";
    if (totalCurrent < totalNeeded) totalColor = "#ff0000";

    visual.text(`总搬运: ${totalCurrent}/${totalNeeded}`, x, row, {
      align: "left",
      font: 0.6,
      color: totalColor,
    });
    row += 0.8;

    sources.forEach((source) => {
      const container = source.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      })[0];
      const energy = container ? container.store[RESOURCE_ENERGY] : 0;
      const capacity = container ? container.store.getCapacity() : 0;

      // 颜色逻辑：积压红，正常绿，无容器灰
      let color = "#00ff00";
      if (energy > 1800) color = "#ff0000";
      else if (energy > 1000) color = "#ffff00";
      if (!container) color = "#555555";

      visual.text(`源 ${source.id.substr(-4)}:`, x, row, {
        align: "left",
        font: 0.5,
        color: "#ffffff",
      });
      visual.text(`🔋 ${energy}/${capacity}`, x + 2.5, row, {
        align: "left",
        font: 0.5,
        color: color,
      });

      row += 0.6;
    });

    // 4. 异常警告
    row += 0.5;
    if (stats.harvester.count === 0) {
      visual.text(`⚠️ 警告: 无采集者!`, x, row + 1, {
        align: "left",
        color: "#ff0000",
        font: 0.7,
      });
    }
    if (stats.hauler.count === 0 && stats.harvester.count > 0) {
      visual.text(`⚠️ 警告: 无搬运工!`, x, row + 2, {
        align: "left",
        color: "#ff0000",
        font: 0.7,
      });
    }

    // Enemy Warning
    const enemies = room.find(FIND_HOSTILE_CREEPS);
    if (enemies.length > 0) {
      visual.text(`⚔️ 入侵警告: ${enemies.length} 敌军!`, x, row + 3, {
        align: "left",
        color: "#ff0000",
        font: 0.8,
        backgroundColor: "#000000",
      });
    }

    // 检查长时间等待的 Creep (需要配合 Memory)
    creeps.forEach((creep) => {
      // 可视化请求状态
      if (creep.memory.requestingEnergy) {
        // 画一个黄色的圈表示正在请求
        visual.circle(creep.pos, {
          fill: "transparent",
          radius: 0.5,
          stroke: "#ffff00",
          strokeWidth: 0.15,
          opacity: 0.5,
        });

        // 如果等待时间过长 (>5 ticks)，画红圈并显示感叹号
        if ((creep.memory.waitingTicks || 0) > 5) {
          visual.circle(creep.pos, {
            fill: "transparent",
            radius: 0.7,
            stroke: "#ff0000",
            strokeWidth: 0.15,
            opacity: 0.8,
          });
          visual.text(`!`, creep.pos.x, creep.pos.y + 0.2, {
            color: "#ff0000",
            font: 0.5,
          });
        }
      }

      // 可视化 Hauler 的目标连线
      if (
        creep.memory.role === "hauler" &&
        creep.memory.hauling &&
        creep.memory.targetId
      ) {
        const target = Game.getObjectById(creep.memory.targetId);
        if (target) {
          // 如果目标是 Creep，画绿线
          if (target instanceof Creep) {
            visual.line(creep.pos, target.pos, {
              color: "#00ff00",
              width: 0.15,
              lineStyle: "dashed",
            });
          } else if (
            target instanceof Structure ||
            target instanceof ConstructionSite
          ) {
            // 建筑画白线
            visual.line(creep.pos, target.pos, {
              color: "#ffffff",
              width: 0.05,
              opacity: 0.3,
            });
          }
        }
      }

      if (creep.store.getUsedCapacity() === 0) {
        // 如果空背包，记录等待时间
        if (!creep.memory.idleTicks) creep.memory.idleTicks = 0;
        creep.memory.idleTicks++;

        // 如果等待超过 50 tick (且不是 harvester，harvester 挖矿也可能空背包如果直接转存)
        if (creep.memory.idleTicks > 50 && creep.memory.role !== "harvester") {
          visual.text(`⏳`, creep.pos.x, creep.pos.y - 0.5, {
            color: "#ff0000",
            font: 0.5,
          });
        }
      } else {
        creep.memory.idleTicks = 0;
      }
    });
    // 5. Dispatch System Visualization (New)
    const dispatch = Memory.dispatch;
    if (dispatch) {
        row += 1.0;
        visual.text(`📡 调度中心:`, x, row, { align: "left", font: 0.7, color: "#ffffff" });
        row += 0.8;
        
        // Count tasks
        let taskCount = 0;
        for (const _id in dispatch.tasks) { taskCount++; }
        
        // Count active assignments
        let assignCount = 0;
        for (const _id in dispatch.assignments) { assignCount++; }
        
        visual.text(`Tasks: ${taskCount} | Assigned: ${assignCount}`, x, row, {
            align: "left", font: 0.5, color: "#aaaaaa"
        });
        
        // Draw Task Lines (Throttle drawing to save CPU)
        if (Game.time % 2 === 0) {
            for (const creepId in dispatch.assignments) {
                const creep = Game.creeps[creepId];
                if (!creep || creep.room.name !== room.name) continue;
                
                const taskId = dispatch.assignments[creepId];
                const task = dispatch.tasks[taskId];
                if (task && task.pos) {
                    // Determine color based on priority
                    let color = "#ffffff";
                    if (task.priority === 0) color = "#ff0000"; // Critical
                    else if (task.priority === 1) color = "#ff00ff"; // High
                    else if (task.priority === 2) color = "#00ff00"; // Medium
                    else if (task.priority === 3) color = "#00ffff"; // Normal
                    else if (task.priority === 4) color = "#ffff00"; // Low
                    
                    visual.line(creep.pos, new RoomPosition(task.pos.x, task.pos.y, task.pos.roomName), {
                        color: color, width: 0.05, lineStyle: "dotted", opacity: 0.3
                    });
                    visual.circle(new RoomPosition(task.pos.x, task.pos.y, task.pos.roomName), {
                        fill: "transparent", radius: 0.3, stroke: color, opacity: 0.5
                    });
                }
            }
        }
    }
    // 6. Data Center (Merged Dashboard)
    if (Memory.datastore?.rooms[room.name]) {
        const data = Memory.datastore.rooms[room.name];
        row += 1.0;
        visual.text(`📊 综合数据:`, x, row, { align: "left", font: 0.7, color: "#ffffff" });
        row += 0.8;
        
        // RCL Progress
        const progress = ((data.rcl.progress / data.rcl.progressTotal) * 100).toFixed(1);
        visual.text(`RCL: ${data.rcl.level} (${progress}%)`, x, row, { align: "left", font: 0.6, color: "#aaaaaa" });
        row += 0.6;
        
        // Threat
        if (data.threat.level > 0) {
            visual.text(`⚠️ THREAT: ${data.threat.hostiles} (${data.threat.owner || "Invader"})`, x, row, { align: "left", font: 0.6, color: "#ff0000" });
            row += 0.6;
        }
    }
  },
};

export default monitorModule;
