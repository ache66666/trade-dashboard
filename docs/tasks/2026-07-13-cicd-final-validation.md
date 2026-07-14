# Task：CI/CD 最终验证与 Staging Seed

- 状态：Staging
- 创建日期：2026-07-13
- 目标版本：1.0.0
- 分支：staging → main

## 背景

Staging CI、Deploy Hook和Render已验证，测试库为空；Production尚未验证本轮自动发布。应用缺少部署Commit识别与自动化测试。

## 目标

- 建立安全、幂等、可清理的Staging Seed。
- Health和Debug显示版本与Commit。
- 增加不接触Production的基础测试。
- 完成Staging到Production自动发布验证。

## 非目标

- 不改变市场数据业务口径。
- 不自动向Production写入任何Seed。
- 不手动触发Render部署。

## 设计方案

- Seed使用稳定页面 symbol、`[STAGING TEST]`名称和专用来源标识，采用环境、确认值、Supabase 项目标识三重确认。
- Runtime信息优先读取Render/GitHub Commit环境变量。
- Production workflow缺Hook时硬失败。
- 测试使用纯函数、子进程和Fake Client隔离数据库。

## 实现内容

- API影响：Health新增非敏感版本字段。
- 数据库影响：schema无变更；仅显式执行时向Staging加入10/2测试数据。
- 环境变量影响：支持Commit/版本/部署时间；Seed新增显式确认值与 Staging 项目标识。
- 文档影响：README、部署、发布、运维、数据库、测试、CHANGELOG。

## 验收标准

- [x] 本地5项基础测试通过
- [ ] Staging Actions与Render自动部署通过
- [ ] Staging Health Commit一致
- [ ] Seed重复执行保持10条指标/2条事件
- [ ] Staging页面读取测试数据
- [ ] Production数据基线不变
- [ ] Production Actions/Hook/Render通过
- [ ] Production Health Commit一致

## 风险

| 风险 | 缓解措施 |
| --- | --- |
| Seed误连Production | APP_ENV、确认值和 Supabase 项目标识三重检查，数据库模块加载前拒绝 |
| Hook缺失 | Production workflow硬失败，不允许手动绕过 |
| Commit不可识别 | Health返回unknown并阻止验收完成 |
| 文档提交再次部署 | 以最终发布commit为Health验证目标 |

## 完成记录

- 本地测试：5 passed，0 failed。
- 发布前只读基线：Staging 为 0 条指标、0 条事件；Production 为 32 条指标、3 条事件。
- 发布前健康检查：Staging/Production 均为 `status=ok`、`database=connected`，旧版本尚未提供 Commit 字段。
- Staging/Production结果：完成自动部署后写入发布交接记录。

## 后续优化

- 增加真正的HTTP集成测试和隔离临时PostgreSQL测试。
- 增加公开只读版本页或部署审计记录。
