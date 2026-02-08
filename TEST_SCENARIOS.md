
# 智能 Creep 孵化系统测试用例

本文档提供了针对新的动态孵化系统的测试场景和验证方法。

## 1. 测试准备

确保已编译并部署最新代码 (`npm run build`)。

## 2. 场景测试

### 场景 A: 低能量/危机恢复 (Low/Critical)
**条件**:
- 房间能量 < 300 或 < 50% 容量。
- 缺少 Harvester。

**预期行为**:
- 系统进入 `CRITICAL` 或 `LOW` 等级。
- 孵化 `Harvester`，身体部件不超过 3 个 (e.g. `[WORK, CARRY, MOVE]`)。
- 即使能量未满，只要满足最小成本即刻孵化。
- 监控面板显示等级为红色或橙色。

**验证脚本 (Console)**:
```javascript
// 模拟低能量环境
Memory.stats = { rooms: { 'W1N1': { history: [] } } }; // Reset
// 观察 Console 输出
// [Spawner] 为 Source sourceId 孵化 Harvester...
// Body length should be 3
```

### 场景 B: 中等发展 (Medium)
**条件**:
- 房间能量在 50% - 80% 之间。
- Harvester 充足，需要 Upgrader 或 Builder。

**预期行为**:
- 系统进入 `MEDIUM` 等级。
- 孵化 `Upgrader`，身体部件 4-6 个 (e.g. `[WORK, CARRY, MOVE, WORK, WORK, MOVE]`)。
- 只有当能量满足较大 Body 需求时才孵化，不会为了"凑合"而孵化小 Creep (除非 available energy 限制)。

### 场景 C: 繁荣时期 (High)
**条件**:
- 房间能量 > 80%。

**预期行为**:
- 系统进入 `HIGH` 等级。
- 孵化 7-12 个部件的大型 Creep。
- 优先填满 `maxGrow` 限制。

## 3. 性能与逻辑验证

### 验证 Body 生成算法
在控制台运行以下代码片段来模拟不同场景下的 Body 生成结果：

```javascript
// 复制到 Screeps Console
const mockRoom = (available, capacity, level) => ({
    name: 'TestRoom',
    energyAvailable: available,
    energyCapacityAvailable: capacity,
    memory: { energyLevel: level }
});

const pop = require('module.population'); // 确保 require 路径正确，或直接测试逻辑

// 1. 测试低能量 (Capacity 800, Available 200, Level LOW)
// 预期: [WORK, CARRY, MOVE] (Cost 200)
console.log('Low:', JSON.stringify(pop.default.getBody(mockRoom(200, 800, 'LOW'), 'harvester')));

// 2. 测试中等能量 (Capacity 800, Available 500, Level MEDIUM)
// 预期: ~6 parts
console.log('Med:', JSON.stringify(pop.default.getBody(mockRoom(500, 800, 'MEDIUM'), 'harvester')));

// 3. 测试高能量 (Capacity 800, Available 800, Level HIGH)
// 预期: Max parts (limited by 800 energy) -> ~8-10 parts
console.log('High:', JSON.stringify(pop.default.getBody(mockRoom(800, 800, 'HIGH'), 'harvester')));
```

### 验证滞后机制 (Hysteresis)
1. 观察 `Memory.stats` 或控制台日志。
2. 当能量在 50% 上下波动时，`energyLevel` 不应频繁跳变。
3. 只有当能量超过 55% 时才升至 MEDIUM，低于 45% 时才降回 LOW。

## 4. 配置调整接口

可以通过 `Memory.config` 动态调整阈值：

```javascript
Memory.config = {
    thresholds: {
        low: 0.4,  // 降低门槛，更容易进入 Medium
        high: 0.7  // 降低门槛，更容易进入 High
    }
};
// 下一个 tick 生效
```
