# 开发规范

本规范适用于所有未来功能、修复、重构和工程变更。发布流程同时遵循 [发布规范](06-RELEASE.md)，贡献步骤见 [贡献指南](10-CONTRIBUTING.md)。

自动验收、Feature 脚手架、日志分类和错误码注册表见 [Engineering Foundation v1](ENGINEERING_FOUNDATION.md)；所有 PR 必须完成 [PR Checklist](CHECKLIST.md)。

## 项目目录结构

```text
market-workbench/
├─ config.js                 # 环境配置
├─ logger.js                 # 服务端日志
├─ database.js               # PostgreSQL 连接
├─ server.js                 # HTTP 服务与 API
├─ public/                   # 正式前端资源
├─ sql/                      # 编号数据库 schema/迁移
├─ scripts/                  # 一次性工具
├─ data/                     # 本地备份，Git 忽略
└─ docs/                     # 产品、研发、运维与决策文档
```

职责边界见 [系统架构](02-ARCHITECTURE.md)。新增文件应进入职责最接近的目录，不在项目根目录堆放临时脚本、日志、截图或密钥。

## JavaScript 编码规范

### 通用规则

- 使用清晰、完整的英文变量和函数名；业务展示文案可以使用中文。
- 函数保持单一职责，复杂流程拆成可验证步骤。
- 所有异步数据库写入必须等待完成并处理异常。
- SQL 必须参数化，不拼接用户输入。
- 禁止空 `catch`；错误必须记录、返回或转化为可见状态。
- 不记录密码、连接串、Token、完整请求密钥或敏感数据。
- 改变 API 或数据结构时同步更新 [API](04-API.md) 与 [数据字典](03-DATA_DICTIONARY.md)。

### 浏览器兼容约束

`public/app.js` 当前承担已验证的 ES5 兼容路径：

- 不引入未经多设备验证的现代语法或浏览器 API。
- 修改数据加载链时必须在 Staging 验证 Chrome、Edge、Safari、iPhone 和 iPad。
- 保留 `?debug=1` 诊断能力。
- 如需引入构建工具或现代代码，先创建 ADR，并提供兼容目标、转译策略和回退方案。
- 兼容问题的具体经验见 [Debug 手册](08-DEBUG.md) 和 [ADR-003](decisions/ADR-003-browser-compatibility.md)。

### 格式与可读性

- 新代码优先保持项目现有风格，不在功能提交中混入全文件格式化。
- 避免重复常量、魔法字符串和无说明的时间阈值。
- 注释解释“为什么”，代码表达“做什么”。
- 删除无使用者的临时代码；有长期诊断价值的能力应受开关控制并文档化。

## CSS 命名规范

- 使用小写 kebab-case，例如 `.environment-badge`。
- 名称表达组件或职责，不表达临时视觉结果，例如使用 `.market-group`，避免 `.green-box-2`。
- 状态类使用明确前缀或形容词，如 `.active`、`.is-pending`、`.manual`。
- JavaScript 钩子优先使用稳定 ID 或 `data-*`，不要依赖纯视觉选择器。
- 全局变量放在 `:root`，复用颜色、间距和阴影。
- 响应式规则与对应组件保持邻近，避免互相覆盖的重复断点。
- 修改布局后检查文本溢出、长 symbol、缺失数据和窄屏。

## 文件命名规范

- JavaScript/CSS：小写 kebab-case；既有正式入口名称保持稳定。
- 文档：编号文档使用 `NN-UPPERCASE.md`；ADR 使用 `ADR-NNN-topic.md`。
- SQL：`NNN_description.sql`，编号递增且不可复用。
- 任务：建议 `YYYY-MM-DD-short-topic.md`，由 [任务模板](tasks/TEMPLATE.md) 创建。
- 临时文件不得进入仓库；需要保留的诊断工具必须有明确名称、用途和清理条件。

## Git Commit 规范

格式：

```text
type: concise imperative summary
```

允许的常用类型：

| 类型 | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `docs` | 仅文档 |
| `test` | 测试 |
| `refactor` | 不改变行为的重构 |
| `chore` | 工程配置与维护 |

要求：

- 一个 commit 解决一个清晰问题。
- 不提交 `.env`、数据库文件、日志、测试输出或真实凭据。
- Commit message 不使用“update”“fix stuff”等模糊描述。
- 提交前运行相关检查并确认 `git diff` 范围。

## Branch 命名规范

| 类型 | 示例 |
| --- | --- |
| 功能 | `feature/watchlist` |
| 修复 | `fix/mobile-layout` |
| 文档 | `docs/debug-handbook` |
| 工程 | `chore/logging-policy` |
| 紧急修复 | `hotfix/health-check` |

分支名使用小写英文和连字符。功能分支从最新 `staging` 创建；`main` 和 `staging` 是长期受保护分支。

## Feature 开发流程

1. 从 [任务模板](tasks/TEMPLATE.md) 创建任务文档，明确目标、非目标、风险和验收。
2. 需要长期技术决策时从 [ADR 模板](templates/ADR_TEMPLATE.md) 创建 ADR。
3. 从最新 `staging` 创建 `feature/*`。
4. 小步实现，每次只改变一个可验证范围。
5. 完成本地自测、安全检查和文档更新。
6. 创建 PR 合并到 `staging`。
7. 等待 Render Staging 部署，完成跨设备和数据隔离验收。
8. 验收通过后按 [发布规范](06-RELEASE.md) 合并到 `main`。
9. Production 冒烟验证后更新任务完成记录和 CHANGELOG。

## PR Review 规范

- PR 描述必须链接任务文档，说明范围、测试、风险和回滚。
- Review 关注行为、数据安全和兼容性，不只关注格式。
- 作者不得自行忽略未解决的高风险意见。
- 变更 API、schema、环境变量或架构时必须有对应文档。
- 未经 Staging 验收的 PR 不得进入 `main`。
- Review 意见解决后重新核对 diff，防止顺手修改扩大范围。

## Code Review Checklist

- [ ] 变更是否符合任务目标且没有无关重构
- [ ] 是否保持现有 API 和数据兼容性
- [ ] 所有数据库查询是否参数化
- [ ] 所有写入和异步操作是否正确等待
- [ ] 错误是否可观察，是否存在空 catch
- [ ] 是否处理暂无数据、待录入和异常状态
- [ ] 是否泄露数据库连接串、Token 或用户数据
- [ ] Production/Staging 是否继续隔离
- [ ] 浏览器兼容路径是否经过相关设备验证
- [ ] 文档、数据字典、API 和 CHANGELOG 是否同步
- [ ] 是否有明确回滚方案

## 新功能开发 Checklist

- [ ] 已创建 `docs/tasks/` 任务文档
- [ ] 用户问题、目标和非目标明确
- [ ] 数据来源、许可、更新频率和缺失策略明确
- [ ] 已评估 API、schema、权限和密钥影响
- [ ] 已评估桌面、移动端和浏览器兼容风险
- [ ] 本地测试通过
- [ ] Staging 数据准备完成且与 Production 隔离
- [ ] Render Staging 部署成功
- [ ] 多设备验收完成
- [ ] 文档与 CHANGELOG 已更新
- [ ] 合并 `main` 后完成 Production 冒烟验证

## 相关文档

- [任务管理](tasks/TEMPLATE.md)
- [Debug 手册](08-DEBUG.md)
- [运维手册](09-OPERATIONS.md)
- [贡献指南](10-CONTRIBUTING.md)
- [发布规范](06-RELEASE.md)
- [测试规范](13-TESTING.md)
