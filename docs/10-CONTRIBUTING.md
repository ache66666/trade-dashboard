# 贡献指南

所有贡献必须遵循 [开发规范](07-DEVELOPMENT.md)、[测试规范](13-TESTING.md)、[发布规范](06-RELEASE.md) 和 [安全/运维要求](09-OPERATIONS.md)。

## 1. 创建任务

从 [任务模板](tasks/TEMPLATE.md) 创建任务文档，填写背景、目标、方案、验收、风险和数据影响。大型功能可同时使用 [Feature 模板](templates/FEATURE_TEMPLATE.md)，长期技术取舍使用 [ADR 模板](templates/ADR_TEMPLATE.md)。

## 2. 同步 Staging

```powershell
git switch staging
git pull --ff-only origin staging
```

确认工作区 clean，不覆盖他人未提交的文件。

## 3. 创建 Feature Branch

```powershell
git switch -c feature/short-description
```

修复和文档分别使用 `fix/*`、`docs/*`。不要直接在 `main` 开发。

## 4. 开发

- 只修改任务范围内的文件。
- 保留已有数据、API 和兼容行为，除非任务明确要求变更。
- 不提交真实密钥、数据库文件、日志或临时输出。
- 变更 API、数据、部署或架构时同步更新对应文档。
- Debug 遵循“一次验证一个假设”，详见 [Debug 手册](08-DEBUG.md)。

## 5. 自测

至少完成：

- [ ] 语法和项目测试通过
- [ ] 相关 API 状态、数量和错误状态正确
- [ ] 页面无 Console/服务端新增错误
- [ ] 数据写入目标是 Staging/开发数据库
- [ ] 空数据、待录入和失败状态可见
- [ ] 相关桌面和移动浏览器通过
- [ ] `git diff --check` 通过
- [ ] Secret 扫描通过
- [ ] 文档链接有效

具体 Checklist 见 [开发规范](07-DEVELOPMENT.md)。

## 6. 提交 Commit

```powershell
git status
git diff
git add <明确文件>
git commit -m "feat: concise description"
```

Commit 保持单一职责。文档任务使用 `docs:`，缺陷使用 `fix:`，新功能使用 `feat:`。

## 7. 推送并创建 PR

```powershell
git push -u origin feature/short-description
```

PR 目标分支先选择 `staging`，描述中包含：

- 任务文档链接
- 变更范围与非范围
- 测试结果和设备
- 数据库/API/环境变量影响
- 风险和回滚方式
- 截图或日志时的脱敏说明

## 8. Merge 到 Staging

1. 完成 Code Review Checklist。
2. 解决高风险 review 意见。
3. 合并到 `staging`。
4. 等待 Render Staging 自动部署。
5. 检查 Health、STAGING 标识、数据库隔离和相关功能。
6. 把验收结果写回任务文档。

未通过 Staging 验收不得发布 Production。

## 9. 发布到 Main

1. 确认待发布 commit 与 Staging 已验收内容一致。
2. 按团队流程创建 `staging` → `main` PR。
3. Review CHANGELOG、文档、数据库计划和回滚点。
4. 合并 `main`，等待 Render Production 自动部署。
5. 验证 `/api/health` 为 production/connected。
6. 确认无 STAGING 标识和默认调试面板。
7. 完成关键页面和数据冒烟测试。

## 10. 完成记录

- 更新任务文档的完成记录和后续优化。
- 将 CHANGELOG 的相关内容归档到发布版本。
- 记录 Production commit 和验证结果。
- 删除已合并、无继续用途的短期分支。

## 不接受的贡献

- 绕过 Staging 直接发布未验收功能
- Production 与 Staging 共用可写数据库
- 提交密钥、真实连接串或数据库备份
- 在功能提交中混入大范围无关重构
- 没有来源或编造的市场数据
- 只在开发机器验证的浏览器兼容修复
