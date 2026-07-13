# 发布规范

编码与 Review 规则见 [开发规范](07-DEVELOPMENT.md)，具体贡献步骤见 [贡献指南](10-CONTRIBUTING.md)，运行操作见 [运维手册](09-OPERATIONS.md)，发布门禁见 [测试规范](13-TESTING.md)。

## 强制流程

```text
feature branch
      ↓
合并 staging
      ↓
Render Staging 自动部署
      ↓
功能、数据、浏览器验收
      ↓
合并 main
      ↓
Render Production 自动部署
      ↓
Production 冒烟验证
```

任何功能、修复、依赖升级或数据库变更都必须经过 Staging。紧急修复也应先在 Staging 完成最小验证。

正常发布不得手动触发 Render。只有 GitHub Actions 必要检查全部通过后，才允许对应 Deploy Hook 执行。

## 分支职责

- `feature/<name>`：单一功能或修复，范围清晰。
- `staging`：下一批待发布内容，只连接 Staging 数据库。
- `main`：已验收的 Production 状态，保持可部署。

## 开发前

1. 用 `docs/templates/FEATURE_TEMPLATE.md` 定义目标、范围、数据影响和验收标准。
2. 涉及长期技术取舍时创建 ADR。
3. 明确是否影响 API、schema、环境变量、浏览器兼容性和数据来源。
4. 从最新 `staging` 创建 feature 分支。

## Staging 发布检查

- [ ] 变更范围与 Feature 文档一致
- [ ] 测试通过，无真实密钥进入 Git
- [ ] API、数据字典、部署文档已同步
- [ ] CHANGELOG 的 Unreleased 已更新
- [ ] Render Staging 部署成功
- [ ] `/api/health` 返回 `environment=staging`
- [ ] `/api/health.commit` 与 staging commit 一致且不是 `unknown`
- [ ] 页面显示 `STAGING`
- [ ] 读写只影响 Staging 数据库
- [ ] 桌面 Chrome、第二台电脑、iPhone Safari/Chrome、iPad 完成相关验收
- [ ] `?debug=1` 在需要时可提供诊断信息

## Production 发布检查

- [ ] Staging 验收结果已记录
- [ ] 合并内容与 Staging 已验收 commit 一致
- [ ] 版本号和 CHANGELOG 发布段落已确定
- [ ] Production 数据库变更有备份与回滚方案
- [ ] `main` 合并完成且 Render 自动部署成功
- [ ] `/api/health` 返回 `environment=production`
- [ ] `/api/health.commit` 与 main 正式发布 commit 一致且不是 `unknown`
- [ ] 页面不显示测试标识或默认调试信息
- [ ] 首页、指标、事件和关键写操作完成冒烟验证
- [ ] 工作区 clean，远程分支同步
- [ ] 正式数据条数与发布前基线一致（除非发布明确包含数据变更）

Production deploy job 如果缺少 `RENDER_PRODUCTION_DEPLOY_HOOK_URL` 必须失败。此时停止发布并补齐 GitHub Environment Secret，不得手动部署绕过。

## 版本规则

在 v1.0 前采用 `0.MINOR.PATCH`：

- MINOR：形成可识别的新能力或工程阶段。
- PATCH：兼容修复、小功能和文档修订。

每次正式发布把 CHANGELOG 的 `[Unreleased]` 内容移动到带日期的版本标题下。

## Commit 建议

- `feat:` 新功能
- `fix:` 缺陷修复
- `docs:` 文档
- `chore:` 工程或维护
- `test:` 测试
- `refactor:` 不改变行为的重构

## 数据库发布

数据库变更不得由应用启动隐式执行。必须：

1. 编写编号 SQL。
2. 先备份并在 Staging 执行。
3. 验证 schema、数据量、约束和应用兼容性。
4. 制定回滚或前向修复方案。
5. 经批准后再在 Production 显式执行。

## 发布记录

发布完成后记录：版本、commit、部署时间、验收人、数据库变更、已知问题和回滚点。变更摘要写入 [CHANGELOG](CHANGELOG.md)。
