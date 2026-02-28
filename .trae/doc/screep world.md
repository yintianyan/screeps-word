# Screeps World 全阶段发展指南 (The Ultimate Screeps Guide)

本指南专为 **TypeScript** 项目设计，旨在指导开发者/AI Agent  
从零构建一个自动化、高扩展性、低 CPU 消耗的 Screeps 帝国。  
指南分为三个主要阶段：早期（生存）、中期（扩张）、后期（帝国）。

## 0. agentFormat

### 0.1 contextVariables

- gameTime: Game.time
- cpuBucket: Game.cpu.bucket
- cpuUsed: Game.cpu.getUsed()
- cpuLimit: Game.cpu.limit
- creepsByName: Game.creeps
- roomsByName: Game.rooms
- memoryStats: Memory.stats
- memoryRooms: Memory.rooms
- memoryProcesses: Memory.processes
- idleCreeps: IdleCreeps[]
- taskRequests: TaskRequests[]
- taskPriority: TaskPriority
- priorityWeight: PriorityWeight
- distanceWeight: DistanceWeight
- targetId: targetId
- targetIncomingAmount: target.incomingAmount
- targetAssignedCreeps: Target.assignedCreeps
- targetSlots: Target.slots
- terrainMap: Game.map.getRoomTerrain
- distanceMap: DistanceMap
- corePlacement: CorePlacement
- stampFill: StampFill
- kernel: kernel
- pid: pid
- parentPID: parentPID
- processPid: process.pid

### 0.2 quadrupleTemplate

每条规则固定四元组：  
目标: …  
观测: …  
动作: …  
反馈: …

每条规则补充 success criterion（≤3 条）：  
⇒ …

---

## 1. 核心架构与技术规范 (Technical Foundation)

### ruleKernelLayer

目标:

1.  **Kernel Layer**: 负责进程调度、CPU 预算管理、全局异常捕获。  
    观测:  
    cpuUsed 接近 cpuLimit，或 cpuBucket 持续下降。  
    动作:  
    按优先级调度；必要时跳过非关键逻辑。  
    反馈:  
    系统在 CPU 压力下仍保持主循环可运行。

⇒ cpuUsed < cpuLimit  
⇒ cpuBucket 不持续下降  
⇒ 主循环不因单点错误中断

### ruleTaskLayer

目标:  
3. **Task Layer**: 原子的 Creep 行为（如 `Harvest`, `Transfer`），无状态。  
观测:  
creep 行为是否被拆成可组合的原子操作。  
动作:  
把复杂行为拆成 Task；Task 不持久化隐式状态。  
反馈:  
Task 可被多个 Process/Scheduler 复用。

⇒ Task 可重入且幂等或可判定失败  
⇒ Task 不依赖跨 tick 隐式状态  
⇒ Task 可被调度器重分配

### ruleDirectoryStructure

目标:

### 0.1 目录结构标准

观测:  
新功能是否能落到单一目录职责。  
动作:  
遵循既定目录结构放置文件与依赖引用。  
反馈:  
依赖方向稳定，模块可被替换与测试。

⇒ 新模块能明确归类到既有目录  
⇒ 依赖关系不出现循环  
⇒ 入口文件可稳定调度业务模块

```text
├── main.ts # 全局 Loop 入口
├── config.ts # 全局配置 (Creep Body, 数量上限)
├── core/ # 核心系统
│ ├── ErrorMapper.ts # SourceMap 映射
│ ├── Memory.ts # 内存管理 (GC)
│ ├── Kernel.ts # [新增] 操作系统内核 (CPU调度)
│ ├── Scheduler.ts # [新增] 任务调度器
│ └── Process.ts # [新增] 进程基类与接口定义
├── modules/ # 功能模块
│ ├── Planner/ # [新增] 基地布局模块
│ │ ├── Layouts.ts # 布局模板 (Bunker, Stamp)
│ │ └── Build.ts # 自动建造逻辑
│ ├── Spawner.ts # 孵化队列系统
│ ├── Tower.ts # 防御塔逻辑
│ ├── Link.ts # 能量传输网络
│ ├── Lab.ts # 化合物反应
│ ├── Terminal.ts # 市场交易与资源平衡
│ └── Observer.ts # 侦查逻辑
├── roles/ # Creep 角色逻辑 (Legacy)
│ ├── Base/ # 基础角色 (Harvester, Upgrader, Builder)
│ ├── Logistics/ # 物流角色 (Miner, Hauler, Distributor)
│ ├── Remote/ # 外矿角色 (Reserver, Scout, RemoteHarvester)
│ └── Military/ # 军事角色 (Defender, Attacker, Healer)
├── tasks/ # [新增] 原子任务定义
│ ├── HarvestTask.ts
│ ├── TransferTask.ts
│ └── UpgradeTask.ts
└── utils/ # 工具函数
```

### ruleTypeSystem

目标:

### 0.2 类型系统 (Type System)

必须扩展标准接口以获得类型提示：  
观测:  
TS 是否能对 Memory 字段提供类型提示。  
动作:  
定义 `CreepMemory` 与 `RoomMemory`，并保持字段稳定。  
反馈:  
业务代码能在编译期发现字段缺失或类型错误。

⇒ Memory 字段有稳定的类型提示  
⇒ 关键字段不因类型漂移导致运行时报错  
⇒ 接口定义可跨模块复用

```typescript
interface CreepMemory {
  role: Role;
  room: string;
  working: boolean;
  taskId?: string; // 当前任务 ID
  targetId?: Id<any>; // 缓存目标 ID
  _move?: MoveData; // 寻路缓存
}

interface RoomMemory {
  stage: number; // 当前房间发展阶段 (1-8)
  sources: { [id: string]: SourceData }; // 能量源缓存 (位置, 容器ID)
  links: { [id: string]: LinkType }; // Link 类型 (Source, Storage, Controller)
}
```

---

## 2. 阶段发展 (RCL Roadmap)

### ruleEarlyObjectives

目标:

## 第一阶段：生存与奠基 (Early Game: RCL 1-3)

### 1.1 目标设定 (Objectives)

观测:  
controller.level 与基础设施缺口。  
动作:  
按目标逐项推进：  
反馈:  
阶段目标可量化验收。

⇒ RCL 1-3 目标可逐条达成  
⇒ 能量循环不被升级/建造中断  
⇒ NPC Invader 事件可被处理

- **RCL 1**: 存活。保证 Spawn 即使在能量耗尽时也能恢复生产。
- **RCL 2**: 建立 5 个 Extensions，开始铺设沼泽道路。
- **RCL 3**: 建造 Tower 防御，部署 Container 进行“静态开采”。

### ruleEmergencyMode

目标:

1.  **紧急恢复模式 (Emergency Mode)**:  
    观测:

- 检测：当 Creep 总数 < 2 时触发。  
  动作:
- 行为：忽略所有 Body 配置，仅生产 `[WORK, CARRY, MOVE]` (200能量) 的微型 Creep。
- 任务：仅采集能量 -> 填充 Spawn。  
  反馈:  
  全灭后可自救，避免死档。

⇒ 从 0 creep 恢复到可持续生产  
⇒ Spawn 能量可回到孵化阈值  
⇒ 恢复后可回到常规策略

### ruleStaticHarvesting

目标:  
2. **静态开采 (Static Harvesting)**:  
观测:  
source 周边是否存在 Container；运输是否拥堵。  
动作:

- **Miner**: 固定在 Source 旁边的 Container 上，  
  只负责挖掘 (`harvest`)，不移动。  
  Body: `5 WORK + 1 MOVE` (RCL 2+)。
