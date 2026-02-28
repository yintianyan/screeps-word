import { GlobalDispatch } from "../ai/GlobalDispatch";
import { SpawnTask, TaskPriority } from "../types/dispatch";
import PopulationManager from "../modules/lifecycle/populationManager"; // [FIX] New path
import Lifecycle from "../modules/lifecycle/index"; // [FIX] New path
import BodyFactory from "../modules/lifecycle/BodyFactory"; // [FIX] New BodyFactory
import { EnergyManager, CrisisLevel } from "../components/EnergyManager";

/**
 * 孵化指挥中心 (SpawnCenter)
 * 职责：
 * 1. 统一收集所有孵化需求（常规人口 + 生命周期替换）。
 * 2. 转化为标准化的 SpawnTask。
 * 3. 提交给 GlobalDispatch 进行排序和分发。
 * 
 * [REFACTOR NOTE]
 * Most logic here is now handled by Lifecycle/index.ts directly.
 * However, SpawnCenter might still be used for high-level orchestration if needed.
 * But currently, Lifecycle.run() handles monitoring and execution.
 * 
 * If we want to keep SpawnCenter as a "Planner" only, it should push to Memory.lifecycle.requests.
 * But Lifecycle already does monitoring.
 * 
 * Let's keep SpawnCenter minimal or deprecate it.
 * For now, let's make it work with new modules to fix build errors.
 */
export class SpawnCenter {
  static run(room: Room) {
      // Delegated to Lifecycle module
      Lifecycle.run(room);
  }
}
