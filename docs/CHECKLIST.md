# Pull Request Checklist

## 范围与 Review

- [ ] PR 只解决一个闭环问题，非目标和回滚方式清楚
- [ ] Changed files 无无关格式化、生成物或 Staging/Production 混入
- [ ] API、数据库、页面、环境变量和兼容性影响已逐项说明
- [ ] Reviewer 可以从任务文档复现关键结论

## 代码与测试

- [ ] JavaScript 语法检查通过
- [ ] `npm run check:engineering` 通过
- [ ] `npm test` 全部通过
- [ ] lint/build 已执行，或项目确实未配置
- [ ] 正常、异常、超时、空数据和回滚路径有覆盖

## Auth 与 RLS

- [ ] 身份只来自验证后的 Bearer Token，不信任客户端 `user_id`
- [ ] 未登录、无效 Token、上游不可用的状态码和清洗响应正确
- [ ] 私人数据通过用户 JWT 到达 Data API，未使用 service role
- [ ] SELECT/INSERT/UPDATE/DELETE 的 RLS 行为均已验证
- [ ] 公共匿名 GET 与 Editor 门禁没有退化

## Migration 与数据

- [ ] Migration 有 Staging-only 保护、dry-run、事务、断言和回滚方案
- [ ] 历史数据归属明确，不覆盖未知数据
- [ ] 约束、索引、Sequence、Grants、Policy 和幂等性已 Review
- [ ] Production 数据未被测试连接或修改

## 文档、Secrets 与发布

- [ ] README、API、数据库、部署、测试、CHANGELOG/ADR 按影响更新
- [ ] `.env`、数据库、Token、Key、Hook、测试凭据和日志未进入 Git
- [ ] Staging 验收证据与失败项已记录
- [ ] Production 发布范围、风险、监控和回滚点已批准

参见：[工程基础设施](ENGINEERING_FOUNDATION.md) 与 [发布 Checklist](DEPLOY_CHECKLIST.md)。
