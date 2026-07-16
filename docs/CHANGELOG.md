# Changelog

本项目采用 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 风格，并在 v1.0 前使用语义化的 `0.x` 阶段版本。

v0.1–v0.5 根据现有 Git 历史整理，目前未补建对应 Git tag。

## [Unreleased]

### Added

- 新增 Auth UI v1：用户注册、邮箱验证引导、忘记密码、登录状态菜单及无刷新登出。
- 重构 Market Overview 2.0：首页按七类市场状态组织代表指标，并预留 Today's Story 与 Recent Journal 产品入口。
- 新增 Supabase Auth 基础链路：邮箱密码登录、Session 恢复、Token 自动刷新、统一 Bearer Token 验证和 `/api/auth/me`。
- 新增认证自动化测试；公共市场 GET 保持开放，Production 写接口继续默认拒绝。
- 建立长期维护文档体系、ADR 和 Feature 模板。
- 增加开发、Debug、运维、贡献和 Task 管理规范。
- 增加 GitHub Actions、数据库设计、数据源、测试规范及未来架构设计。
- 增加部署Commit识别、Staging安全Seed/Cleanup和基础自动化测试。
- 扩充 Staging Seed 至10条指标/2条事件，增加 dry-run、Supabase 项目标识校验和事务内结果验证。
- 新增 Trading Journal v0.1：市场快照、市场主线、支持/反对证据、明日观察，以及独立日志表和按日期 API。

## [0.5.0] - 2026-07-12

### Added

- Production / Staging 双环境配置。
- `APP_ENV`、`DEBUG_PANEL_DEFAULT`、`LOG_LEVEL` 等统一配置。
- 健康检查环境字段和 Staging 页面标识。
- `main` 与 `staging` 发布分支。

## [0.4.0] - 2026-07-12

### Fixed

- 修复部分浏览器页面数据不渲染和交互卡死问题。
- 采用 ES5 与 XMLHttpRequest 兼容路径。
- 新增聚合兼容接口并保留 `?debug=1` 诊断能力。
- 修复核心指标文字重叠。

## [0.3.0] - 2026-07-11

### Added

- Render 云端部署支持。
- 使用平台 `PORT` 并监听 `0.0.0.0`。
- 云端健康检查和静态页面服务。

## [0.2.0] - 2026-07-11

### Changed

- 运行时数据库从 SQLite 迁移到 Supabase PostgreSQL。
- 保留原始指标和宏观事件数据、ID 与字段口径。
- 数据库查询改为异步 PostgreSQL 参数化查询。

### Added

- PostgreSQL schema、连接池与一次性迁移脚本。

## [0.1.0] - 2026-07-11

### Added

- 初始市场工作台。
- SQLite 本地数据存储。
- 指标、宏观事件、搜索、编辑和刷新功能。
