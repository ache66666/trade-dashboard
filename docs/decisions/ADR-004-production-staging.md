# ADR-004：建立 Production / Staging 双环境

- 状态：Accepted
- 日期：2026-07-12

## 背景

项目已投入公网运行。直接在 Production 验证新代码会影响正式用户和正式数据，也不利于复现浏览器、部署和数据库问题。

## 问题

- 功能开发与正式发布之间缺少稳定验收层。
- 如果测试和正式环境共用数据库，测试写入可能污染正式数据。
- 页面需要明显提示测试环境，避免误操作。

## 方案

考虑复制项目、维护两套代码和使用一套代码配合环境变量。复制会导致代码漂移，因此选择同仓库、不同分支、不同 Render Service 和不同数据库。

## 最终决定

- `main` → Render Production → Production PostgreSQL。
- `staging` → Render Staging → Staging PostgreSQL。
- 使用 `APP_ENV`、`DATABASE_URL` 等环境变量区分运行环境。
- Staging 页面显示 `STAGING`；Production 不显示测试标识。
- 所有功能先通过 Staging 验收再合并到 `main`。

## 影响

### 正面

- 发布前可验证功能、数据写入、浏览器兼容性和平台配置。
- 测试失败不会修改正式数据库。
- 环境身份可从页面和健康检查确认。

### 代价与约束

- 需要维护第二个 Render Service 和独立数据库。
- 配置漂移必须通过部署文档和定期核对控制。
- 禁止把 Production `DATABASE_URL` 复制给 Staging。
