/**
 * Game Configuration
 * 集中管理游戏参数
 */
export default {
  // 角色身体部件配置
  BODY_PARTS: {
    harvester: [WORK, WORK, CARRY, MOVE],
    hauler: [CARRY, CARRY, MOVE, MOVE],
    upgrader: [WORK, CARRY, MOVE],
    builder: [WORK, CARRY, MOVE],
    defender: [ATTACK, ATTACK, MOVE, MOVE],
  },

  // 任务优先级基础分
  PRIORITY: {
    EMERGENCY: 1000,
    HIGH: 100,
    MEDIUM: 50,
    LOW: 10,
    IDLE: 1,
  },

  // 房间限制
  LIMITS: {
    MAX_CREEPS: 20,
    CPU_BUCKET_LIMIT: 500, // CPU 降级阈值
  },

  // 角色名称前缀
  ROLE_PREFIX: {
    harvester: "H",
    hauler: "T", // Transport
    upgrader: "U",
    builder: "B",
    defender: "D",
  },
};