- **Hauler**: 负责从 Container 搬运能量到 Spawn/Extension/Controller。  
  反馈:  
  采集与运输解耦，能量流更稳定。

⇒ Miner 平均移动次数接近 0  
⇒ Container 不长期满溢  
⇒ Spawn/Extension 不长期缺能量

### ruleEarlyRoles

目标:

### 1.3 角色配置 (Roles)

观测:  
build/upgrade/defense 的短板位置。  
动作:  
按角色职责分配行动：  
反馈:  
角色行为可预测，可调参。

⇒ Harvester 能维持能量循环  
⇒ Upgrader 能持续推进 controller  
⇒ Builder 能优先完成关键建筑

- `Harvester` (RCL 1): 采集 -> 运送 (通用型)。
- `Upgrader`: 从 Source/Container 取能量 -> 升级控制器。
- `Builder`: 优先级：Tower > Extension > Road > Wall (低血量)。

### ruleEarlyKpis

目标:

### 1.4 成功指标 (KPIs)

观测:  
死亡率、升级中断、invader 处理耗时。  
动作:  
对照清单验收：  
反馈:  
清单满足表示可进入中期。

⇒ KPI 连续满足 500 tick  
⇒ KPI 失败可定位到具体模块  
⇒ 修复后 KPI 可回归

- [ ] 房间内无 Creep 意外死亡（寿命结束除外）。
- [ ] Controller 升级从未中断（Upgrader 始终有能量）。
- [ ] 遭遇 NPC Invader 时，Tower 能在 10 tick 内将其消灭。

### ruleMidObjectives

目标:

## 第二阶段：自动化与扩张 (Mid Game: RCL 4-6)

### 2.1 目标设定 (Objectives)

观测:  
storage/link/extractor/terminal 的可建与缺口。  
动作:  
按目标逐项推进：  
反馈:  
房间进入可扩张、可防御、可交易态。

⇒ Storage 储量可长期上升  
⇒ 外矿链路可持续运行  
⇒ CPU 与 bucket 维持健康

- **RCL 4**: 建造 **Storage** (关键节点)。  
  所有能量流向改为：  
  Source -> Container -> Hauler -> Storage。
- **RCL 5**: 启用 **Link**，减少 Source 到 Storage 的搬运成本。
- **RCL 6**: 开启 **Extractor** 采集矿物 (Mineral)，利用 Terminal 换取 Credits。
- **外矿 (Remote Mining)**: 占领邻近房间的 Source。

### ruleCentralLogistics

目标:

1.  **中央物流系统 (Central Logistics)**:  
    观测:  
    storage 是否成为能量收敛点。  
    动作:

- **Storage** 成为心脏。
- **Distributor (分发者)**: 专职负责从 Storage 取出能量 ->  
   填满 Spawn/Extension/Tower。  
   Body: `CARRY` + `MOVE` (1:1)。  
  反馈:  
  基地内部补给不依赖随机搬运。

⇒ Spawn/Extension 平均缺能量 tick 降低  
⇒ Tower 能量保持在可防御阈值  
⇒ Distributor 目标切换不频繁

### ruleLinkNetwork

目标:  
2. **Link 网络**:  
观测:  
长距离搬运是否成为瓶颈。  
动作:

- `SourceLink`: source 旁边，存满就发送。
- `StorageLink`: storage 旁边，接收能量。
- `ControllerLink`: controller 旁边，接收能量供 Upgrader 使用。  
  反馈:  
  搬运成本下降，升级不中断。

⇒ SourceLink 不长期满  
⇒ StorageLink 输入稳定  
⇒ ControllerLink 支撑升级不中断

### ruleRemoteMining

目标:  
3. **外矿运营 (Remote Mining)**:  
观测:  
目标房间安全性与收益。  
动作:

- **Scout**: 探测邻近房间，判断 Source 数量和是否安全。
- **Reserver**: 对中立房间控制器使用 `reserveController`，增加能量回复速度至 3000。
- **RemoteHarvester**: 去隔壁房间挖矿。
- **RemoteHauler**: 长途运输 (需要计算路程与 Carry 部件的比例)。
- _风险控制_: 检测到 Invader 时，所有外矿 Creep 撤回主房或避难。  
  反馈:  
  外矿链路可在风险下自动退避与恢复。

⇒ 外矿能量净流入为正  
⇒ invader 出现时损失可控  
⇒ 撤回后能自动恢复外矿

### ruleMidRoles

目标:

### 2.3 角色配置 (Roles)

观测:  
link/storage/remote 的瓶颈位置。  
动作:  
按职责补齐角色：  
反馈:  
角色数量与 body 可随环境调整。

⇒ Miner 产能与运输匹配  
⇒ Distributor 供能优先级有效  
⇒ 外矿角色可按距离扩缩容

- `Miner`: 此时应具备 Link 传输能力。
- `Distributor`: 基地内部的高效搬运工。
- `RemoteHarvester/Hauler`: 外矿专用。
- `MineralMiner`: 采集 Ut/K/L 等矿物。

### ruleMidKpis

目标:

### 2.4 成功指标 (KPIs)

观测:  
storage、外矿数量、CPU。  
动作:  
对照清单验收：  
反馈:  
清单满足表示可进入后期。

⇒ Storage > 100k 可维持 2000 tick  
⇒ 外矿至少 1 条链路稳定  
⇒ cpuBucket 不低于 500

- [ ] Storage 储量稳定增长 (目标 > 100k)。
- [ ] 至少运营 1-2 个外矿房间。
- [ ] CPU 使用率在 Bucket 满载时保持在 20 以下。

### ruleLateObjectives

目标:

## 第三阶段：帝国与飞升 (Late Game: RCL 7-8)

### 3.1 目标设定 (Objectives)

观测:  
controller.level、多房间数量、资源链路成熟度。  
动作:  
引入孵化扩容、Power、Boost、多房间管理。  
反馈:  
帝国可在多事件并发下稳定运行。

⇒ 关键资源链路可自愈  
⇒ 战斗与经济可并行  
⇒ 多房间可统一调度

- **RCL 7**: 建造第 2 个 Spawn，大规模生产。建造 Factory。
- **RCL 8**: 满级控制器。通过 Power Spawn 处理 Power。
- **多房间管理**: 自动殖民 (Claim) 新房间并引导其快速启动。
- **Lab 反应**: 自动合成 T3 强化剂 (Boosts)。

### ruleSpawnTaskQueue

目标:

1.  **Spawn Task Queue (高级孵化)**:  
    观测:  
    多 Spawn 是否存在排队与闲置不均。  
    动作:

- 多 Spawn 协同：主房间可能有 3 个 Spawn，需要负载均衡。  
  反馈:  
  孵化吞吐稳定，且不会单点阻塞。

⇒ Spawn 利用率接近均衡  
⇒ 紧急角色能抢占队列  
⇒ 孵化失败率下降

### ruleLabAutomation

目标:  
2. **Lab 自动化**:  
观测:  
原料是否可从 Terminal 自动补齐。  
动作:

- 输入：定义目标化合物 (e.g., `XGHO2`)。
- 逻辑：自动从 Terminal 提取原料 -> 填入 Source Labs -> 运行 `runReaction` -> 产物移回 Terminal。  
  反馈:  
  Lab 反应链路可持续产出。

⇒ 目标化合物产量稳定  
⇒ 原料不足时可暂停与恢复  
⇒ 产物能回收到 Terminal

### ruleBoostSystem

目标:  
3. **Boost 系统**:  
观测:  
关键 creep 是否需要强化。  
动作:

