# ADR-002: PostgreSQL Row Level Security

- Status: Accepted
- Date: 2026-07-16

## Context

仅在 Node SQL 中添加 `user_id` 条件无法让数据库成为最终边界；Owner、service role 或错误连接角色可能绕过隔离。

## Decision

Journal 通过 Supabase Data API 转发已验证的用户 JWT，以 `authenticated` 角色执行；表启用并强制 RLS，以 `auth.uid() = user_id` 约束 SELECT、INSERT、UPDATE、DELETE。

## Consequences

必须测试 Policy、Grants、角色和双用户端到端隔离。Migration/受控后台任务可使用管理连接，但不能成为浏览器运行时路径。

参见：[数据库文档](../11-DATABASE.md) 与 [ADR-001](ADR-001-supabase-auth.md)。
