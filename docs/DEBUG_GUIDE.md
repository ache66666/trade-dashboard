# Debug Guide

## 原则

先证明、再修改；一次只验证一个变量；把请求头、正文读取、JSON 解析、业务渲染分别定位；异常时保留最小复现和可回滚边界。不要用重复 Push、空 Commit、Manual Deploy 或放宽安全校验掩盖根因。

## 标准定位顺序

```text
目标环境与 Commit
  → 网络、DNS、TLS
  → HTTP 状态与 Content-Type
  → API/上游分类
  → Auth 与 Session
  → RLS、Grants、角色
  → ES5/XHR 初始化与 DOM
  → 最小修复
  → 自动回归与多设备验收
```

## Render 环境变量未生效

1. 确认服务是 Staging，不是 Production。
2. 确认最新 Deploy 晚于变量保存时间并处于 Live。
3. 只检查“存在/缺失”和公开配置中的 `authConfigured`，不打印值。
4. 检查变量名完全一致、是否误放 Environment Group/其他 Service。
5. 不用重新 Push 代替环境配置诊断。

## Supabase URL 与 Publishable Key

- Project URL 必须是 `https://<project-ref>.supabase.co`；遗漏 `https://` 会导致上游认证被清洗为不可用。
- Publishable Key 识别项目，不代表用户身份；用户身份来自验证后的 Access Token。
- Journal Data API 必须转发用户 JWT，禁止 service role/secret key。
- 无效 JWT 的上游 401/403 映射为 401；只有网络、超时、配置或服务异常映射为 503。

## RLS

- 同时检查 `ENABLE RLS`、`FORCE RLS`、Policies、Grants、Owner/BYPASSRLS 和实际请求角色。
- 用两个真实 Staging 用户验证同日数据隔离。
- 通过 Body、Query、Header 伪造 `user_id`，确认 Node 忽略且数据库仍以 `auth.uid()` 拒绝越权。
- 测试必须清理自己创建的数据，不删除未知数据。

## Session

- 分开验证登录、`/api/auth/me`、本地持久化、刷新 Token、登出和刷新页面后的未登录状态。
- 登出先清本地 Session，即使远端登出响应失败也不能保留浏览器凭据。
- 不在 DOM 快照、Console、日志和测试报告中展示测试密码或 Token。

## 浏览器缓存与 ES5/XHR

- 先确认静态资源状态、版本与 Cache-Control，再检查初始化链。
- 使用最小隔离页区分网络、正文读取、JSON 解析和 DOM 渲染。
- 正式前端维持 ES5、XMLHttpRequest；避免未经多设备验证的 Promise、async/await 或新浏览器 API。
- `?debug=1` 仅在需要时开启，正式页面默认隐藏诊断面板。

## Checklist

- [ ] 当前环境、Commit、Deploy ID 正确
- [ ] Health、公共 API、认证 API 分别验证
- [ ] Browser Console 与 Render Log 只记录清洗分类
- [ ] Chrome、Edge、Safari、iPhone、iPad 按风险复现
- [ ] Production 未连接、未写入、未手动部署
- [ ] 修复后运行完整测试和 Staging 自动验收

完整历史经验见 [Debug 手册](08-DEBUG.md)，安全运行步骤见 [运维手册](09-OPERATIONS.md)。
