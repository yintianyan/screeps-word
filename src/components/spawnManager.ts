import { GlobalDispatch } from "../ai/GlobalDispatch";
import Lifecycle from "../modules/lifecycle/index";

/**
 * 模块：孵化器 (Spawner)
 * 处理所有 Creep 的孵化逻辑
 * 现在的角色是：执行者 (Executor)
 * 它从 GlobalDispatch 获取孵化任务并执行，不再自己做决策
 * 
 * @deprecated Integrated into Lifecycle module. Kept for backward compatibility if needed.
 */
const spawnerModule = {
  run: function (room: Room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn || spawn.spawning) {
      // 可视化孵化状态
      if (spawn && spawn.spawning) {
        const spawningCreep = Game.creeps[spawn.spawning.name];
        spawn.room.visual.text(
          "🛠️" + (spawningCreep ? spawningCreep.memory.role : "Spawning"),
          spawn.pos.x + 1,
          spawn.pos.y,
          { align: "left", opacity: 0.8 },
        );
      }
      return;
    }

    // 从 GlobalDispatch 获取任务
    const task = GlobalDispatch.getNextSpawnTask(room.name);

    if (task) {
      // [Rule 6] Pre-Spawn Validation Hook
      if (this.validateSpawnRequest(spawn, task) !== OK) {
        // Validation failed, log error and drop task
        console.log(`[Spawner] ⛔ 任务被拦截: ${task.role} 不符合孵化标准`);
        if (!room.memory.spawnErrors) room.memory.spawnErrors = [];
        room.memory.spawnErrors.push({
          time: Game.time,
          role: task.role,
          reason: "Validation Failed (Low parts or Duplicate)",
        });
        return;
      }

      // 执行孵化
      const result = spawn.spawnCreep(
        task.body,
        task.id.replace("SPAWN_", ""),
        {
          memory: task.memory,
        },
      );

      if (result === OK) {
        // Reduced log level to save CPU/Console space
        // console.log(
        //   `[Spawner] ✅ 执行孵化任务: ${task.role} (Priority: ${task.priority})`,
        // );

        // 如果是 Lifecycle 替换，通知 Lifecycle 清理
        // 通过 memory.predecessorId 判断
        if (task.memory.predecessorId) {
            // Deprecated: notifySpawn was part of old Lifecycle
            // New Lifecycle handles cleanup via processSpawnQueue or memory cleanup
            // Just log for now
            // console.log("Spawned replacement for " + task.memory.predecessorId);
        }
      } else {
        // 失败处理？
        // 应该把任务放回队列？或者如果是 ERR_NOT_ENOUGH_ENERGY，可以等待。
        // 暂时 GlobalDispatch 的 getNextSpawnTask 已经移除了任务。
        // 如果失败了，我们需要重新注册回去。
        if (result === ERR_NOT_ENOUGH_ENERGY) {
          // [Visualization] Show waiting status
          // Throttle visual
          if (Game.time % 5 === 0) {
              spawn.room.visual.text(
                "⏳ Energy",
                spawn.pos.x + 1,
                spawn.pos.y,
                { align: "left", opacity: 0.8, color: "#ffff00" },
              );
          }

          // 放回队列头部?
          // 暂时简单重新注册
          GlobalDispatch.registerSpawnTask(task);
        } else {
          console.log(`[Spawner] ❌ 孵化失败: ${result}`);
        }
      }
    }
  },
  validateSpawnRequest: function (spawn: StructureSpawn, task: any): number {
    // 1. Check for 1-WORK Harvester when Energy is high
    if (task.role === "harvester") {
      const workParts = task.body.filter(
        (p: BodyPartConstant) => p === WORK,
      ).length;
      if (workParts < 2 && spawn.room.energyAvailable >= 300) {
        const harvesters = spawn.room.find(FIND_MY_CREEPS, {
          filter: (c) => c.memory.role === "harvester",
        });
        if (harvesters.length > 0) {
          return ERR_INVALID_ARGS; // Reject weakling if not emergency
        }
      }
    }
    return OK;
  },
};

export default spawnerModule;
