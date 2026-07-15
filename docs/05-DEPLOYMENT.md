# 部署手册

日常部署、日志、备份、Secret 轮换和回滚操作见 [运维手册](09-OPERATIONS.md)。

## 环境原则

- 一套代码、两个长期环境。
- Production 跟踪 `main`，Staging 跟踪 `staging`。
- 两个环境必须使用不同的可写 PostgreSQL 数据库。
- 禁止在代码、Git、日志或文档中写入真实连接串。
- 应用启动只检查连接，不自动建表、种数据或迁移。

## 环境变量

| 变量 | 必需 | 建议值/说明 |
| --- | --- | --- |
| `APP_ENV` | 是 | Production=`production`；Staging=`staging`；本地=`development` |
| `NODE_ENV` | 是 | Render 使用 `production` |
| `DATABASE_URL` | 是 | 当前环境独立的 PostgreSQL Session pooler URL |
| `DEBUG_PANEL_DEFAULT` | 否 | 默认 `false`；临时使用 `?debug=1` |
| `LOG_LEVEL` | 否 | Production=`info`；Staging=`debug` |
| `PORT` | 平台提供 | 本地默认 4173，Render 自动注入 |
| `DATABASE_POOL_MAX` | 否 | 默认 10；小型 Staging 可设 5 |
| `DATABASE_IDLE_TIMEOUT_MS` | 否 | 默认 30000 |
| `DATABASE_CONNECTION_TIMEOUT_MS` | 否 | 默认 10000 |
| `APP_VERSION` | 否 | 覆盖 `package.json` 版本；通常不必设置 |
| `DEPLOYED_AT` | 否 | 只有发布系统能提供可靠 ISO 时间时设置 |
| `STAGING_DATABASE_PROJECT_REF` | Seed 时必填 | Staging Supabase 项目标识；必须与 `DATABASE_URL` 中的项目一致 |
| `STAGING_SEED_CONFIRM` | Seed 时必填 | 固定为 `staging`；Production 不配置 |
| `SUPABASE_URL` | Auth 启用时必填 | 当前环境 Supabase 项目 URL；Staging 与 Production 分开 |
| `SUPABASE_PUBLISHABLE_KEY` | Auth 启用时必填 | 当前环境的 Publishable Key；不得使用 service-role key |

`.env.example` 只含占位值。本地真实值放入 `.env`，Render 真实值放入 Environment/Secret。

## 本地运行

```powershell
pnpm install
Copy-Item .env.example .env
# 编辑 .env，使用开发或测试数据库
node --env-file=.env server.js
```

检查：

```text
http://localhost:4173/
http://localhost:4173/api/health
```

本地开发禁止默认连接 Production 数据库。需要验证写功能时必须使用开发或 Staging 数据库。

## Supabase 数据库

### Production

保留现有正式 Supabase Project 和数据。不得重新执行迁移脚本覆盖数据，不得删除 `indicators` 或 `macro_events`。

### Staging

1. 创建独立 Supabase Project。
2. 在 SQL Editor 执行 `sql/001_initial_schema.sql`。
3. 获取 Session pooler `DATABASE_URL`。
4. 在 Render Staging 配置该 URL。
5. 导入明确允许的测试数据；不要让 Staging 写入 Production。
6. 验证两个表存在、约束生效，并记录测试数据来源。

如果尚未创建测试数据库，Staging Service 可以创建，但在配置独立 `DATABASE_URL` 前不得开放写操作验收。

## Render Production

- 现有地址：<https://trade-dashboard-kgof.onrender.com/>
- Repository：`ache66666/trade-dashboard`
- Branch：`main`
- Build Command：`npm install`
- Start Command：`npm start`
- Health Check Path：`/api/health`

环境变量：

```text
APP_ENV=production
NODE_ENV=production
DATABASE_URL=<Production Session pooler URL>
DEBUG_PANEL_DEFAULT=false
LOG_LEVEL=info
SUPABASE_URL=<Production Supabase project URL>
SUPABASE_PUBLISHABLE_KEY=<Production publishable key>
```

Production 页面不得显示 `STAGING`。`/api/health` 必须返回 `environment=production`。

## Render Staging

在 Render 创建新的 Web Service，不复制项目：

1. `New +` → `Web Service`。
2. 选择同一 GitHub 仓库。
3. 名称建议 `trade-dashboard-staging`。
4. Branch 选择 `staging`。
5. Build Command 填 `npm install`。
6. Start Command 填 `npm start`。
7. Health Check Path 填 `/api/health`。
8. 配置独立 Staging 数据库和以下变量。

