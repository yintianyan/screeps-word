# Screeps 自动化 AI 游戏文档

本文档详细描述了当前代码库的运行机制、角色体系、等级发展规划及核心策略。

## 1. 核心运行机制 (Core Mechanics)

本系统采用 **Kernel-Module (内核-模块)** 架构，确保代码的高内聚、低耦合与高性能。

### 1.1 架构设计

- **Kernel (`ai/kernel.ts`)**: 作为操作系统核心，负责注册和调度所有模块 (`run()`)，处理全局错误边界，防止单个模块崩溃导致整个 tick 挂起。
- **Cache (`components/memoryManager.ts`)**: 双层缓存系统。
  - **TickCache**: 缓存 `room.find` 等昂贵 API 的结果，单 tick 有效，显著降低 CPU 消耗。
  - **HeapCache**: 缓存跨 tick 的静态数据（如地形分析结果），减少重复计算。
- **TaskManager (`components/taskManager.ts`)**: [新增] 负责分析房间内的任务负载（建造、维修、运输），为人口管理提供数据支持。
- **PriorityModule (`config/priority.ts`)**: [新增] 集中管理的优先级配置系统，定义了所有建筑类型的建造重要性。

### 1.2 生命周期管理 (Lifecycle)

- **预孵化机制 (`module.lifecycle.js`)**: 监控 Creep 的 `ticksToLive`。当寿命即将耗尽时（< 150 ticks），自动请求孵化继任者。
- **无缝交接**: 新 Creep 孵化完成后，旧 Creep 继续工作直到自然死亡，实现岗位零停机。

### 1.3 交通管制 (Traffic Control)

- **智能寻路**: 使用自定义 `CostMatrix`，动态标记拥堵点。
- **双车道高速**: 自动规划并建造双宽道路，防止主干道拥堵。
- **死锁解除**: Creep 检测到被长时间阻挡时，会触发重新寻路或交换位置。

---

## 2. 角色体系 (Role System)

所有 Creep 遵循 **"One Role, One Job"** 原则，严格执行分工。

### 2.1 采集者 (Harvester)

- **职责**: 专职挖掘 Source 能量。
- **模式**:
  - **静态挖掘 (Static Mining)**: 若有 Hauler 存在，站在 Source 旁（或 Container 上）不动，挖出的能量直接传递给 Hauler 或落入 Container。
  - **搬运挖掘 (Carry Mining)**: 若无 Hauler（紧急情况），自挖自运。
- **数量**: 每个 Source 配备 1 名（高 WORK 部件）。

### 2.2 搬运工 (Hauler)

- **职责**: 负责能量的物流运输。
- **主动配送 (Active Delivery)**: [新增]
  - 当 Upgrader 或 Builder 能量不足且正在执行关键任务时，Hauler 会主动送货上门，而不是等待它们自己来取。
  - 优先级：Spawn/Extension > Tower > **Upgrader/Builder (直送)** > Sink Containers > Storage。
- **取货策略**:
  - 优先捡起地上的掉落资源 (Dropped Resources)，防止衰减浪费。
  - 其次从源头容器 (Mining Container) 取货。

### 2.3 升级者 (Upgrader)

- **职责**: 升级 Room Controller (RCL)。
- **智能获取**:
  - 优先捡起脚下的掉落能量。
  - 若无可用容器，会自动发出 **请求支援 (Requesting Energy)** 信号，等待 Hauler 配送。
  - 仅在极端情况下才去 Source 采集。

### 2.4 建造者 (Builder)

- **职责**: 建造建筑 (Construction Sites) 和维修 (Repair)。
- **优先级系统**:
  - 严格遵循 `PriorityModule` 的顺序：Spawn > Tower > Container > Extension > Wall > Road。
  - 即使脚下有路，也会优先去建远处的 Extension。
- **请求支援**:
  - 同 Upgrader，当能量耗尽时可请求 Hauler 补给，确保持续工作。

---

## 3. 等级与发展规划 (RCL Progression)

系统根据房间控制器等级 (RCL) 自动解锁建筑规划和人口策略。

### RCL 1: 启动期

- **目标**: 维持生存，升级到 RCL 2。
- **设施**: 无自动规划。
- **Creep**: Harvester (自挖自运), Upgrader。

### RCL 2: 基础建设

- **目标**: 建立静态挖掘体系。
- **设施**:
  - **Extensions**: 5 个（围绕 Spawn 螺旋布局）。
  - **Mining Containers**: 规划在 Source 旁（Range 1），用于缓存能量。
  - **Roads**: 自动铺设 Spawn 到 Source 的道路。
- **Creep**: 开始孵化 Hauler，Harvester 转为静态挖掘。

### RCL 3: 自动化与防御

- **目标**: 增强防御，建立物流中转。
- **设施**:
  - **Extensions**: 增加至 10 个。
  - **Tower**: Spawn 附近建造 1 个，用于维修和防守。
  - **Spawn Container**: 在 Spawn 附近建立中转仓。
  - **Controller Container**: 在控制器旁建立接收仓。
- **策略**: 激活 Tower 自动维修逻辑。

### RCL 4+: 工业化

- **目标**: 启用 Storage，进行大规模能量储备。
- **设施**:
  - **Storage**: 建成后成为物流中心。
  - **Highways**: 主干道升级为双车道。
- **策略**:
  - 激活基于 Storage 比例的经济宏观调控（70% 阈值）。
  - Upgrader 数量根据能源储备动态调整（1~3 个）。

---

## 4. 经济与宏观调控策略

为了防止 "资源耗尽 -> 无法孵化 -> 彻底死亡" 的恶性循环，系统内置了多层级保险：

### 4.1 孵化优先级 (Spawn Priority)

当能量不足时，Spawn 队列严格遵守：

1.  **Harvester (0 -> 1)**: 救命稻草，使用当前仅有的能量 (`energyAvailable`) 孵化微型版本。
2.  **Hauler (0 -> 1)**: 恢复物流。
3.  **Harvester (Full)**: 补齐采集能力。
4.  **Hauler (Full)**: 补齐运输能力。
5.  **Upgrader/Builder**: 消耗型角色最后孵化。

### 4.2 能量区间控制 (Energy Intervals)

- **危机模式 (< 30%)**: 仅维持 Controller 不降级，禁止建造，禁止孵化多余 Creep。
- **恢复模式 (30% - 70%)**: 允许少量维修，限制 Upgrader 数量。
- **繁荣模式 (> 70%)**: 允许大规模建造，增加 Upgrader 数量以加速升级。

### 4.3 动态身形 (Dynamic Body Parts)

- **Harvester/Upgrader**: 专注 WORK 部件，极少 MOVE（定点工作）。
- **Hauler**: 1:1 或 2:1 的 CARRY/MOVE 配比，确保满载移动效率。
- **紧急情况**: 当 Harvester 数量为 0 时，忽略容量限制，根据当前能量生成尽可能大的 Creep。
