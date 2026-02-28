
import Brain from "./decision";

const brainModule = {
  run: function (room: Room) {
    // 实例化 Brain 并运行决策逻辑
    // Brain 的状态通常不需要持久化到 Memory，因为它每 tick 重新计算最优解
    const brain = new Brain(room);
    brain.run();
  },
};

export default brainModule;