- 在孵化重要 Creep (如 War Creep) 前，通过 Lab 对其进行强化。  
  反馈:  
  关键 creep 达到预期性能上限。

⇒ Boost 消耗与收益可量化  
⇒ Boost 失败可回退重试  
⇒ Boost 不影响核心经济链

### ruleNukeDefense

目标:  
4. **Nuke Defense**:  
观测:  
是否发现核弹 (Nuke) 锁定。  
动作:

- 当发现核弹 (Nuke) 锁定，自动在该位置通过 Rampart 堆叠数百万 hits 的防御。  
  反馈:  
  核打击风险被转化为可控损失。

⇒ 关键格 rampart hits 达到阈值  
⇒ Nuke 命中后核心结构存活  
⇒ 防御投入不致经济崩溃

### ruleLateRoles

目标:

### 3.3 角色配置 (Roles)

观测:  
资源在 Terminal/Storage/Link/Lab 之间的分布。  
动作:  
引入管理型 creep 与 PowerCreep：  
反馈:  
资源平衡与系统 buff 可持续。

⇒ 资源不会长期卡在单一节点  
⇒ Lab 补给不依赖人工  
⇒ PowerCreep buff 可控触发

- `Manager`: 负责 Terminal/Storage/Link 之间的资源平衡 (只在 1 格范围内移动)。
- `LabCarrier`: 负责 Lab 原料填充。
- `PowerCreep`: 英雄单位，负责 `operateSpawn`, `operateFactory`,  
  `operateExtension` 等高效 buff。

**输入**: `IdleCreeps[]`, `TaskRequests[]`

### ruleLateKpis

目标:

### 3.4 成功指标 (KPIs)

观测:  
GCL、Boost 产线、防御成功率。  
动作:  
对照清单验收：  
反馈:  
清单满足表示进入可运营帝国态。

⇒ GCL (Global Control Level) 持续升级  
⇒ 拥有 T3 Boost 生产线  
⇒ 能够自动防御多方位的进攻

- [ ] GCL (Global Control Level) 持续升级。
- [ ] 拥有 T3 Boost 生产线。
- [ ] 能够自动防御多方位的进攻。

---

## 3. 性能优化与错误排查 (Optimization & Troubleshooting)

### ruleCpuFrequencyControl

目标:

1.  **频率控制**: 不要每 tick 都运行所有逻辑。  
    观测:  
    cpuUsed 接近 cpuLimit。  
    动作:

- 建筑扫描: `if (Game.time % 100 === 0)`
- 塔寻找目标: `if (Game.time % 5 === 0)`  
  反馈:  
  关键逻辑优先获得 CPU。

⇒ cpuUsed 峰值降低  
⇒ 非关键逻辑不会饿死关键逻辑  
⇒ cpuBucket 逐步回升

### rulePathCaching

目标:  
2. **寻路缓存 (Path Caching)**:  
观测:  
moveTo 寻路成为 CPU 热点。  
动作:

- 使用 `Memory.rooms[name].paths` 缓存常用路径 (如 Source 到 Storage)。
- 避免在循环中使用 `moveTo`，改用 `moveByPath`。
- **Global Cache**: 利用全局变量 `global` 缓存路径对象，避免 `JSON.parse` 开销。  
  反馈:  
  寻路成本从每 tick 转为低频更新。

⇒ moveTo 调用频率下降  
⇒ 路径命中率上升  
⇒ JSON.parse 开销降低

### ruleObjectReference

目标:  
3. **对象引用**:  
观测:  
频繁 `Game.getObjectById` 增加 CPU。  
动作:

- 不要每 tick 都 `Game.getObjectById`，尽量在内存中复用数据，只在对象失效时更新。  
  反馈:  
  CPU 使用更平滑。

⇒ getObjectById 调用次数下降  
⇒ 目标失效时能自动恢复  
⇒ 不引入跨 tick 脏引用

### ruleErrNotEnoughResources

目标:

1.  **ERR_NOT_ENOUGH_RESOURCES**:  
    观测:  
    行为返回 `ERR_NOT_ENOUGH_RESOURCES`。  
    动作:

- 检查：Creep 是否找错了容器？Storage 是否为空？
- 解决：添加状态检查，如果没有能量源，转为待机模式，避免空跑消耗 CPU。  
  反馈:  
  资源紧张时进入可控退化。

⇒ 空跑次数下降  
⇒ 资源恢复后能自动回到正常状态  
⇒ CPU 不因重试而暴涨

### ruleErrNoPath

目标:  
2. **ERR_NO_PATH**:  
观测:  
行为返回 `ERR_NO_PATH`。  
动作:

- 检查：Creep 是否被困住了？目标是否被 Wall 围死？
- 解决：引入 `ignoreCreeps: false` 进行重新寻路；检查构造物是否阻塞了关键路口。  
  反馈:  
  堵塞可被发现并自愈或报警。

⇒ stuck tick 数下降  
⇒ 重新寻路成功率上升  
⇒ 关键路口阻塞可被定位

### ruleGlobalReset

目标:  
3. **Global Reset**:  
观测:

- 现象：代码重新编译，堆内存清空。  
  动作:
- 原因：代码更新或 CPU 超时。
- 应对：将关键数据存入 `Memory` 而不是全局变量；在 `main` 循环开始时初始化堆内存缓存。  
  反馈:  
  reset 后系统自动恢复。

⇒ reset 后 10 tick 内恢复核心功能  
⇒ Memory 中存在恢复所需关键字段  
⇒ 全局缓存能被重建

### ruleAutoLayoutMarker

目标:

### 2.3 基地自动布局 (Auto-Layout)

观测:  
布局策略是否与 RCL 推进同步。  
动作:  
与 6. 自动化基地布局 (Auto-Base Planning) 对齐。  
反馈:  
布局模块可被 Planner 进程调用。

⇒ Planner 能产出 build intent  
⇒ build intent 可被 Builder 执行  
⇒ 基地结构逐步收敛

---

## 4. 进阶架构改进方案 (Advanced Architecture Improvement Plan)

### ruleAdvancedPlanGoal

目标:  
为了解决现有指南在实现细节和系统架构上的不足，  
本节提供一套完整的改进方案，旨在构建一个  
**任务驱动 (Task-Driven)** 和 **操作系统化 (OS-Based)** 的智能体系统。  
观测:  
复用率、耦合度、CPU 与 Memory 成本。  
动作:  
按 4.1-4.3 分步演进。  
反馈:  
系统从 Role-Based 平滑迁移到 Task/Process-Based。

⇒ 角色逻辑重复率下降  
⇒ 调度与执行解耦  
⇒ 性能指标可被监控

### ruleGuideGaps

目标:

### 5.1 现有指南的不足分析

观测:  
接口缺失、状态机缺失、算法缺失。  
动作:  
保留并明确以下不足：  
反馈:  
输出可直接转为实现任务。

⇒ config.ts 具备可扩展数据结构  
⇒ 状态机包含异常态  
⇒ 目标选择包含负载均衡

1.  **实现细节缺失**:
    - **缺乏具体的配置接口**: `config.ts` 未定义具体的数据结构，导致难以扩展。
    - **状态机逻辑过于简单**: 仅描述了 `working` 状态切换，未涵盖异常状态（如 `Stuck`, `Idle`）的处理。
    - **缺少具体算法**: 如“寻找最近的 Source”未考虑负载均衡，可能导致所有 Creep 拥堵在同一个 Source。
