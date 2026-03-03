/**
 * 全局配置
 *
 * 集中管理游戏中的常量和参数调整。
 */
export const config = {
  USERNAME: "SongHao",
  // CPU 管理配置
  CPU: {
    BUCKET_LIMIT: 500, // Bucket 阈值：低于此值时进入节流模式
    CRITICAL_BUCKET: 200, // 临界 Bucket：低于此值时仅运行关键进程
    THROTTLE_MIN_PRIORITY: 55, // 节流模式下的最低运行优先级
    CRITICAL_MIN_PRIORITY: 70, // 临界模式下的最低运行优先级
    THROTTLE_LOG_INTERVAL: 25, // 节流日志打印间隔
  },
  // 孵化配置
  SPAWN: {
    JOB_TIMEOUT: 300, // 孵化任务超时时间
    JOB_SLEEP: 5, // 孵化队列空闲时的休眠时间
    REPLACE_BUFFER: 50, // Creep 寿命剩余多少时开始预孵化替补
  },
  // 人口与经济配置
  POPULATION: {
    METRICS_ALPHA: 0.05, // 指标平滑系数
    WORKER: {
      MIN: 2, // 最少 Worker 数量
      RCL_TARGETS: [0, 6, 8, 8, 6, 6, 4, 4, 4], // 各 RCL 等级下的基础 Worker 目标
      IDLE_HIGH: 0.3, // 闲置率高阈值 (触发减少人口)
      IDLE_LOW: 0.05, // 闲置率低阈值 (触发增加人口)
      BUSY_SITES_MIN: 1, // 忙碌状态下的最小工地数
      DELTA_IDLE: -1, // 闲置调整量
      DELTA_BUSY: 1, // 忙碌调整量
      STORAGE_LOW: 2000, // Storage 能量低阈值
      STORAGE_HIGH: 50000, // Storage 能量高阈值
      STORAGE_BOOST: 1, // 能量低时的 Worker 加成
      STORAGE_REDUCE: -1, // 能量高时的 Worker 减免
      LINK_REDUCE: -2, // 有 Link 时的 Worker 减免
      DISTRIBUTOR_REDUCE: -1, // 有 Distributor 时的 Worker 减免
    },
    ENERGY_BUDGET: {
      CRITICAL_MIN: 300, // 紧急孵化预算
      LOW_RATIO: 0.4, // 低能量时的预算比例
      MID_RATIO: 0.5, // 中等能量时的预算比例
    },
    UPGRADER: {
      STORAGE_HEALTHY: 5000, // Storage 健康线 (允许升级)
      AVAILABLE_HEALTHY_RATIO: 0.5, // 房间可用能量健康比例
      STORAGE_RICH: 100000, // Storage 富裕线 (允许更多升级)
      STORAGE_MEDIUM: 20000, // Storage 中等线
      COUNT_RICH: 3, // 富裕时的 Upgrader 数量
      COUNT_MEDIUM: 2, // 中等时的 Upgrader 数量
      COUNT_LOW: 1, // 低能量时的 Upgrader 数量
      THROTTLE_RATIO: 0.5, // 节流比例
    },
    DISTRIBUTOR: {
      STORAGE_MIN_FOR_SPAWN: 2000, // 孵化 Distributor 所需的最小 Storage 能量
      STORAGE_MIN_FOR_BIG: 10000, // 孵化大型 Distributor 所需的能量
      STORAGE_BUDGET_DIVISOR: 5, // 预算除数
      MIN_BUDGET: 500, // 最小预算
    },
    STORAGE: {
      WORKER_WITHDRAW_MIN: 3000,
      UPGRADER_WITHDRAW_MIN: 8000,
      UPGRADER_RUN_MIN: 6000,
      DISTRIBUTOR_WITHDRAW_MIN: 1500,
    },
    HAULER: {
      REBIND_INTERVAL: 25,
      PRESSURE_PER_HAULER: 200,
      SOURCE_DROP_RANGE: 3,
    },
    DEFENSE: {
      RECENT_HOSTILE_TICKS: 50, // 敌袭状态持续时间
    },
    CPU_BUCKET_STOP_NON_CRITICAL: 500, // 停止非关键进程的 Bucket 阈值
  },
  // Controller 降级配置
  CONTROLLER: {
    DOWNGRADE_CRITICAL: 5000, // 降级紧急阈值
    DOWNGRADE_LOW: 10000, // 降级警告阈值
  },
  // 外矿配置
  REMOTE_MINING: {
    SK_MIN_RCL: 7, // 开启 Source Keeper 外矿的最小 RCL
    SK_MIN_STORAGE_ENERGY: 50000, // 开启 SK 外矿的最小 Storage 能量
    KEEPER_SQUAD: {
      KILLERS: 1,
      HEALERS: 1,
    },
  },
  STRATEGY: {
    MODE_SWITCH_MIN_TICKS: 50, // 模式切换最小间隔
  },
  LAYOUT: {
    DEFAULT: "stamp" as "stamp" | "bunker", // 默认布局
    DYNAMIC_INTERVAL: 50,
  },
  BODIES: {
    HARVESTER: {
      1: [WORK, CARRY, MOVE],
      2: [WORK, WORK, CARRY, MOVE],
    },
  },
};
