# 身份认证基础设施

本模块为后续 Trading Journal 多用户隔离、PostgreSQL RLS 和管理员权限提供统一身份链路，不在本阶段实现业务授权或角色系统。

## 架构

```text
Browser (ES5 + XMLHttpRequest)
  -> Supabase Auth：登录、登出、Session 与 Token 刷新
  -> Authorization: Bearer <access_token>
  -> Node API：向 Supabase Auth 验证 Token
  -> req.user = { id, email }
  -> Node Journal Data API client：转发已验证的 Access Token
  -> Supabase PostgREST：以 authenticated 身份访问
  -> PostgreSQL / RLS（下一阶段启用策略）
```

浏览器取得的 Access Token 不能被 Node 直接信任。受保护接口必须通过统一认证模块验证 Token，并从验证结果取得用户 ID；未来业务 API 不得接受客户端提交的 `user_id`。

Journal 运行时数据访问不再使用 `DATABASE_URL` 对应的管理员 PostgreSQL 连接。Node 在认证成功后向 Supabase Data API 发送 Publishable Key 和同一枚已验证的用户 Access Token。Publishable Key 只标识项目，不代表用户身份；PostgREST 根据用户 JWT 建立 `authenticated` 数据库上下文，后续 RLS 才能以 `auth.uid()` 作为最终安全边界。

禁止在 Journal 用户数据通道使用 service-role/secret key。此类管理密钥会绕过 RLS。原生管理员数据库连接仅保留给现有公共行情运行路径、Migration 和经过控制的后台任务，不得被 Journal 路由调用。

## 配置

| 变量 | 用途 | 安全边界 |
| --- | --- | --- |
| `SUPABASE_URL` | 当前环境的 Supabase 项目 URL | 可注入浏览器公开配置 |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase Auth 公钥 | 可供浏览器使用，不是 service-role key |

严禁把 `service_role`、数据库连接串或其他管理密钥注入页面。Production 与 Staging 应分别指向各自的 Supabase 项目。配置缺失时，公共市场数据继续可用，登录界面明确显示未配置。

## API

`GET /api/auth/me` 要求 `Authorization: Bearer <access_token>`。成功只返回 `id` 和 `email`；Token 缺失、格式错误、无效或过期时返回 `401`。认证服务暂不可用时返回经过清洗的 `503`。

公共市场 GET 接口保持匿名可读。Journal GET/PUT 因包含私人判断而要求登录，但本阶段尚未实现用户行级隔离。Production 的 Editor 写接口仍优先返回 `403`。Staging 即使显式打开临时 Editor 开关，也必须先通过用户认证；这不代表登录用户已经获得长期管理员权限。

## 浏览器 Session

- 使用邮箱和密码登录 Supabase Auth。
- Session 保存在浏览器本地存储中，用于刷新页面后的恢复。
- Access Token 在到期前自动用 Refresh Token 更新。
- 登出会立即清除本地 Session，并通知 Supabase Auth。
- 页面不会记录或输出 Access Token、Refresh Token 或密码。

## 当前限制与下一阶段

- 本阶段没有角色、管理员、个人中心或注册页面。
- 本阶段不修改 Journal schema，不建立 `user_id`，也不启用 RLS；在 v0.3 完成前不得把“已登录”等同于“Journal 已完成多用户隔离”。
- 当前前置层只保证 Journal 请求经 Node 验证后以用户 JWT 到达 PostgREST；在 `user_id`、组合唯一约束和 RLS Policy 完成前，仍不得发布为多用户隔离功能。
- 登录成功不自动授予公共数据维护权限。
- 下一阶段需为 Journal 增加 `user_id`、`UNIQUE(user_id, note_date)`、RLS Policy，并让所有 Journal SQL 使用经验证的当前用户 ID。
- Editor 的长期方案应单独增加管理员授权，替换临时环境开关。

相关文档：[API](04-API.md)、[部署](05-DEPLOYMENT.md)、[测试](13-TESTING.md)。
