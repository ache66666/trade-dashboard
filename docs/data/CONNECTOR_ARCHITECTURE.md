# Connector Architecture

## 最小架构

```text
Scheduled job / controlled refresh
  -> Source Fetcher
  -> Source Adapter
  -> Standardized Record
  -> Validation
  -> Snapshot/History Repository
  -> Database Upsert
  -> Existing Dashboard API
```

不允许数据源直接操作前端，也不允许每个来源自带一套 SQL。

## 模块职责

- **Fetcher**：HTTP、超时、限速、重试、响应大小限制；不理解业务字段。
- **Adapter**：把供应商字段、报价方向、单位、时区转换为统一记录。
- **Validation**：校验代码、日期、有限数值、单位、时间新鲜度、异常跳变和来源优先级。
- **Repository**：唯一的数据写入边界，负责防旧覆盖新、幂等和事务。
- **Orchestrator**：按指标配置选择首选/备用来源并记录运行结果。

## 统一记录

```text
indicator_code
observation_date
value
previous_value
change
change_pct
source
source_timestamp
fetched_at
status
```

`status` 只允许：

- `valid`：已通过校验，可写入。
- `market_closed`：该市场当日未交易。
- `not_released`：官方尚未发布。
- `fetch_failed`：连接、限流或解析失败。
- `validation_failed`：数据已返回但口径/数值校验失败。
- `manual_pending`：需要人工录入。

## 写入规则

1. `indicator_code + observation_date + source` 作为观测幂等键。
2. 新记录日期早于当前 `as_of` 时不得覆盖快照。
3. 同日不同来源按 Catalog 的优先级决定；备用源不能静默改写首选源。
4. `fetch_failed`、`not_released` 和 `market_closed` 不覆盖最后有效值。
5. 人工记录与自动记录并存；自动来源恢复后必须经过同日冲突校验。
6. 所有写入记录 `source_timestamp` 和 `fetched_at`，日志不得包含 API Key。

## 当前 Schema 兼容方案

Batch 1 可先通过统一 Repository 更新现有 `indicators` 快照字段，不改 API 返回结构。`source_timestamp`、抓取状态和历史观测无法完整落在当前表中，因此只能作为过渡。

在需要回放、审计或多来源切换前，应新增独立 `indicator_observations` 与 `data_source_runs` 表；这是未来 Migration，必须单独 Review，不属于 Phase A。

## 部署选择

- 首批用 Node 22 原生 `fetch`，不增加 Python runtime。
- 调度优先使用单一受控定时任务，不引入队列或微服务。
- 每次按供应商批量获取，限制并发；失败只影响对应来源。
- Refresh API 继续受服务端权限保护，定时任务使用服务端内部入口或独立脚本。
