---
name: "structure-planning"
description: "智能建筑规划系统，用于自动分析房间布局并规划 Container 等关键设施。在需要优化基地布局、自动化建造或分析空间利用时调用。"
---

# 智能结构规划 (Structure Planning)

本技能描述了 `module.structurePlanner.js` 的工作原理和设计规范。

## 1. 系统目标
实现全自动的“智能能源中转网络”建设，根据房间的地理特征（Spawn、Sources、Controller 的相对位置）自动决策 Container 的最佳选址。

## 2. 空间分析 (Spatial Analysis)
系统会计算以下关键指标：
*   **Center Pos**: 所有 Source 的几何中心点。
*   **Spawn Centrality**: Spawn 是否位于中心区域 (距离中心 < 10 或 < 平均距离的一半)。
*   **Controller Isolation**: 控制器是否偏远 (距离最近 Source > 15)。
*   **Source Span**: 资源点之间的最大跨度，用于判断是否需要二级中转。

## 3. 建造决策 (Decision Logic)
根据 RCL (Room Control Level) 分阶段执行：
*   **RCL 2**: 建造 **Mining Container** (每个 Source 旁边 1 个)。
*   **RCL 3**: 
    *   **Transfer Container**: 如果 Spawn 位于中心，在 Spawn 附近建造，作为物流枢纽。
    *   **Receiver Container**: 如果 Controller 偏远，在 Controller 附近建造，用于 Upgrader 取能。

## 4. 选址算法 (Positioning)
*   优先选择地形为 Plain (平原) 的位置。
*   避开墙壁 (Wall) 和已有建筑。
*   **安全排除 (Safety Exclusion)**: 强制排除中心点（Source/Spawn/Controller）坐标本身，防止将工地规划在不可建造的实体上。
*   支持 **Bias (偏向)** 参数：例如 Spawn 中转仓会倾向于靠近 Center Pos 的方向建造，缩短运输路径。

## 5. 异常处理
*   **低能量保护**: 当房间能量 < 300 时，暂停新工地的规划，优先保证生产。
*   **防冲突**: 自动检测范围内是否已有同类建筑或工地，避免重复规划。

## 6. 使用方法
在 `main.js` 中调用：
```javascript
const structurePlanner = require("module.structurePlanner");
structurePlanner.run(room); // 建议低频运行 (如每 10-20 ticks)
```
