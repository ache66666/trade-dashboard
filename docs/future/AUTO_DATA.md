# Future：自动数据源

状态：Design only。本文规划来源治理和自动化方向，不新增任务、API、数据库或抓取代码。

> Data Foundation v1 已将可执行的逐项来源、验证规则和接入批次收敛到 [Data Source Catalog](../12-DATA_SOURCE.md) 与 [`docs/data/`](../data/)。本文仅保留长期方向；实际接入以 Catalog 为准，避免维护两套冲突清单。

## 目标

在不牺牲来源透明、数据许可和可回滚性的前提下，提高指标自动更新覆盖率，并保留人工录入作为受控补充。

## 当前模式

- 自动：FRED、U.S. Treasury、ChinaBond 等公开来源。
- 人工：待录入指标、Wind 截图/手工、缺少稳定公开接口的数据。
- 页面必须展示来源、数据日期、频率和维护方式。
- 当前逐项来源见 [数据源目录](../12-DATA_SOURCE.md)。

## 来源规划

| 来源 | 适用方向 | 获取方式候选 | 当前/未来 | 关键风险 |
| --- | --- | --- | --- | --- |
| FRED | 美国宏观、利率、指数代理 | 官方 CSV/API | 当前已有，继续标准化 | 频率、修订、series 变更 |
| U.S. Treasury | 美国国债收益率 | 官方 XML/数据接口 | 当前已有 | 节假日、格式变化 |
| ChinaBond | 中国国债曲线 | 官方公开页面/接口 | 当前已有 | 页面结构、访问稳定性 |
| ECB | 欧元区利率与宏观 | 官方 Data API | 未来评估 | series 口径与时区 |
| Yahoo | 全球价格辅助 | 公共页面/非正式接口 | 仅候选 | 稳定性、许可、限流，不作为未经评审的正式来源 |
| 其他公开 API | 商品、汇率、宏观 | 官方 API 优先 | 未来评估 | 授权、配额、质量 |
| Wind 辅助 | 中国市场和信用数据 | 授权范围内人工/受控集成 | 当前人工，未来需许可评审 | 商业授权、再分发限制 |
| 人工录入 | 无稳定接口的数据 | Admin/数据维护 | 长期保留 | 人为错误、审计和过期 |

## 自动与人工划分原则

适合自动：

- 有权威、稳定、可重复获取的来源。
- 口径、时间、单位和修订规则明确。
- 许可允许当前使用方式。
- 可以检测异常并保留上一次可信值。

保留人工：

- 商业数据许可不允许自动抓取或再分发。
- 来源不稳定、需要专业判断或依赖截图。
- 指标定义需要人工确认。
- 自动化成本高于业务价值。

## 统一数据源契约预留

未来每个自动来源应提供：

```text
source id
owner
license/status
endpoint identifier（不含 Secret）
symbols
frequency
timezone
unit and transformation
timeout and retry
freshness threshold
validation rules
last success / last error
fallback policy
```

Secret 只存平台 Secret，不进入来源目录或日志。

## 自动任务流程

```text
Scheduler
   ↓
Source Adapter
   ↓
Fetch raw observation
   ↓
Validate date / unit / range / freshness
   ↓
Transform to canonical value
   ↓
Transactional write
   ↓
Run log + metrics + alert
```

失败时不应把空值、错误页或异常数覆盖为正式值。

## 异常处理

- 超时：有限重试，指数退避，不无限阻塞刷新。
- HTTP/解析失败：保留上次可信值并记录来源错误。
- 数据过期：展示过期状态，不伪装为最新。
- 异常跳变：进入人工复核，不自动覆盖。
- 单位/口径变化：暂停来源并创建 ADR/数据迁移任务。
- 部分来源失败：其他来源可继续，返回逐项结果。

## 从人工迁移到自动

1. 在 [数据源目录](../12-DATA_SOURCE.md) 记录候选来源与负责人。
2. 核对许可、字段、单位、时区和历史差异。
3. 创建适配器设计与测试样本。
4. 在 Staging 并行运行人工值和自动值，不立即覆盖。
5. 对比多个交易日，记录差异和异常。
6. 完成数据负责人验收。
7. 切换 `is_manual`/来源策略并准备回退。
8. Production 发布后持续监控新鲜度和失败率。

## 未来数据库预留

可能需要 `data_sources`、`source_mappings`、`refresh_runs`、`indicator_history` 和异常队列。当前未实现，任何 schema 变化都需更新 [数据库设计](../11-DATABASE.md) 并执行正式迁移。

## 进入开发前

- [ ] 来源许可和负责人明确
- [ ] 指标映射和变化口径明确
- [ ] Secret、配额、限流和成本评估完成
- [ ] Staging 样本和并行对比计划完成
- [ ] 异常、回退和告警策略完成
- [ ] API/schema/任务调度 ADR 完成
- [ ] 测试与发布 Checklist 完成
