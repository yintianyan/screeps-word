import populationModule from "./populationManager";
import StatsManager from "./statsManager";

const monitorModule = {
  run: function (room: Room) {
    if (!room) return;

    // Run stats collection
    StatsManager.run(room);

    // 1. 统计各角色数量和状态
    const creeps = room.find(FIND_MY_CREEPS);
    const stats = {
      harvester: { count: 0, idle: 0, total: 0 },
      upgrader: { count: 0, idle: 0, total: 0 },
      builder: { count: 0, idle: 0, total: 0 },
      hauler: { count: 0, idle: 0, total: 0 },
    };

    // 统计总能量
    // const totalEnergy = room.energyAvailable;
    // const capacity = room.energyCapacityAvailable;

    creeps.forEach((creep) => {
      const role = creep.memory.role;
      if (stats[role]) {
        stats[role].count++;
        stats[role].total++;
        if (creep.store.getUsedCapacity() === 0 && !creep.fatigue) {
          // stats[role].idle++;
        }
      }
    });

    // 2. 绘制可视化面板
    const visual = new RoomVisual(room.name);
    const x = 1;
    const y = 1;

    // 标题
    visual.text(`📊 殖民地监控 [${room.name}]`, x, y, {
      align: "left",
      font: 0.8,
      color: "#ffffff",
    });

    // 能量趋势 & 等级
    const energyTrend = StatsManager.getTrend(room.name, "energy");
    const energyLevel = populationModule.getEnergyLevel(room);

    // CPU 趋势
    const cpuTrend = StatsManager.getTrend(room.name, "cpu");
    visual.text(
      `CPU: ${Game.cpu.getUsed().toFixed(2)} (${cpuTrend > 0 ? "+" : ""}${cpuTrend.toFixed(2)})`,
      x,
      y + 1,
      {
        align: "left",
        font: 0.6,
        color: "#aaaaaa",
      },
    );

    // 能量详情
    const energyColor =
      energyLevel === "CRITICAL"
        ? "#ff0000"
        : energyLevel === "LOW"
          ? "#ffff00"
          : "#00ff00";
    visual.text(
      `Energy: ${room.energyAvailable}/${room.energyCapacityAvailable} (${energyLevel}) ${energyTrend > 0 ? "↗" : "↘"}`,
      x,
      y + 1.8,
      {
        align: "left",
        font: 0.6,
        color: energyColor,
      },
    );

    // Storage 详情 (如果存在)
    if (room.storage) {
      const store = room.storage.store[RESOURCE_ENERGY];
      const capacity = room.storage.store.getCapacity();
      visual.text(
        `Storage: ${(store / 1000).toFixed(1)}k / ${(capacity / 1000).toFixed(0)}k`,
        x,
        y + 2.6,
        {
          align: "left",
          font: 0.6,
          color: "#ffffff",
        },
      );
    }

    // 控制器等级
    if (room.controller) {
      const progress = Math.floor(
        (room.controller.progress / room.controller.progressTotal) * 100,
      );
      const rowY = room.storage ? y + 3.4 : y + 2.6; // 动态调整行号
      visual.text(`等级: ${room.controller.level} (${progress}%)`, x, rowY, {
        align: "left",
        font: 0.6,
        color: "#aaaaaa",
      });
      visual.text(
        `降级倒计时: ${room.controller.ticksToDowngrade}`,
        x,
        rowY + 0.8,
        {
          align: "left",
          font: 0.5,
          color:
            room.controller.ticksToDowngrade < 4000 ? "#ff0000" : "#aaaaaa",
        },
      );
    }

    // 角色列表
    let row = room.storage ? y + 5.0 : y + 4.2;
    const roles = ["harvester", "hauler", "upgrader", "builder"];

    roles.forEach((role) => {
      const info = stats[role];
      let color = "#ffffff";
      if (role === "harvester") color = "#ffaa00";
      if (role === "hauler") color = "#00ffff";
      if (role === "upgrader") color = "#ff00ff";
      if (role === "builder") color = "#ffff00";

      visual.text(`${role.toUpperCase()}:`, x, row, {
        align: "left",
        font: 0.6,
        color: color,
      });
      visual.text(`${info.count}`, x + 4, row, {
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
    const haulerNeeds = populationModule.getHaulerNeeds(room);
    const haulers = room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "hauler",
    });

    // 统计当前每个 Source 的 Hauler 数量
    const currentCounts = {};
    haulers.forEach((c) => {
      if (c.memory.sourceId) {
        currentCounts[c.memory.sourceId] =
          (currentCounts[c.memory.sourceId] || 0) + 1;
      }
    });

    sources.forEach((source) => {
      const container = source.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      })[0];
      const energy = container ? container.store[RESOURCE_ENERGY] : 0;
      const capacity = container ? container.store.getCapacity() : 0;
      const needed = haulerNeeds[source.id] || 0;
      const current = currentCounts[source.id] || 0;

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

      // 搬运工状态：当前/目标
      let haulerColor = "#ffffff";
      if (current < needed) haulerColor = "#ff0000"; // 缺人
      if (current > needed) haulerColor = "#00ffff"; // 富余
      visual.text(`🚚 ${current}/${needed}`, x + 6, row, {
        align: "left",
        font: 0.5,
        color: haulerColor,
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
  },
};

export default monitorModule;
