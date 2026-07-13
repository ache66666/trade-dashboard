# Market Workbench

Market Workbench 是面向交易员的云端市场数据工作台，用于快速浏览跨资产指标、查看宏观事件，并维护暂时无法自动获取的数据。

## 快速启动

需要 Node.js 22.5+ 与可访问的 PostgreSQL 数据库。

```powershell
pnpm install
Copy-Item .env.example .env
# 在 .env 中填写非正式环境的 DATABASE_URL
node --env-file=.env server.js
```

浏览器访问 `http://localhost:4173`。完整本地配置见 [部署文档](docs/05-DEPLOYMENT.md)。

## 目录结构

```text
market-workbench/
├─ config.js, logger.js, database.js, server.js
├─ public/                 # 浏览器页面、脚本和样式
├─ sql/                    # PostgreSQL schema
├─ scripts/                # 一次性迁移工具
├─ data/                   # 本地 SQLite 备份，Git 忽略
└─ docs/                   # 产品、架构、数据、API 与发布文档
```

## 部署入口

- Production：`main` → Render Production → Production PostgreSQL
- Staging：`staging` → Render Staging → Staging PostgreSQL
- 环境和数据库必须隔离，详情见 [部署文档](docs/05-DEPLOYMENT.md)。

## 文档导航

- [00 产品说明](docs/00-PRODUCT.md)
- [01 产品路线图](docs/01-ROADMAP.md)
- [02 系统架构](docs/02-ARCHITECTURE.md)
- [03 数据字典](docs/03-DATA_DICTIONARY.md)
- [04 API 参考](docs/04-API.md)
- [05 部署手册与 GitHub Actions](docs/05-DEPLOYMENT.md)
- [06 发布规范](docs/06-RELEASE.md)
- [07 开发规范 / 工程规范](docs/07-DEVELOPMENT.md)
- [08 Debug 手册](docs/08-DEBUG.md)
- [09 运维手册](docs/09-OPERATIONS.md)
- [10 贡献指南](docs/10-CONTRIBUTING.md)
- [11 数据库设计](docs/11-DATABASE.md)
- [12 数据源目录](docs/12-DATA_SOURCE.md)
- [13 测试与上线 Checklist](docs/13-TESTING.md)
- [Task 管理与模板](docs/tasks/TEMPLATE.md)
- [变更记录](docs/CHANGELOG.md)
- [架构决策记录](docs/decisions/)
- [文档模板](docs/templates/)

## 未来规划目录

- [Admin 管理后台设计](docs/future/ADMIN.md)
- [自动数据源设计](docs/future/AUTO_DATA.md)

## 开发流程

```text
feature branch
      ↓
staging branch
      ↓
Render Staging 自动部署与验收
      ↓
main branch
      ↓
Render Production 自动部署
```

任何功能必须先使用 [Task 模板](docs/tasks/TEMPLATE.md) 建档，并遵循 [开发规范](docs/07-DEVELOPMENT.md)、[测试规范](docs/13-TESTING.md) 和 [贡献指南](docs/10-CONTRIBUTING.md)。提交代码时同步更新相关文档和 `docs/CHANGELOG.md`，详细发布规则见 [发布规范](docs/06-RELEASE.md)。

Last CI validation: 2026-07-13 15:39:13 +08:00