```text
APP_ENV=staging
NODE_ENV=production
DATABASE_URL=<Staging Session pooler URL>
DEBUG_PANEL_DEFAULT=false
LOG_LEVEL=debug
DATABASE_POOL_MAX=5
SUPABASE_URL=<Staging Supabase project URL>
SUPABASE_PUBLISHABLE_KEY=<Staging publishable key>
```

Staging 页面必须显示 `STAGING`，健康检查必须返回 `environment=staging`。

## GitHub 与自动部署

- feature 分支用于开发。
- `staging` 是测试发布分支，Render Staging 自动部署。
- `main` 是正式发布分支，Render Production 自动部署。
- 不向 `main` 直接推送未在 Staging 验收的功能。

## GitHub Actions 自动化

仓库包含两套独立 workflow：

| Workflow | 触发分支 | GitHub Environment | Deploy Hook Secret | 目标 |
| --- | --- | --- | --- | --- |
| `.github/workflows/staging.yml` | `staging` push | `staging` | `RENDER_STAGING_DEPLOY_HOOK_URL` | 仅 Staging |
| `.github/workflows/production.yml` | `main` push | `production` | `RENDER_PRODUCTION_DEPLOY_HOOK_URL` | 仅 Production |

统一流水线：

```text
Push target branch
      ↓
npm install
      ↓
npm audit（非阻塞、需评估）
      ↓
JavaScript syntax + test + optional lint
      ↓
optional build
      ↓
Render Deploy Hook（Secret 存在时）
```

### GitHub 配置

1. Repository → Settings → Environments。
2. 创建 `staging` 和 `production` 两个 GitHub Environment。
3. 在 `staging` Environment Secret 添加 `RENDER_STAGING_DEPLOY_HOOK_URL`。
4. 在 `production` Environment Secret 添加 `RENDER_PRODUCTION_DEPLOY_HOOK_URL`。
5. 可为 production Environment 添加 required reviewers，防止未经批准触发正式部署。
6. Secret 值只能来自对应 Render Service 的 Deploy Hook，禁止交叉使用。

Staging Secret 未配置时，workflow 仍执行检查并明确跳过 Staging Deploy Hook。Production Secret 未配置时，Production deploy job 必须失败并阻止发布，不能静默跳过或改为手动部署。

### Render 配置选择

推荐让 GitHub Actions 成为部署门禁：

1. 在 Render 分别创建 Staging/Production Deploy Hook。
2. 把 Hook 放入对应 GitHub Environment Secret。
3. 关闭对应 Render Service 的 branch auto-deploy，避免 push 时绕过 CI 或重复部署。
4. workflow 检查通过后再调用 Hook。

如果继续使用 Render 原生 branch auto-deploy，则不要配置 Deploy Hook Secret，以避免同一 commit 部署两次；但此模式无法保证 Render 一定等待 GitHub Actions 检查通过。

### 权限与隔离

- workflow 权限仅为 `contents: read`。
- Staging workflow 不监听 `main`，也不引用 Production Hook。
- Production workflow 只监听 `main`，也不引用 Staging Hook。
- Hook Secret 不传给浏览器、应用进程或日志。
- workflow 变更本身必须先在 `staging` 验证，再进入 `main`。

### Commit SHA 验证

Render 部署时应用优先读取 `RENDER_GIT_COMMIT`，其他环境可使用 `GITHUB_SHA` 或 `COMMIT_SHA`。部署后：

1. 获取目标分支的完整 Git commit。
2. 请求 `/api/health`。
3. 确认 `environment` 正确。
4. 确认 `commit` 与目标 commit 完全一致；如果平台只提供其他格式，必须至少有可审计的一致映射。
5. `commit=unknown` 时不得把该部署标记为正式验证完成。
6. 使用 `?debug=1` 可在页面诊断面板查看环境、Commit 和版本。

正常发布只能由目标分支 push → GitHub Actions → 对应 Render Deploy Hook 完成。禁止为了跳过失败检查而手动点击 Render Deploy。

自动化验收标准见 [测试规范](13-TESTING.md#自动化检查)。

## 部署验证

每套环境至少验证：

1. `/api/health` 返回 200、正确 `environment`、`database=connected`。
2. 首页、详细数据、数据维护页面可访问。
3. 指标和事件来自当前环境数据库。
4. 新增/编辑测试仅写入对应数据库。
5. 服务重启后数据仍存在。
6. 浏览器控制台和 Render 日志无新增错误。
7. Production 默认无诊断面板；必要时 `?debug=1` 可用。

## 回滚

1. 确认故障由最近部署引入。
2. 在 Staging 复现并记录影响。
3. 对故障提交创建 revert，不使用破坏性 reset 改写共享历史。
4. 先部署 Staging 验证 revert。
5. 再合并到 `main`，验证 Production 健康检查和关键页面。
6. 数据库变更必须有单独、可验证的回滚方案。
