# Market Workbench

面向交易员的市场数据工作台。应用使用一套代码，通过环境变量区分 Production、Staging 和本地开发环境；运行时数据库为 Supabase PostgreSQL。

## 环境模型

| 环境 | Git 分支 | Render Service | 数据库 | 页面标识 |
| --- | --- | --- | --- | --- |
| Production | `main` | `trade-dashboard-kgof` | 正式 Supabase 数据库 | 无 |
| Staging | `staging` | 新建独立 Service | 独立测试 Supabase 数据库 | `STAGING` |
| Local | 当前开发分支 | 本机 | 明确指定的开发/测试数据库 | 无 |

发布流程：功能分支 → `staging` → Staging 验收 → `main` → Production。

Production 与 Staging 禁止共用同一个可写数据库。代码只读取当前进程的 `DATABASE_URL`，不会硬编码数据库或 Render 地址。

## 本地启动

需要 Node.js 22.5+。

```powershell
pnpm install
Copy-Item .env.example .env
```

在 `.env` 中填写开发或测试数据库连接串，然后启动：

```powershell
node --env-file=.env server.js
```

访问 `http://localhost:4173`。应用启动时只检查数据库连接，不会自动建表、写入种子数据或覆盖数据。

## 环境变量

| 变量 | 必需 | Production | Staging | 说明 |
| --- | --- | --- | --- | --- |
| `APP_ENV` | 是 | `production` | `staging` | 应用环境；Staging 会显示页面标识 |
| `NODE_ENV` | 是 | `production` | `production` | Node 运行模式 |
| `DATABASE_URL` | 是 | 正式数据库 | 测试数据库 | PostgreSQL Session pooler 连接串 |
| `DEBUG_PANEL_DEFAULT` | 否 | `false` | `false` 或 `true` | 默认是否显示诊断面板；任何环境均可用 `?debug=1` 临时开启 |
| `LOG_LEVEL` | 否 | `info` | `debug` | `error`、`warn`、`info`、`debug` |
| `PORT` | 平台提供 | Render 自动设置 | Render 自动设置 | 本地默认 `4173` |
| `DATABASE_POOL_MAX` | 否 | `10` | `5` | 数据库连接池上限 |
| `DATABASE_IDLE_TIMEOUT_MS` | 否 | `30000` | `30000` | 空闲连接超时 |
| `DATABASE_CONNECTION_TIMEOUT_MS` | 否 | `10000` | `10000` | 建连超时 |

真实密钥只允许保存在本地 `.env` 或 Render Environment 中。`.env` 和 `data/market.db` 已由 Git 忽略。

## 数据库初始化与隔离

- `sql/001_initial_schema.sql`：创建 `indicators`、`macro_events`、约束和索引。
- `scripts/migrate-sqlite-to-postgres.js`：SQLite 到 PostgreSQL 的一次性迁移工具。
- `data/market.db`：本地备份，不参与线上运行，也不提交 Git。

Staging 数据库建议使用独立 Supabase Project。创建后，在 Supabase SQL Editor 对测试数据库执行 `sql/001_initial_schema.sql`。如需验收数据，应向测试库导入脱敏或明确允许的测试数据，不得把 Staging 指向正式 `DATABASE_URL`。

## Render：Production

现有 Production Service 保持不变，确认以下设置：

- Repository：`ache66666/trade-dashboard`
- Branch：`main`
- Build Command：`npm install`（或现有等价命令）
- Start Command：`npm start`
- Health Check Path：`/api/health`
- `APP_ENV=production`
- `NODE_ENV=production`
- `DATABASE_URL=<正式数据库 Session pooler URL>`
- `DEBUG_PANEL_DEFAULT=false`
- `LOG_LEVEL=info`

## Render：Staging

在 Render 创建新的 Web Service，不复制项目目录：

- 使用同一个 GitHub Repository：`ache66666/trade-dashboard`
- Service Name：建议 `trade-dashboard-staging`
- Branch：`staging`
- Build Command：`npm install`
- Start Command：`npm start`
- Health Check Path：`/api/health`
- `APP_ENV=staging`
- `NODE_ENV=production`
- `DATABASE_URL=<独立测试数据库 Session pooler URL>`
- `DEBUG_PANEL_DEFAULT=false`
- `LOG_LEVEL=debug`
- 可选：`DATABASE_POOL_MAX=5`

创建 Service 前必须先准备独立测试数据库。不要复制 Production 的 `DATABASE_URL`。

## 部署与验证

Staging：

1. 将功能合并或推送到 `staging` 分支。
2. 等待 Staging Service 自动部署。
3. 打开 `/api/health`，确认 `status=ok`、`environment=staging`。
4. 确认页面右上角显示 `STAGING`，并验证数据读写只进入测试数据库。
5. 可用 `/?debug=1` 做兼容性诊断。

Production：

1. Staging 验收通过后，将相同提交合并到 `main`。
2. 等待 Production Service 自动部署。
3. 打开 `/api/health`，确认 `status=ok`、`environment=production`。
4. 确认页面不显示环境标识，指标和事件数量符合正式数据库。
5. 验证新增/编辑后重启 Service，数据仍存在。

## 主要目录

```text
market-workbench/
├─ config.js                 # 统一环境配置
├─ database.js               # PostgreSQL 连接池
├─ logger.js                 # 分级日志
├─ server.js                 # HTTP、API 与静态页面服务
├─ package.json              # 依赖和启动命令
├─ public/
│  ├─ index.html             # 正式页面与环境标识占位
│  ├─ app.js                 # ES5 兼容前端与可选诊断面板
│  ├─ styles.css             # 全局样式
│  └─ overview.css           # 市场总览样式
├─ sql/
│  └─ 001_initial_schema.sql # PostgreSQL schema
├─ scripts/
│  └─ migrate-sqlite-to-postgres.js
└─ data/
   └─ market.db              # 本地备份，Git 忽略
```
