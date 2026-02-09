import { GlobalDispatch } from "../ai/GlobalDispatch";
import Lifecycle from "./roomManager";

/**
 * 模块：孵化器 (Spawner)
 * 处理所有 Creep 的孵化逻辑
 * 现在的角色是：执行者 (Executor)
 * 它从 GlobalDispatch 获取孵化任务并执行，不再自己做决策
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
      // 执行孵化
      const result = spawn.spawnCreep(
        task.body,
        task.id.replace("SPAWN_", ""),
        {
          memory: task.memory,
        },
      );

      if (result === OK) {
        console.log(
          `[Spawner] ✅ 执行孵化任务: ${task.role} (Priority: ${task.priority})`,
        );

        // 如果是 Lifecycle 替换，通知 Lifecycle 清理
        // 通过 memory.predecessorId 判断
        if (task.memory.predecessorId) {
          Lifecycle.notifySpawn(
            task.memory.predecessorId,
            task.id.replace("SPAWN_", ""),
          );
        }
      } else {
        console.log(`[Spawner] ❌ 孵化失败: ${result}`);
        // 失败处理？
        // 应该把任务放回队列？或者如果是 ERR_NOT_ENOUGH_ENERGY，可以等待。
        // 暂时 GlobalDispatch 的 getNextSpawnTask 已经移除了任务。
        // 如果失败了，我们需要重新注册回去。
        if (result === ERR_NOT_ENOUGH_ENERGY) {
          // 放回队列头部?
          // 暂时简单重新注册
          GlobalDispatch.registerSpawnTask(task);
        }
      }
    }
  },
};

export default spawnerModule;
