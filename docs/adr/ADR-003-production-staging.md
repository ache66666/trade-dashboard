# ADR-003: Production / Staging 双环境

- Status: Accepted
- Date: 2026-07-16

## Context

直接在 Production 验证 Migration、认证和数据写入会污染正式数据，也无法建立可靠发布门禁。

## Decision

保持一套代码，以环境变量选择独立 Render Service、Supabase 项目、数据库和 Secret。所有功能先进入 `staging` 验收，再通过 PR 合并 `main`。部署只由 GitHub Actions Deploy Hook 触发。

## Consequences

环境变量、账号和数据库不得复用。自动化脚本必须显式确认 Staging 并包含 Production deny-list。禁止用 Manual Deploy 或空 Commit 绕过流程。

参见：[部署](../05-DEPLOYMENT.md) 与既有 [ADR-004](../decisions/ADR-004-production-staging.md)。
