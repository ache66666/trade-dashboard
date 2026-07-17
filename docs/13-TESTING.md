# 测试规范

本文定义本地、Staging 和 Production 的统一验证标准。Debug 方法见 [Debug 手册](08-DEBUG.md)，发布门禁见 [发布规范](06-RELEASE.md)。

## 测试原则

- 所有功能先在 Staging 验收，再进入 Production。
- Production 与 Staging 不共享可写数据库。
- 测试数据必须可识别、可清理且不伪造成市场真实数据。
- 正常路径、空数据、错误路径、重启持久性和移动端都要覆盖。
- 浏览器兼容结论必须来自原异常设备或等价设备，不能只看开发机器。
- 测试失败需记录证据、首个失败步骤和回滚决定。

## 自动化检查

GitHub Actions 在目标分支 push 时执行：

1. `npm install`
2. `npm audit`（非阻塞，结果仍需评估）
3. 跟踪 JavaScript 的 `node --check`
4. `npm test --if-present`
5. `npm run lint --if-present`
6. `npm run build --if-present`
7. 检查通过后按 Secret 配置触发对应 Render Deploy Hook

工作流说明见 [部署手册](05-DEPLOYMENT.md#github-actions-自动化)。audit 非阻塞不代表可以忽略高风险漏洞；必须在发布评审中记录处理决定。

当前基础测试覆盖：Health payload状态/环境/版本、Commit缺失回退`unknown`、Production拒绝Seed、Staging 项目标识匹配、Seed 幂等，以及 Trading Journal 主线/长度/观察数量/证据重复/状态/日期校验。单元测试不连接 Production 数据库。

Journal Data API 前置层还必须验证：缺失或无效 Token 时零数据访问、认证服务异常的清洗响应、已验证 Token 原样转发、Publishable Key 请求头、service-role/secret key 拒绝、上游错误正文不泄露，以及 Journal 路径不调用原生 PostgreSQL 查询。测试只使用内存 Mock，不访问任何真实 Supabase 项目。

## 测试层级

### 静态检查

- JavaScript 语法
- Markdown 链接和格式
- Secret/连接串扫描
- Git diff 范围
- 环境配置和 workflow 分支过滤

### API 测试

- `/api/health`
- `/api/dashboard-compat`
- `/api/indicators`
- `/api/events`
- `/api/journal/:date` GET/PUT、空状态、持久化和输入拒绝

### Staging Journal RLS 验收

`npm run verify:staging-journal-rls` 仅用于受控 Staging 环境。脚本只加载被 Git 忽略的
`.env.staging.local`，并要求调用方显式提供 `STAGING_BASE_URL` 和完整的
`STAGING_EXPECTED_COMMIT`。它会验证部署环境、两个测试用户的双向读取/更新/删除隔离、
身份伪造防护、幂等保存及临时数据清理。

Data API 响应必须解析为 JSON 顶层数组；空数组计为 0，非数组结构直接失败，不能作为
RLS 隔离成功处理。脚本不得用于 Production，也不得使用 service role 或管理员数据库连接。
- Staging 中的指标新增、编辑和事件新增
- Staging 中的刷新成功、部分失败与超时

API 契约见 [API 文档](04-API.md)。

### 页面测试

- 市场总览 ticker、六类指标和宏观日历
- 详细数据搜索和分类
- 数据维护新增、编辑、刷新
- 暂无数据、待录入和错误提示
- 页面滚动、按钮、导航和 Dialog
- `STAGING` 标识与 Production 无测试标识
- 默认 Debug 关闭，`?debug=1` 可用

### 数据库测试

- 表、约束和索引存在
- 指标 symbol 唯一
- 宏观事件 importance 约束
- 写入后重启仍存在
- 迁移后记录数、最大 ID 和 sequence 一致
- Staging 写入不出现在 Production

## 浏览器矩阵

| 平台 | 浏览器 | 最低要求 |
| --- | --- | --- |
| 开发电脑 | Chrome | 全功能、自测和 Console |
| 第二台电脑 | Chrome | 独立环境数据加载与交互 |
| Windows | Edge | 总览、详情、维护和布局 |
| iPhone | Safari | 加载、滚动、导航和主要数据 |
| iPhone | Chrome | 加载、滚动、导航和主要数据 |
| iPad | Safari | 加载、布局、滚动和交互 |

涉及代理、缓存或网络兼容问题时增加有代理/无代理组合。

## Release Checklist

### CI 与部署

- [ ] GitHub Actions Install 成功
- [ ] JavaScript Check 成功
- [ ] npm test 成功或明确无测试脚本
- [ ] lint 成功或明确未配置
- [ ] Build 成功或明确未配置
- [ ] npm audit 结果已评估
- [ ] Render 部署 commit 正确
- [ ] Render Runtime Log 无新增 Error

### API

- [ ] Health API 返回 200
- [ ] Health environment 与目标环境一致
- [ ] Health commit 与部署分支 commit 一致且不是 `unknown`
- [ ] Indicators API 返回预期结构和数量
- [ ] Events API 返回预期结构和数量
- [ ] Dashboard Compat 返回 indicators/events
- [ ] 写接口只在 Staging 使用测试数据验证

### 环境

- [ ] Staging 使用 staging 分支
- [ ] Staging 使用独立数据库
- [ ] Staging 页面显示 `STAGING`
- [ ] Production 使用 main 分支
- [ ] Production 使用正式数据库
- [ ] Production 不显示测试标识
- [ ] Production 默认 Debug 关闭

### 浏览器和页面

- [ ] Chrome
- [ ] Edge
- [ ] Safari
- [ ] Mobile/iPhone
- [ ] iPad
- [ ] 页面数据正常渲染
- [ ] 页面可滚动、导航和点击
- [ ] 指标卡无重叠或溢出
- [ ] 宏观日历正常
- [ ] Console 无 Error
- [ ] `?debug=1` 诊断可按需开启

### 数据库

- [ ] Database 连接正常且环境一致
- [ ] Migration 已先在 Staging 完成
- [ ] Migration 前备份已确认
- [ ] 表、Index、约束与目标版本一致
- [ ] 数据记录数和关键字段一致
- [ ] Sequence 与最大 ID 一致
- [ ] 重启后数据仍存在
- [ ] Production 未被测试数据污染
- [ ] Staging Seed dry-run 的目标、insert/update 计划符合预期
- [ ] Staging Seed 重复执行仍为10条专用指标、2条专用事件
- [ ] 8个指标分类均有样本，待录入样本可见
- [ ] Production 环境执行 Seed 会在连接数据库前失败
- [ ] Staging 项目标识不匹配时 Seed 拒绝执行

## 上线前 Checklist

- [ ] 任务文档的目标、实现、风险和验收已完成
- [ ] Staging commit 与待发布 commit 一致
- [ ] Staging 多设备验收通过
- [ ] 所有 Review 阻塞意见已解决
- [ ] API、数据库、数据源和环境变量文档已更新
- [ ] CHANGELOG 已更新
- [ ] Secret 扫描无密码、Token、API Key 和连接串
- [ ] Production 备份与回滚点已确认
- [ ] 数据库迁移有执行人、窗口、验证和回滚方案
- [ ] Render Production Deploy Hook/自动部署配置正确
- [ ] 正常发布未使用手动 Render Deploy
- [ ] 发布负责人明确

## 上线后 Checklist

- [ ] `/api/health` 为 production/connected
- [ ] 首页、详细数据和维护页可访问
- [ ] 指标和宏观事件来自 Production 数据库
- [ ] 页面无 `STAGING`，默认无 Debug 面板
- [ ] Chrome/Edge 完成桌面冒烟测试
- [ ] Safari 或原兼容异常设备完成重点回归
- [ ] Render 日志无新错误
- [ ] 数据库连接数和写入正常
- [ ] 任务完成记录和发布版本已更新

## 测试记录模板

```text
版本/commit：
环境：
Render Service：
数据库环境：
测试日期：
测试人：
设备/浏览器：
测试范围：
通过项：
失败项：
证据链接：
已知问题：
回滚决定：
```

任务级结果写入 [Task 模板](tasks/TEMPLATE.md) 的测试计划和完成记录。
