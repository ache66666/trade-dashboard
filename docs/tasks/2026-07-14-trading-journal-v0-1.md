# Feature：Trading Journal v0.1

- 状态：In Development
- 目标版本：v0.6
- 分支：`feature/trading-journal-v0-1`
- 关联 ADR：无；本阶段为现有架构内的独立增量模块

## 用户问题

交易员已经能快速浏览市场数据，但缺少把数据转化为判断、证据和次日验证事项的固定工作流。

## 目标

- 新增 Trading Journal 页面。
- 固定呈现 Market Snapshot、Market Thesis、Evidence、Tomorrow Watchlist 四个区域。
- 每个交易日按日期保存一份日志，可重复读取和更新。

## 非目标

- 不接入新行情源、新闻、AI、评分、策略推荐、历史统计或知识图谱。
- 不修改 indicators、macro_events 结构和既有 API 行为。
- 不发布 Production。

## 范围与交互

- Snapshot 只读取既有指标。
- Thesis 为固定单选和200字以内判断。
- 支持/反对证据关联现有指标，各自填写备注。
- Watchlist 最多三条，状态为未验证、已验证、与预期相反。
- 空日志显示待填写状态；保存失败提供页面可见错误。

## 数据与来源

- 新增 `daily_market_notes`，日期唯一。
- 证据和观察项使用 JSONB，服务端执行结构、长度、状态和指标存在性校验。
- Staging 先执行 `sql/002_daily_market_notes.sql`；Production 不执行。

## API 与兼容性

- `GET /api/journal/:date`
- `PUT /api/journal/:date`
- 前端继续使用已验证的 ES5 + XMLHttpRequest 路径。

## 安全与运行

- SQL 全部参数化。
- 迁移只在脱敏确认后的独立 Staging 数据库执行。
- 回滚方式为回退功能代码；如需删除 Staging 新表，必须另行审批，不自动执行。

## 验收标准

- [ ] 四个区域完整显示
- [ ] 保存后刷新可读取同一日志
- [ ] 200字、三条观察、证据指标校验有效
- [ ] 原有三个页面和 API 不受影响
- [ ] Staging CI/CD 与页面验收通过
- [ ] Production 数据和 main 未变化
- [ ] API、数据库、测试和 CHANGELOG 文档完成

## 发布步骤

1. Feature 分支实现与测试。
2. 仅对 Staging 执行新增表迁移。
3. 合并 staging 并等待自动部署。
4. 完成 Staging API、页面和持久化验收。
5. 本任务不合并 main。

## 已知问题与后续

- 历史检索、统计、AI 和自动证据生成不属于 v0.1。
- v0.1沿用现有应用访问模型，尚无独立登录与用户归属；因此本阶段只在 Staging 验收，不发布 Production。进入正式环境前需单独评审访问控制与个人日志隔离。