2.  **架构局限性**:
    - **强耦合**: `Role` 直接包含所有逻辑，导致代码复用率低  
      （例如 `Harvester` 和 `RemoteHarvester` 有大量重复代码）。
    - **缺乏统一调度**: 每个 Creep 自行决定做什么，容易造成资源竞争和 CPU 浪费。
3.  **最佳实践缺失**:
    - 未提及 **Memory Serialization** 开销的优化方案（如使用 `RawMemory` 或 `Global Heap`）。
    - 未提及 **Bucket Control**（CPU 桶管理），在 CPU 不足时应主动跳过非关键任务。

### ruleArchitectureRefactoring

目标:

### 5.2 架构优化建议 (Architecture Refactoring)

观测:  
是否存在跨域逻辑混杂与循环依赖。  
动作:  
采用 **OS 内核 (Kernel)** + **进程 (Process)** 的设计模式：  
反馈:  
核心调度与业务逻辑解耦。

⇒ Process 可独立启停  
⇒ Kernel 可统一处理错误  
⇒ 模块可被单测替换

#### A. 模块化与解耦 (Modularization)

采用 **OS 内核 (Kernel)** + **进程 (Process)** 的设计模式：

- **Kernel**: 负责 CPU 预算管理、进程调度、错误捕获。
- **Process**: 具体的业务逻辑单元（如 `RoomPlannerProcess`, `LogisticsProcess`）。
- **Dependency Injection**: 通过依赖注入管理模块，方便单元测试。

#### B. 性能瓶颈解决方案

1.  **Global Heap Caching**:
    - **问题**: `Memory` 对象在每 tick 开始时会被 JSON 反序列化，消耗大量 CPU。
    - **方案**: 将静态数据（如 Source 位置、路径缓存、配置）  
      存储在 `global` 对象中，仅在 `Global Reset` 时重建。
2.  **PathFinder Optimization**:
    - 使用 `PathFinder.search` 代替 `moveTo`。
    - 实现 `CostMatrix` 缓存：将房间的地形、建筑、Road 数据序列化存储，避免重复计算。

- **Focus**: 保持 Spawn 存活。

### ruleTaskSchedulingSystem

目标:

### 5.3 任务调度机制设计 (Task Scheduling System)

观测:  
任务分配是否造成拥堵与空跑。  
动作:  
将 Creep 从“决策者”转变为“执行者”。  
反馈:  
调度端可统一调参并扩展。

⇒ 决策集中在 Scheduler  
⇒ 执行集中在 Task  
⇒ 资源争抢事件减少

#### A. 核心概念

- **Task (任务)**: 一个原子的操作单元（如 `Pickup(id)`, `Transfer(id)`）。
- **Job (作业)**: 一系列 Task 的有序组合  
  （如 `RefillExtension = [Pickup(Storage), Transfer(Extension)]`）。
- **Scheduler (调度器)**: 负责分配 Job 给空闲的 Creep。

#### B. 任务优先级管理策略 (Priority Management)

采用 **加权优先级队列 (Weighted Priority Queue)**：

- **Critical (100)**: `EmergencyHarvest`  
  能量 < 300，且无 Creep 存活
- **High (80)**: `Defense`  
  Tower 攻击，Rampart 紧急维修 (< 1000 hits)
- **Medium (50)**: `RefillSpawn`  
  填充 Spawn 和 Extension
- **Normal (30)**: `Upgrade`  
  升级控制器
- **Low (10)**: `Build`  
  建造非关键建筑

#### C. 资源分配与负载均衡算法 (Load Balancing)

**算法公式**:

Score = (TaskPriority \* PriorityWeight) / (Distance + DistanceWeight);

````

- **逻辑**:
  1.  收集当前房间内所有待处理的 Request（如 Extension 缺能量）。
  2.  计算每个 Idle Creep 到每个 Request 的 `Score`。
  3.  使用 **匈牙利算法 (Hungarian Algorithm)** 或 **贪心算法** 进行最佳匹配。
  4.  **防拥堵**: 对每个 Source/Container 维护一个 `slots` 计数器，
  当 `assignedCreeps >= slots` 时，不再分配新 Creep。

#### D. 任务状态监控与异常处理

定义 Task 接口：

