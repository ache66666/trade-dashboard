# Task：任务名称

- 状态：Draft / In Progress / Staging / Done / Blocked
- 创建日期：YYYY-MM-DD
- 目标版本：
- 负责人：
- 分支：
- 关联 Issue / Feature / ADR：

## 背景

说明用户问题、业务上下文、现状证据和为什么现在处理。不要在此记录 Secret 或真实连接串。

## 目标

- （填写可验证结果）

## 非目标

- （明确本次不处理的内容）

## 设计方案

描述用户流程、模块边界、数据来源、兼容策略和备选方案。长期技术取舍应链接 ADR。

## 实现内容

- 计划修改文件：
- API 影响：无 / 说明
- 数据库影响：无 / 说明
- 环境变量影响：无 / 说明
- 文档影响：

## 验收标准

- [ ] 功能结果
- [ ] 数据准确与缺失状态
- [ ] Staging 环境和数据库隔离
- [ ] 桌面与移动端
- [ ] Chrome、Edge、Safari
- [ ] 日志、错误和 Health Check
- [ ] 安全与 Secret 检查
- [ ] 文档和 CHANGELOG

## 测试计划

| 场景 | 环境/设备 | 预期 | 结果 |
| --- | --- | --- | --- |
| 正常路径 | Staging |  |  |
| 空数据 | Staging |  |  |
| 错误路径 | Staging |  |  |
| 移动端 | iPhone/iPad |  |  |

## 风险

| 风险 | 概率 | 影响 | 缓解措施 | 回滚方式 |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## 完成记录

- Staging commit：
- Staging 部署与验收：
- Production commit：
- Production 冒烟验证：
- 数据库操作记录：无 / 脱敏说明
- 完成日期：

## 后续优化

- （不阻塞本任务的后续工作）

## 相关文档

- [开发规范](../07-DEVELOPMENT.md)
- [Debug 手册](../08-DEBUG.md)
- [运维手册](../09-OPERATIONS.md)
- [贡献指南](../10-CONTRIBUTING.md)
- [发布规范](../06-RELEASE.md)
