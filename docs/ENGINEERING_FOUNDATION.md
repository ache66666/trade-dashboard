# Engineering Foundation v1

本页定义项目的效率基础设施。它不改变产品行为；任何错误响应、日志迁移或目录接入仍需独立业务 PR 和 Staging 验收。

## 标准命令

```powershell
npm test
npm run check:engineering
npm run feature -- watchlist --dry-run
npm run verify:staging
```

`verify:staging` 会读取本地、未跟踪的 `.env.staging.local`，或 CI 注入的同名环境变量。它在任何写入前验证 `APP_ENV=staging`、显式确认值、Staging 健康状态、Supabase 公钥类型和 Production URL deny-list。Journal 临时数据只写入 User B，并在成功或失败路径中清理。

普通请求默认超时 30 秒，首次 Health 允许 60 秒吸收 Render 冷启动；可用 `STAGING_ACCEPTANCE_TIMEOUT_MS` 收紧普通请求预算。

线上验收包含 Health、匿名/无效认证、A/B 登录、Journal 幂等写入、RLS 跨用户读写删除、客户端 `user_id` 伪造、公共数据、Editor 门禁和登出刷新。浏览器本地 Session 清理继续由 `test/auth-client.test.js` 对实际 ES5 客户端代码验证。

## Feature 脚手架

```powershell
npm run feature -- watchlist
```

命令创建 `features/watchlist/{api,page,css,docs,test}` 的设计占位文件，不会自动注册路由、修改页面或接入数据库。接入动作必须在对应 Feature PR 中显式 Review。重复名称、路径穿越和非 kebab-case 名称会被拒绝。

## 日志规范

批准分类只有：`[AUTH]`、`[API]`、`[SESSION]`、`[EDITOR]`、`[RLS]`、`[DB]`、`[DEPLOY]`。

新服务端代码使用 `logger.category(category, level, message)`。不得记录 Token、密码、Key、连接串、Cookie、Journal 正文或上游原始错误。CLI 脚本可以输出清洗后的步骤结果；浏览器正式代码不使用无约束的 `console.log`。

## 错误码规范

统一名称保存在 `standards/error-codes.json`：

- `AUTH_REQUIRED`
- `INVALID_TOKEN`
- `AUTH_UNAVAILABLE`
- `FORBIDDEN`
- `VALIDATION_FAILED`
- `NOT_FOUND`
- `RLS_DENIED`
- `INTERNAL_ERROR`

本轮只建立注册表，不改变现有 API JSON。未来接入错误码必须保持 HTTP 状态与现有客户端兼容，并通过独立 PR 同步 Node、ES5 前端、日志和 API 文档。

## 自动检查边界

PR Workflow 只安装依赖、审计、检查 JavaScript、验证工程标准、运行测试以及可选 lint/build，不部署任何环境。远程 Staging 验收涉及真实测试账号和短暂写入，因此不在普通 PR 自动运行；未来启用时必须使用 GitHub `staging` Environment Secrets，并保持 Production deny-list。

相关入口：[PR Checklist](CHECKLIST.md)、[发布 Checklist](DEPLOY_CHECKLIST.md)、[Debug 指南](DEBUG_GUIDE.md)、[测试规范](13-TESTING.md)。
