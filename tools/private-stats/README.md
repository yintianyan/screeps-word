# 私服调试采集器

## 目标

- 从私服 Web API 定期拉取 `Memory.stats`（包含 `stats.debug` 的事件与 Kernel 热点）
- 以 JSONL 形式落盘，便于长期回放、统计与问题排查

## 使用

不要在文档、脚本参数、聊天记录里写明文密码或 token。

在项目根目录执行：

```bash
SCREEPS_URL="http://<your-server-ip>:21025" \
SCREEPS_USER="<your-username>" \
SCREEPS_PASS="<your-password>" \
OUTPUT_DIR="./tools/private-stats/out" \
INTERVAL_MS="5000" \
node tools/private-stats/collector.mjs
```

也可以直接提供 token：

```bash
SCREEPS_URL="http://127.0.0.1:21025" \
SCREEPS_TOKEN="your_token" \
node tools/private-stats/collector.mjs
```

如果你的私服需要指定 token 类型（部分服务端会校验 `X-Token-Type`），可以显式配置：

```bash
SCREEPS_TOKEN="your_token" \
SCREEPS_TOKEN_TYPE="user" \
node tools/private-stats/collector.mjs
```

如果你的私服不认可 API token（`/api/user/memory` 一直 unauthorized），可以使用浏览器登录态的 Cookie（在浏览器 Network 里复制请求头的 Cookie 值）：

```bash
SCREEPS_URL="http://<your-server-ip>:21025" \
SCREEPS_COOKIE="<cookie string>" \
node tools/private-stats/collector.mjs
```

## API 前缀

默认会依次尝试：

- `/api`（大多数私服/官服）
- 空前缀（少数反代/兼容配置）

如果你的私服没有 `/api` 前缀，可以显式指定：

```bash
SCREEPS_API_PREFIX="" \
SCREEPS_URL="http://<your-server-ip>:21025" \
node tools/private-stats/collector.mjs
```

## Shard

默认会尝试 `shard0` 与空 shard。你也可以显式指定：

```bash
SCREEPS_SHARD="shard0" \
SCREEPS_URL="http://<your-server-ip>:21025" \
node tools/private-stats/collector.mjs
```

## 输出

- 文件：`tools/private-stats/out/YYYY-MM-DD.jsonl`
- 记录类型：
  - `kind=stats`：聚合指标快照（cpu、kernelTop 等）
  - `kind=event`：调试事件（`stats.debug.events` 的增量）
  - `kind=error`：采集错误（包含鉴权失败/网络异常等）

## 游戏内开关

私服控制台设置：

```js
Memory.config.debug = {
  enabled: true,
  flushInterval: 5,
  maxEvents: 200,
  maxTicks: 200,
};
```

需要过滤房间：

```js
Memory.config.debug = { enabled: true, roomFilter: ["W45N3"] };
```
