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

  // 任务优先级基础分 (对应 TaskPriority Enum)
  // 0: CRITICAL, 1: HIGH, 2: MEDIUM, 3: NORMAL, 4: LOW, 5: IDLE
  PRIORITY: {
    EMERGENCY: 0,
    HIGH: 1,
    MEDIUM: 2,
    NORMAL: 3,
    LOW: 4,
    IDLE: 5,
  },

  // 物流配置
  LOGISTICS: {
    // 目标筛选阈值
    THRESHOLDS: {
      TOWER_REFILL: 500, // 能量低于此值时填充
      UPGRADER_REFILL: 0.5, // 容量百分比
      BUILDER_REFILL: 0.3, // 容量百分比
      CONTAINER_CACHE: 1500, // RCL < 4
      CONTAINER_CACHE_HIGH: 5000, // RCL >= 4
    },
    // 内部评分权重 (用于同一优先级内的微调)
    SCORES: {
      SPAWN: 200,
      LINK: 190,
      BUILDER_PRIORITY: 150,
      TOWER: 120,
      UPGRADER: 100,
      BUILDER: 80,
      CONTAINER: 50,
      STORAGE: 10,
    }
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
