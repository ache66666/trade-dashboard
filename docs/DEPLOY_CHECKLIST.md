# Deployment Checklist

## Staging

- [ ] 目标 Commit 与 `origin/staging` 一致，工作区 clean
- [ ] Install、Audit、JavaScript Check、Engineering Check、Tests 成功
- [ ] lint/build 成功或安全跳过
- [ ] Render 自动部署由 Staging Deploy Hook 触发，无 Manual Deploy
- [ ] `/api/health` 为 `staging`、`connected` 且 Commit 正确
- [ ] `npm run verify:staging` 全部 PASS，临时 Journal 数据已清理
- [ ] Auth、Dashboard、Journal、RLS、Editor 门禁通过
- [ ] ES5/XHR 页面、Session 恢复/退出和 Debug 开关通过
- [ ] Chrome、Edge、Safari、iPhone、iPad 按风险完成验收

## Production Release Gate

- [ ] `staging..main` 发布差异逐 Commit、逐文件批准
- [ ] Migration 已在 Staging 验证，有备份、执行人、窗口和回滚策略
- [ ] Production 环境变量与 Secret 名称存在，未输出值
- [ ] Production 数据基线已只读记录
- [ ] 发布只通过 PR 合并与 Production Workflow，不手动 Deploy/Hook

## Production Smoke Test

- [ ] GitHub Actions 必要检查通过，Deploy Hook 返回 2xx
- [ ] Render Live Commit 与 main merge commit 一致
- [ ] `/api/health` 为 `production`、`connected`
- [ ] Dashboard、Indicators、Events、静态首页返回 200
- [ ] Editor 匿名写入保持 403
- [ ] 数据量和关键内容未被 Staging 测试污染
- [ ] Render 日志、浏览器 Console 和监控无新错误
- [ ] 回滚点保留，发布记录已更新

参见：[发布规范](06-RELEASE.md)、[运维手册](09-OPERATIONS.md)、[PR Checklist](CHECKLIST.md)。