```typescript
interface ITask {
  id: string;
  type: TaskType;
  targetId: string;
  creeps: string[]; // 分配给该任务的 Creep 列表
  status: "pending" | "running" | "completed" | "failed";
}
````

**异常处理流程**:

1.  **PathBlocked**: 若 Creep 连续 3 tick 位置未变，  
    触发 `Stuck` 处理 -> 重新寻路 (`ignoreCreeps: false`)。
2.  **TargetInvalid**: 若目标消失（如 Source 枯竭、Container 被毁），  
    立即终止任务，将 Creep 重置为 `Idle`。
3.  **Timeout**: 若任务执行时间超过预期（`estimatedTicks * 1.5`），强制取消并重新分配。

#### E. 性能指标定义 (Metrics)

在 `Memory.stats` 中记录以下关键指标，用于 Grafana 可视化：

- `cpu.bucket`: 当前 CPU 桶剩余量。
- `cpu.usage`: 当前 tick CPU 使用量。
- `cpu.scheduler`: 调度系统消耗的 CPU。
- `room.energyAvailable`: 房间当前能量。
- `room.rcl_progress`: 控制器升级进度百分比。

---

## 5. 自动化基地布局 (Auto-Base Planning)

### ruleLayoutStrategy

目标:

### 6.1 布局策略选择

观测:  
地形是否支持 Stamp 或 Bunker。  
动作:  
按策略选择：  
反馈:  
布局可复用并可扩展。

⇒ Stamp 可重复放置  
⇒ Bunker 在合适地形下可成型  
⇒ 布局不阻塞早期升级

- **Stamp Layout (邮票式)**: 推荐。将建筑分组为固定的小模块 (Stamp)，  
  如 `ExtensionBlock`, `LabBlock`, `TowerBlock`。
  - 优点：灵活性高，适应不规则地形。
  - 实现：定义 `LayoutTemplate` (如 2x2 Extension + 1 Road)。
- **Bunker Layout (地堡式)**: 适合开阔地形。以 Spawn/Storage 为中心，层层包裹。
  - 缺点：对地形要求高，RCL 低时维护成本高。

### ruleDistanceTransform

目标:

### 6.2 自动布局算法 (Distance Transform)

观测:  
DistanceMap 的最大值位置。  
动作:  
按步骤执行：  
反馈:  
核心点与扩展区可稳定生成。

⇒ corePlacement 可被稳定计算  
⇒ stampFill 可覆盖 Extension 数量  
⇒ 路网可随布局生成

1.  **Terrain Analysis**: 使用 `Game.map.getRoomTerrain` 获取地形数据。
2.  **Distance Transform**: 计算每个点到最近墙壁的距离。距离越大，越适合放置核心建筑 (Storage/Spawn)。
3.  **Flood Fill**: 从核心点开始泛洪，寻找最近的空地放置 Extension。

### ruleBuildPriorityQueue

目标:

### 6.3 建筑优先级队列

观测:  
controller.level 与当前可建数量。  
动作:  
按表推进：  
反馈:  
建造与 RCL 同步。

⇒ 每个 RCL 的关键建筑可落地  
⇒ 不会过早建造高成本结构  
⇒ 建造优先级可被 Planner 复用

| RCL | 建筑类型    | 数量 | 布局逻辑                         |
| :-- | :---------- | :--- | :------------------------------- |
| 1   | `Spawn`     | 1    | 靠近 Source (距离 < 5)，避开出口 |
| 2   | `Extension` | 5    | 围绕 Spawn 建造，呈十字或 X 型   |
| 3   | `Tower`     | 1    | 靠近 Spawn，覆盖所有关键入口     |
| 4   | `Storage`   | 1    | 位于基地几何中心，作为物流枢纽   |
| 5   | `Link`      | 2    | Source 旁一个，Storage 旁一个    |

---

## 6. 进程接口与生命周期 (Process Interface)

### ruleProcessInterface

目标:

### 7.1 进程接口定义

观测:  
进程是否需要 pid、parentPID、priority、status。  
动作:  
保留以下片段供 agent 进一步实现：  
反馈:  
进程最小字段与行为被固定。

⇒ 进程能被唯一定位(pid)  
⇒ 进程支持挂起与终止  
⇒ 进程字段能序列化到 Memory

```text
if (this.creep.store.getUsedCapacity() === 0) {
export interface IProcess {
pid: string; // 进程唯一 ID
parentPID: string; // 父进程 ID
priority: number; // 优先级 (0-100)
status: ProcessStatus; // 运行状态

run(): void; // 每 tick 执行的主逻辑
sleep(ticks: number): void; // 休眠 N ticks
suspend(): void; // 挂起 (不占用 CPU，直到被唤醒)
kill(): void; // 终止进程，清理内存
}

export enum ProcessStatus {
Running = 0,
Sleeping = 1,
Suspended = 2,
Dead = 3,
}

```

````

### ruleIpc

目标:
### 7.2 进程通信机制 (IPC)
观测:
消息是否需要跨 tick 持久化与 tick 内高性能通道。
动作:
按以下约束使用：
反馈:
进程间可交换 SpawnRequest 与 EnemyDetected 等事件。

⇒ Memory IPC 可跨 tick 读取
⇒ Heap IPC 单 tick 低开销
⇒ 消息能被消费并清理

- **Memory IPC**: 用于跨 tick 通信。
  - `ProcessMemory`: 每个进程在 `Memory.processes[pid]` 中拥有独立空间。
- **Heap IPC**: 用于 tick 内通信 (高性能)。
  - `global.kernel.sendMessage(targetPID, message)`
  - 消息类型: `SpawnRequest`, `TaskComplete`, `EnemyDetected`。

### ruleCoreProcesses

目标:
### 7.3 核心进程列表
观测:
每个进程是否对应到明确职责域。
动作:
按列表实现：
反馈:
核心业务链路可被进程集合驱动。

⇒ 进程列表覆盖核心业务链路
⇒ 每个进程可单独启停
⇒ 进程之间通过 IPC 协作

1.  **RoomPlannerProcess**: 负责计算建筑位置，发布 `BuildTask`。
2.  **LogisticsProcess**: 监控能量流，调度 `Hauler` 和 `Distributor`。
3.  **DefenseProcess**: 监控敌情，控制 Tower 和 `Defender`。
4.  **ColonyProcess**: 负责外矿占领和新房间启动。

```text
    this.moveTo(this.memory.sourceId);
    this.harvest(target);
  } else {
````

---

## 7. 业务逻辑阻塞点与解决方案 (Business Logic Blockers)

### ruleResourceReservation

目标:

### 8.1 资源争抢与死锁 (Resource Contention)

观测:  
多个 creep 指向同一资源目标导致白跑或排队。  
动作:  
按方案预定资源并检查 incomingAmount。  
反馈:  
资源争抢转为预定式分配。

⇒ 白跑次数下降  
⇒ incomingAmount 可正确回收  
⇒ 资源目标分配更均匀

- **问题**: 两个 Hauler 同时前往同一个能量堆 (Dropped Resource)，  
  导致一个白跑；或者多个 Upgrader 同时从 Container 取能量，  
  导致瞬间抽干，后面的排队等待。
- **解决方案 (Resource Reservation)**:
  - Creep 在出发前必须先 `reserve(targetId, amount)`。
  - `target.incomingAmount` 属性用于记录即将到达的存储量。
  - 逻辑检查：  
     `if (target.store + target.incomingAmount > target.capacity)  
chooseAnotherTarget()`。

### ruleTrafficManager

目标:

### 8.2 Creep 堵路与对穿 (Traffic Management)

观测:  
狭窄通道出现对穿与堵塞。  
动作:  
按 Swap 协议让路或交换位置。  
反馈:  
局部拥堵可被消化。

⇒ 对穿成功率上升  
⇒ 道路瓶颈处停滞减少  
⇒ 关键运输路径可持续通行

- **问题**: 在狭窄通道（如 Source 旁边的单行道），采矿的 Creep 挡住了运输的 Creep，导致全线瘫痪。
- **解决方案 (Traffic Manager)**:
  - 不要使用 `ignoreCreeps: true` 进行移动（除非确信路径畅通）。
  - **对穿协议 (Swap Logic)**: 当 Creep A 撞上 Creep B，且 A 的意图是移动，B 是空闲或移动中：
    - 若 B 空闲：B 随机移动一格让路。
    - 若 B 也在移动且方向相反：A 和 B 交换位置 (swap)。

### ruleHysteresis

目标:

### 8.3 状态机抖动 (State Thrashing)

观测:  
creep 在 working/refueling 间频繁切换。  
动作:  
引入迟滞阈值。  
反馈:  
状态切换次数下降，任务完成率上升。

⇒ 状态切换频率下降  
⇒ 平均有效工作 tick 上升  
⇒ 能量利用率提升

- **问题**: Creep 在 `Working` 和 `Refueling` 状态间频繁切换  
  （例如：刚吸了 10 点能量就去工作，工作完又回来吸 10 点）。
- **解决方案 (Hysteresis)**:
  - 引入**迟滞阈值**:
    - `Refueling` -> `Working`: 必须填满 100% (或 > 90%)。
    - `Working` -> `Refueling`: 必须完全空 0%。

### ruleMemoryBasedRouting

目标:

### 8.4 缺乏视野时的逻辑中断 (Blind Execution)

观测:  
roomsByName[targetRoom] 不存在导致崩溃。  
动作:  
依赖 Memory.rooms[targetRoom] 缓存并使用 RoomPosition。  
反馈:  
跨房间逻辑在无视野时保持安全。

⇒ 无视野时不访问 roomsByName[targetRoom]  
⇒ Scout 刷新缓存成功率稳定  
⇒ 跨房移动不触发崩溃

- **问题**: 想要派兵去隔壁房间，但没有那个房间的 `Game.rooms[name]` 对象，  
  导致代码报错 `Cannot read property 'find' of undefined`。
- **解决方案 (Memory-Based Routing)**:
  - 对于视野外的房间，依赖 `Memory.rooms[targetRoom]` 中的缓存数据（如 Source 位置）。
  - 移动逻辑不应依赖 `Room` 对象，而是依赖 `RoomPosition`。
  - 使用 `Scout` 进程定期刷新缓存。

### ruleKernelPanicIsolation

目标:

### 4.3 异常处理 (Error Handling)

**Rule**: 永远不要让一个 Creep 的错误导致整个 Loop 崩溃。  
观测:  
异常是否从单个 creep/process 冒泡到 main loop。  
动作:  
使用 try/catch 进行隔离与通知。  
反馈:  
系统在异常下仍可继续运行。

⇒ main loop 不因单点异常终止  
⇒ 异常可定位到 stack  
⇒ Game.notify 可触发告警

```typescript
try {
  kernel.run();
} catch (e) {
  console.log(`KERNEL PANIC: ${e.stack}`);
  Game.notify(`KERNEL PANIC: ${e.message}`);
}
```

---

## 8. 性能指标 (Metrics)

### ruleMetricsGuardrails

目标:  
监控以下指标以确保系统健康：  
观测:  
cpuBucket 与 RawMemory 使用量。  
动作:  
按阈值执行熔断。  
反馈:  
系统在高负载下可退化运行。

⇒ cpu.bucket > 500  
⇒ RawMemory < 2MB  
⇒ 熔断下关键进程仍可运行

- `cpu.bucket`: 必须保持 > 500。若 < 500，停止所有非关键进程 (Construction, RemoteMining)。
- `memory.usage`: RawMemory 大小应 < 2MB。
- `gcl.progress`: 每 tick 平均进度。

---

## originalTextPreserved

以下为重构前文本的完整保留版本（零缺失）。  
仅做最小粒度换行（≤80 字）以便 agent 逐段解析。

## 0. 核心架构与技术规范 (Technical Foundation)

1.  **Kernel Layer**: 负责进程调度、CPU 预算管理、全局异常捕获。

### 0.1 目录结构标准

3.  **Task Layer**: 原子的 Creep 行为（如 `Harvest`, `Transfer`），无状态。

├── main.ts # 全局 Loop 入口
├── config.ts # 全局配置 (Creep Body, 数量上限)
├── core/ # 核心系统
│ ├── ErrorMapper.ts # SourceMap 映射
│ ├── Memory.ts # 内存管理 (GC)
│ ├── Kernel.ts # [新增] 操作系统内核 (CPU调度)
│ ├── Scheduler.ts # [新增] 任务调度器
│ └── Process.ts # [新增] 进程基类与接口定义
├── modules/ # 功能模块
│ ├── Planner/ # [新增] 基地布局模块
│ │ ├── Layouts.ts # 布局模板 (Bunker, Stamp)
│ │ └── Build.ts # 自动建造逻辑
│ ├── Spawner.ts # 孵化队列系统
│ ├── Tower.ts # 防御塔逻辑
│ ├── Link.ts # 能量传输网络
│ ├── Lab.ts # 化合物反应
│ ├── Terminal.ts # 市场交易与资源平衡
│ └── Observer.ts # 侦查逻辑
├── roles/ # Creep 角色逻辑 (Legacy)
│ ├── Base/ # 基础角色 (Harvester, Upgrader, Builder)
│ ├── Logistics/ # 物流角色 (Miner, Hauler, Distributor)
│ ├── Remote/ # 外矿角色 (Reserver, Scout, RemoteHarvester)
│ └── Military/ # 军事角色 (Defender, Attacker, Healer)
├── tasks/ # [新增] 原子任务定义
│ ├── HarvestTask.ts
│ ├── TransferTask.ts
│ └── UpgradeTask.ts
└── utils/ # 工具函数

```

### 0.2 类型系统 (Type System)

必须扩展标准接口以获得类型提示：

## 2. 核心算法与逻辑 (Algorithms & Logic)
interface CreepMemory {
  role: Role;
  room: string;
  working: boolean;
  taskId?: string; // 当前任务 ID
  targetId?: Id<any>; // 缓存目标 ID
  _move?: MoveData; // 寻路缓存
}

interface RoomMemory {
  stage: number; // 当前房间发展阶段 (1-8)
  sources: { [id: string]: SourceData }; // 能量源缓存 (位置, 容器ID)
  links: { [id: string]: LinkType }; // Link 类型 (Source, Storage, Controller)
}
```

---

## 第一阶段：生存与奠基 (Early Game: RCL 1-3)

### 1.1 目标设定 (Objectives)

- **RCL 1**: 存活。保证 Spawn 即使在能量耗尽时也能恢复生产。
- **RCL 2**: 建立 5 个 Extensions，开始铺设沼泽道路。
- **RCL 3**: 建造 Tower 防御，部署 Container 进行“静态开采”。

### 1.2 关键机制实现

1.  **紧急恢复模式 (Emergency Mode)**:
    - 检测：当 Creep 总数 < 2 时触发。
    - 行为：忽略所有 Body 配置，仅生产 `[WORK, CARRY, MOVE]`
      (200能量) 的微型 Creep。
    - 任务：仅采集能量 -> 填充 Spawn。
2.  **静态开采 (Static Harvesting)**:
    - **Miner**: 固定在 Source 旁边的 Container 上，只负责挖掘
      (`harvest`)，不移动。Body: `5 WORK + 1 MOVE` (RCL 2+)。
    - **Hauler**: 负责从 Container 搬运能量到
      Spawn/Extension/Controller。

### 1.3 角色配置 (Roles)

- `Harvester` (RCL 1): 采集 -> 运送 (通用型)。
- `Upgrader`: 从 Source/Container 取能量 -> 升级控制器。
- `Builder`: 优先级：Tower > Extension > Road > Wall (低血量)。

### 1.4 成功指标 (KPIs)

- [ ] 房间内无 Creep 意外死亡（寿命结束除外）。
- [ ] Controller 升级从未中断（Upgrader 始终有能量）。
- [ ] 遭遇 NPC Invader 时，Tower 能在 10 tick 内将其消灭。

---

## 第二阶段：自动化与扩张 (Mid Game: RCL 4-6)

### 2.1 目标设定 (Objectives)

- **RCL 4**: 建造 **Storage** (关键节点)。所有能量流向改为：
  Source -> Container -> Hauler -> Storage。
- **RCL 5**: 启用 **Link**，减少 Source 到 Storage 的搬运成本。
- **RCL 6**: 开启 **Extractor** 采集矿物 (Mineral)，
  利用 Terminal 换取 Credits。
- **外矿 (Remote Mining)**: 占领邻近房间的 Source。

### 2.2 关键机制实现

1.  **中央物流系统 (Central Logistics)**:
    - **Storage** 成为心脏。
    - **Distributor (分发者)**: 专职负责从 Storage 取出能量 ->
      填满 Spawn/Extension/Tower。Body: `CARRY` + `MOVE` (1:1)。
2.  **Link 网络**:
    - `SourceLink`: source 旁边，存满就发送。
    - `StorageLink`: storage 旁边，接收能量。
    - `ControllerLink`: controller 旁边，接收能量供 Upgrader 使用。
3.  **外矿运营 (Remote Mining)**:
    - **Scout**: 探测邻近房间，判断 Source 数量和是否安全。
    - **Reserver**: 对中立房间控制器使用 `reserveController`，
      增加能量回复速度至 3000。
    - **RemoteHarvester**: 去隔壁房间挖矿。
    - **RemoteHauler**: 长途运输 (需要计算路程与 Carry 部件的比例)。
    - _风险控制_: 检测到 Invader 时，所有外矿 Creep 撤回主房或避难。

### 2.3 角色配置 (Roles)

- `Miner`: 此时应具备 Link 传输能力。
- `Distributor`: 基地内部的高效搬运工。
- `RemoteHarvester/Hauler`: 外矿专用。
- `MineralMiner`: 采集 Ut/K/L 等矿物。

### 2.4 成功指标 (KPIs)

- [ ] Storage 储量稳定增长 (目标 > 100k)。
- [ ] 至少运营 1-2 个外矿房间。
- [ ] CPU 使用率在 Bucket 满载时保持在 20 以下。

---

## 第三阶段：帝国与飞升 (Late Game: RCL 7-8)

### 3.1 目标设定 (Objectives)

- **RCL 7**: 建造第 2 个 Spawn，大规模生产。建造 Factory。
- **RCL 8**: 满级控制器。通过 Power Spawn 处理 Power。
- **多房间管理**: 自动殖民 (Claim) 新房间并引导其快速启动。
- **Lab 反应**: 自动合成 T3 强化剂 (Boosts)。

### 3.2 关键机制实现

1.  **Spawn Task Queue (高级孵化)**:
    - 多 Spawn 协同：主房间可能有 3 个 Spawn，需要负载均衡。
2.  **Lab 自动化**:
    - 输入：定义目标化合物 (e.g., `XGHO2`)。
    - 逻辑：自动从 Terminal 提取原料 -> 填入 Source Labs ->
      运行 `runReaction` -> 产物移回 Terminal。
3.  **Boost 系统**:
    - 在孵化重要 Creep (如 War Creep) 前，通过 Lab 对其进行强化。
4.  **Nuke Defense**:
    - 当发现核弹 (Nuke) 锁定，自动在该位置通过 Rampart 堆叠数百万 hits 的防御。

### 3.3 角色配置 (Roles)

- `Manager`: 负责 Terminal/Storage/Link 之间的资源平衡
  (只在 1 格范围内移动)。
- `LabCarrier`: 负责 Lab 原料填充。
- `PowerCreep`: 英雄单位，负责 `operateSpawn`, `operateFactory`,
  `operateExtension` 等高效 buff。
  **输入**: `IdleCreeps[]`, `TaskRequests[]`

### 3.4 成功指标 (KPIs)

- [ ] GCL (Global Control Level) 持续升级。
- [ ] 拥有 T3 Boost 生产线。
- [ ] 能够自动防御多方位的进攻。

---

## 4. 性能优化与错误排查 (Optimization & Troubleshooting)

### 4.1 CPU 优化策略

1.  **频率控制**: 不要每 tick 都运行所有逻辑。
    - 建筑扫描: `if (Game.time % 100 === 0)`
    - 塔寻找目标: `if (Game.time % 5 === 0)`
2.  **寻路缓存 (Path Caching)**:
    - 使用 `Memory.rooms[name].paths` 缓存常用路径
      (如 Source 到 Storage)。
    - 避免在循环中使用 `moveTo`，改用 `moveByPath`。
    - **Global Cache**: 利用全局变量 `global` 缓存路径对象，
      避免 `JSON.parse` 开销。
3.  **对象引用**:
    - 不要每 tick 都 `Game.getObjectById`，尽量在内存中复用数据，
      只在对象失效时更新。

### 4.2 常见错误排查

1.  **ERR_NOT_ENOUGH_RESOURCES**:
    - 检查：Creep 是否找错了容器？Storage 是否为空？
    - 解决：添加状态检查，如果没有能量源，转为待机模式，
      避免空跑消耗 CPU。
2.  **ERR_NO_PATH**:
    - 检查：Creep 是否被困住了？目标是否被 Wall 围死？
    - 解决：引入 `ignoreCreeps: false` 进行重新寻路；
      检查构造物是否阻塞了关键路口。
3.  **Global Reset**:
    - 现象：代码重新编译，堆内存清空。
    - 原因：代码更新或 CPU 超时。
    - 应对：将关键数据存入 `Memory` 而不是全局变量；
      在 `main` 循环开始时初始化堆内存缓存。

### 2.3 基地自动布局 (Auto-Layout)

## 5. 进阶架构改进方案 (Advanced Architecture Improvement Plan)

为了解决现有指南在实现细节和系统架构上的不足，
本节提供一套完整的改进方案，旨在构建一个
**任务驱动 (Task-Driven)** 和 **操作系统化 (OS-Based)** 的智能体系统。

### 5.1 现有指南的不足分析

1.  **实现细节缺失**:
    - **缺乏具体的配置接口**: `config.ts` 未定义具体的数据结构，
      导致难以扩展。
    - **状态机逻辑过于简单**: 仅描述了 `working` 状态切换，
      未涵盖异常状态（如 `Stuck`, `Idle`）的处理。
    - **缺少具体算法**: 如“寻找最近的 Source”未考虑负载均衡，
      可能导致所有 Creep 拥堵在同一个 Source。
2.  **架构局限性**:
    - **强耦合**: `Role` 直接包含所有逻辑，导致代码复用率低
      （例如 `Harvester` 和 `RemoteHarvester` 有大量重复代码）。
    - **缺乏统一调度**: 每个 Creep 自行决定做什么，
      容易造成资源竞争和 CPU 浪费。
3.  **最佳实践缺失**:
    - 未提及 **Memory Serialization** 开销的优化方案
      （如使用 `RawMemory` 或 `Global Heap`）。
    - 未提及 **Bucket Control**（CPU 桶管理），
      在 CPU 不足时应主动跳过非关键任务。

### 5.2 架构优化建议 (Architecture Refactoring)

#### A. 模块化与解耦 (Modularization)

采用 **OS 内核 (Kernel)** + **进程 (Process)** 的设计模式：

- **Kernel**: 负责 CPU 预算管理、进程调度、错误捕获。
- **Process**: 具体的业务逻辑单元（如 `RoomPlannerProcess`,
  `LogisticsProcess`）。
- **Dependency Injection**: 通过依赖注入管理模块，方便单元测试。

#### B. 性能瓶颈解决方案

1.  **Global Heap Caching**:
    - **问题**: `Memory` 对象在每 tick 开始时会被 JSON 反序列化，
      消耗大量 CPU。
    - **方案**: 将静态数据（如 Source 位置、路径缓存、配置）
      存储在 `global` 对象中，仅在 `Global Reset` 时重建。
2.  **PathFinder Optimization**:
    - 使用 `PathFinder.search` 代替 `moveTo`。
    - 实现 `CostMatrix` 缓存：将房间的地形、建筑、Road 数据
      序列化存储，避免重复计算。

- **Focus**: 保持 Spawn 存活。

### 5.3 任务调度机制设计 (Task Scheduling System)

这是本方案的核心，将 Creep 从“决策者”转变为“执行者”。

#### A. 核心概念

- **Task (任务)**: 一个原子的操作单元（如 `Pickup(id)`, `Transfer(id)`）。
- **Job (作业)**: 一系列 Task 的有序组合
  （如 `RefillExtension = [Pickup(Storage), Transfer(Extension)]`）。
- **Scheduler (调度器)**: 负责分配 Job 给空闲的 Creep。

#### B. 任务优先级管理策略 (Priority Management)

采用 **加权优先级队列 (Weighted Priority Queue)**：

- **Critical (100)**: `EmergencyHarvest`  
  能量 < 300，且无 Creep 存活
- **High (80)**: `Defense`  
  Tower 攻击，Rampart 紧急维修 (< 1000 hits)
- **Medium (50)**: `RefillSpawn`  
  填充 Spawn 和 Extension
- **Normal (30)**: `Upgrade`  
  升级控制器
- **Low (10)**: `Build`  
  建造非关键建筑

#### C. 资源分配与负载均衡算法 (Load Balancing)

**算法公式**:

Score = (TaskPriority \* PriorityWeight) / (Distance + DistanceWeight);

````

- **逻辑**:
  1.  收集当前房间内所有待处理的 Request（如 Extension 缺能量）。
  2.  计算每个 Idle Creep 到每个 Request 的 `Score`。
  3.  使用 **匈牙利算法 (Hungarian Algorithm)** 或 **贪心算法**
  进行最佳匹配。
  4.  **防拥堵**: 对每个 Source/Container 维护一个 `slots` 计数器，
  当 `assignedCreeps >= slots` 时，不再分配新 Creep。

#### D. 任务状态监控与异常处理

定义 Task 接口：

```typescript
interface ITask {
  id: string;
  type: TaskType;
  targetId: string;
  creeps: string[]; // 分配给该任务的 Creep 列表
  status: "pending" | "running" | "completed" | "failed";
}
````

**异常处理流程**:

1.  **PathBlocked**: 若 Creep 连续 3 tick 位置未变，
    触发 `Stuck` 处理 -> 重新寻路 (`ignoreCreeps: false`)。
2.  **TargetInvalid**: 若目标消失（如 Source 枯竭、Container 被毁），
    立即终止任务，将 Creep 重置为 `Idle`。
3.  **Timeout**: 若任务执行时间超过预期（`estimatedTicks * 1.5`），
    强制取消并重新分配。

#### E. 性能指标定义 (Metrics)

在 `Memory.stats` 中记录以下关键指标，用于 Grafana 可视化：

- `cpu.bucket`: 当前 CPU 桶剩余量。
- `cpu.usage`: 当前 tick CPU 使用量。
- `cpu.scheduler`: 调度系统消耗的 CPU。
- `room.energyAvailable`: 房间当前能量。
- `room.rcl_progress`: 控制器升级进度百分比。

---

## 6. 自动化基地布局 (Auto-Base Planning)

### 6.1 布局策略选择

- **Stamp Layout (邮票式)**: 推荐。将建筑分组为固定的小模块 (Stamp)，  
  如 `ExtensionBlock`, `LabBlock`, `TowerBlock`。
  - 优点：灵活性高，适应不规则地形。
  - 实现：定义 `LayoutTemplate` (如 2x2 Extension + 1 Road)。
- **Bunker Layout (地堡式)**: 适合开阔地形。以 Spawn/Storage 为中心，层层包裹。
  - 缺点：对地形要求高，RCL 低时维护成本高。

### 6.2 自动布局算法 (Distance Transform)

1.  **Terrain Analysis**: 使用 `Game.map.getRoomTerrain` 获取地形数据。
2.  **Distance Transform**: 计算每个点到最近墙壁的距离。距离越大，越适合放置核心建筑 (Storage/Spawn)。
3.  **Flood Fill**: 从核心点开始泛洪，寻找最近的空地放置 Extension。

### 6.3 建筑优先级队列

| RCL | 建筑类型    | 数量 | 布局逻辑                         |
| :-- | :---------- | :--- | :------------------------------- |
| 1   | `Spawn`     | 1    | 靠近 Source (距离 < 5)，避开出口 |
| 2   | `Extension` | 5    | 围绕 Spawn 建造，呈十字或 X 型   |
| 3   | `Tower`     | 1    | 靠近 Spawn，覆盖所有关键入口     |
| 4   | `Storage`   | 1    | 位于基地几何中心，作为物流枢纽   |
| 5   | `Link`      | 2    | Source 旁一个，Storage 旁一个    |

---

## 7. 进程接口与生命周期 (Process Interface)

### 7.1 进程接口定义

if (this.creep.store.getUsedCapacity() === 0) {
export interface IProcess {
pid: string; // 进程唯一 ID
parentPID: string; // 父进程 ID
priority: number; // 优先级 (0-100)
status: ProcessStatus; // 运行状态

run(): void; // 每 tick 执行的主逻辑
sleep(ticks: number): void; // 休眠 N ticks
suspend(): void; // 挂起 (不占用 CPU，直到被唤醒)
kill(): void; // 终止进程，清理内存
}

export enum ProcessStatus {
Running = 0,
Sleeping = 1,
Suspended = 2,
Dead = 3,
}

````

### 7.2 进程通信机制 (IPC)

- **Memory IPC**: 用于跨 tick 通信。
  - `ProcessMemory`: 每个进程在 `Memory.processes[pid]` 中拥有独立空间。
- **Heap IPC**: 用于 tick 内通信 (高性能)。
  - `global.kernel.sendMessage(targetPID, message)`
  - 消息类型: `SpawnRequest`, `TaskComplete`, `EnemyDetected`。

### 7.3 核心进程列表

1.  **RoomPlannerProcess**: 负责计算建筑位置，发布 `BuildTask`。
2.  **LogisticsProcess**: 监控能量流，调度 `Hauler` 和 `Distributor`。
3.  **DefenseProcess**: 监控敌情，控制 Tower 和 `Defender`。
4.  **ColonyProcess**: 负责外矿占领和新房间启动。
    this.moveTo(this.memory.sourceId);
    this.harvest(target);
  } else {
## 8. 业务逻辑阻塞点与解决方案 (Business Logic Blockers)

在业务实现阶段，即使有架构和布局，开发者仍会遇到以下**微观执行层**的阻塞：

### 8.1 资源争抢与死锁 (Resource Contention)

- **问题**: 两个 Hauler 同时前往同一个能量堆 (Dropped Resource)，
导致一个白跑；或者多个 Upgrader 同时从 Container 取能量，
导致瞬间抽干，后面的排队等待。
- **解决方案 (Resource Reservation)**:
  - Creep 在出发前必须先 `reserve(targetId, amount)`。
  - `target.incomingAmount` 属性用于记录即将到达的存储量。
  - 逻辑检查：
  `if (target.store + target.incomingAmount > target.capacity)
  chooseAnotherTarget()`。

### 8.2 Creep 堵路与对穿 (Traffic Management)

- **问题**: 在狭窄通道（如 Source 旁边的单行道），采矿的 Creep 挡住了运输的 Creep，导致全线瘫痪。
- **解决方案 (Traffic Manager)**:
  - 不要使用 `ignoreCreeps: true` 进行移动（除非确信路径畅通）。
  - **对穿协议 (Swap Logic)**: 当 Creep A 撞上 Creep B，且 A 的意图是移动，B 是空闲或移动中：
    - 若 B 空闲：B 随机移动一格让路。
    - 若 B 也在移动且方向相反：A 和 B 交换位置 (swap)。

### 8.3 状态机抖动 (State Thrashing)

- **问题**: Creep 在 `Working` 和 `Refueling` 状态间频繁切换
（例如：刚吸了 10 点能量就去工作，工作完又回来吸 10 点）。
- **解决方案 (Hysteresis)**:
  - 引入**迟滞阈值**:
    - `Refueling` -> `Working`: 必须填满 100% (或 > 90%)。
    - `Working` -> `Refueling`: 必须完全空 0%。

### 8.4 缺乏视野时的逻辑中断 (Blind Execution)

- **问题**: 想要派兵去隔壁房间，但没有那个房间的 `Game.rooms[name]` 对象，
导致代码报错 `Cannot read property 'find' of undefined`。
- **解决方案 (Memory-Based Routing)**:
  - 对于视野外的房间，依赖 `Memory.rooms[targetRoom]` 中的缓存数据（如 Source 位置）。
  - 移动逻辑不应依赖 `Room` 对象，而是依赖 `RoomPosition`。
  - 使用 `Scout` 进程定期刷新缓存。
### 4.3 异常处理 (Error Handling)

**Rule**: 永远不要让一个 Creep 的错误导致整个 Loop 崩溃。

```typescript
try {
  kernel.run();
} catch (e) {
  console.log(`KERNEL PANIC: ${e.stack}`);
  Game.notify(`KERNEL PANIC: ${e.message}`);
}
````

---

## 5. 性能指标 (Metrics)

监控以下指标以确保系统健康：

- `cpu.bucket`: 必须保持 > 500。若 < 500，停止所有非关键进程 (Construction, RemoteMining)。
- `memory.usage`: RawMemory 大小应 < 2MB。
- `gcl.progress`: 每 tick 平均进度。
