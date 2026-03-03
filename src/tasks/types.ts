/**
 * 任务类型枚举
 */
export type TaskType =
  | "harvest" // 采集
  | "transfer" // 转移资源
  | "upgrade" // 升级控制器
  | "build" // 建造
  | "repair" // 维修
  | "attack" // 攻击
  | "heal" // 治疗
  | "rangedAttack" // 远程攻击
  | "claim" // 占领/预订控制器
  | "pickup" // 捡起资源
  | "withdraw" // 取出资源
  | "recycle"; // 回收 Creep

/**
 * 任务接口
 * 用于调度器 (Scheduler) 识别任务。
 */
export interface ITask {
  id: string; // 任务 ID
  type: TaskType; // 任务类型
  targetId?: string; // 目标 ID
  priority: number; // 优先级
}

/**
 * 任务运行结果
 */
export type TaskRunResult =
  | { status: "running" } // 正在运行
  | { status: "completed" } // 已完成
  | {
      status: "failed"; // 失败
      reason:
        | "pathBlocked" // 路径被阻挡
        | "targetInvalid" // 目标无效 (不存在或无法访问)
        | "notEnoughResources" // 资源不足
        | "unknown"; // 未知原因
    };
