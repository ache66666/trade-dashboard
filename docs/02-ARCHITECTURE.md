# 系统架构

## 运行架构

```text
Browser
   ↓ HTTPS
Render Web Service (Node.js)
   ├─ 静态页面服务
   ├─ /api/* HTTP API
   └─ 外部公开行情刷新
   ↓ PostgreSQL protocol
Supabase PostgreSQL
```

浏览器不直接访问数据库，也不持有数据库密钥。服务端负责查询、校验、写入和刷新。

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `config.js` | 统一读取并校验运行环境、数据库、日志、端口和连接池配置 |
| `logger.js` | 按 `LOG_LEVEL` 输出不含密钥的结构化基础日志 |
| `database.js` | 创建 PostgreSQL 连接池，统一提供查询和关闭连接能力 |
| `server.js` | HTTP 服务、API 路由、静态资源、健康检查和公开数据刷新 |
| `public/index.html` | 页面骨架和公开环境配置占位符 |
| `public/app.js` | 浏览器端数据加载、渲染、交互和兼容性诊断 |
| `public/*.css` | 全局与市场总览布局样式 |
| `sql/` | 可显式执行的数据库 schema；应用启动时不自动执行 |
| `scripts/` | 一次性数据迁移工具，不属于线上运行路径 |
| `data/` | 本地 SQLite 备份；不参与线上运行且不提交 Git |
| `docs/` | 产品、技术、运行、发布和决策记录 |

## 数据流

```text
页面加载
  → GET /api/dashboard-compat
  → 查询 indicators + macro_events
  → 返回完整 JSON
  → 浏览器渲染总览、详细数据和日历

人工维护
  → POST/PUT API
  → 服务端校验
  → PostgreSQL 写入
  → 页面重新加载数据

自动刷新
  → POST /api/refresh
  → 官方公开来源
  → await 数据库更新
  → 返回逐项结果
```

## 环境拓扑

```text
Production
  main branch
      ↓
  Render Production Service
      ↓
  Production DATABASE_URL
      ↓
  Production PostgreSQL

Staging
  staging branch
      ↓
  Render Staging Service
      ↓
  Staging DATABASE_URL
      ↓
  Staging PostgreSQL
```

两套服务使用同一仓库、不同分支和不同环境变量。Production 与 Staging 不得共享同一个可写数据库。

## 关键约束

- API 路径是前后端契约，变更时必须更新 [API 文档](04-API.md)。
- 数据库 schema 只能通过显式 SQL 变更；服务启动不建表、不种数据。
- 数据库密钥只存在于 `.env` 或平台 Secret。
- 浏览器兼容路径和诊断机制的原因见 [ADR-003](decisions/ADR-003-browser-compatibility.md)。
