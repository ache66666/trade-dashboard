# ADR-001: Supabase Auth

- Status: Accepted
- Date: 2026-07-16

## Context

Trading Journal 是私人数据，匿名访问和客户端自报用户身份都不可接受。项目需要与现有 Node API、Staging/Production 隔离和轻量前端兼容的身份服务。

## Decision

浏览器通过 Supabase Auth 获取 Access Token，以 Bearer Token 调用 Node API。Node 再向 Supabase Auth 验证 Token，只把验证后的用户作为当前身份。公开市场数据继续匿名可读。

## Consequences

Publishable Key 可以进入页面但不是授权凭据；service role 禁止用于用户请求。认证服务异常必须返回清洗后的错误。未来角色和 MFA 需新 ADR。

参见：[认证架构](../AUTHENTICATION.md) 与 [ADR-002](ADR-002-postgresql-rls.md)。
