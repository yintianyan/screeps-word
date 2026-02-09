# Screeps AI: Project Overlord

## 简介 (Introduction)

这是一个基于 TypeScript 构建的高级 Screeps AI 机器人。本项目采用代号为 **"Project Overlord"** 的分层指挥架构，旨在实现完全自动化的殖民地扩张、经济优化与防御体系。

系统摒弃了传统的“角色轮询”模式，转而采用更高效的 **任务调度 (Task Dispatching)** 机制，确保每个 Creep 都能被分配到当前最优先、最适合的任务。

## 核心架构 (Architecture)

系统采用 **Command (指挥) - Dispatch (调度) - Execution (执行)** 三层金字塔模型：

### 1. 👑 战略层: Supreme Command

- **文件**: [SupremeCommand.ts](src/ai/SupremeCommand.ts)
- **职责**: 这里的“大脑”负责分析局势。它根据 RCL 等级、资源储备和威胁状况，制定宏观战略（如 `BOOTSTRAP` 启动、`GROWTH` 发育、`WAR` 战争）。
- **能力**: 拥有最高权限，可触发“危机模式”或“能源储备协议”。

### 2. 🏢 战术层: Functional Centers

各功能中心负责将宏观战略转化为具体的任务单 (Task Ticket)。

- **💰 经济中心 (Economy Center)**: [EconomyCenter.ts](src/centers/EconomyCenter.ts)
  - 生成采集、运输、升级、建造任务。
  - 内置“智能物流”算法，能预测 Container 填满时间并提前派车。
- **🛡️ 防御中心 (Defense Center)**: [DefenseCenter.ts](src/centers/DefenseCenter.ts)
  - 实时监控敌情，生成 `ATTACK` 任务。
  - 监控墙体健康，生成高优先级的 `REPAIR` 任务。

### 3. 📡 调度层: Global Dispatch

- **文件**: [GlobalDispatch.ts](src/ai/GlobalDispatch.ts)
- **职责**: 任务分发枢纽。它维护着一个优先级队列，利用**智能匹配算法**将任务分配给最合适的空闲 Creep。
- **算法考量**:
  - **优先级**: Critical > High > Normal > Low。
  - **距离**: 就近分配，减少路途损耗。
  - **专业度**: 优先分配给对应角色的 Creep (如 Harvest 任务优先给 Harvester)。
  - **寿命预测**: 不会把长途任务分配给即将死亡的 Creep。

### 4. 🤖 执行层: Role Execution

- **文件**: [role.ts](src/ai/role.ts)
- **职责**: Creep 不再思考“我该干什么”，而是直接执行调度中心下发的指令。
- **特性**: 支持任务锁定 (Sticky Tasks) 和多步操作序列。

## 关键特性 (Key Features)

### 🔋 能源储备协议 (Energy Reserve Protocol)

系统懂得“存钱”。

- **紧急状态 (<5k)**: 停止所有非必要消耗，仅维护 Controller 和防御。
- **储备模式 (<50k)**: 限制升级和修墙人数，优先积攒能源。
- **富裕模式 (>100k)**: 全力投入建设和升级。

### ⚔️ 战争模式 (War Mode)

当检测到敌对 Creep 时，`SupremeCommand` 会立即接管权限：

- 暂停低优先级经济活动。
- 防御塔和 Defender 获得最高资源优先级。

### 🔮 预测性物流 (Predictive Logistics)

- 不再等矿满了再叫人。系统计算 `fillRate`，在 Container 即将满仓前提前调度搬运工，实现零停顿开采。

## 开发指南 (Development)

### 环境要求

- Node.js > 12.0
- NPM / Yarn

### 安装依赖

```bash
npm install
```

### 构建代码

```bash
npm run build
```

构建产物将输出到 `dist/` 目录（或根据 rollup 配置直接同步到 Screeps 目录）。

### 部署

将构建后的 `main.js` 内容复制到 Screeps 游戏中的脚本区域，或配置 IDE 自动上传。

## 目录结构

```
src/
  ai/           # 核心 AI (指挥、调度、角色基类)
  centers/      # 战术中心 (经济、防御)
  components/   # 基础设施 (内存、人口、监控)
  config/       # 配置文件 (常量、优先级、模板)
  modules/      # 具体行为逻辑 (Builder, Hauler 等)
  types/        # 类型定义
  utils/        # 工具函数
  main.ts       # 入口文件
```
