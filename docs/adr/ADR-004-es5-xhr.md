# ADR-004: ES5 + XMLHttpRequest 兼容路径

- Status: Accepted
- Date: 2026-07-16

## Context

生产环境曾在部分 Windows、iPhone 和 iPad 浏览器中出现现代异步加载链停滞，而最小 ES5/XHR 隔离路径稳定完成请求、解析和 DOM 渲染。

## Decision

正式浏览器入口继续使用 ES5 语法与 XMLHttpRequest。任何现代化迁移必须先有独立兼容方案、设备矩阵、可观测性和回滚路径。

## Consequences

前端代码需避免未经验证的 Promise、async/await 和新浏览器 API。Node 脚本与服务端不受 ES5 约束。`?debug=1` 和隔离测试页继续保留。

参见：[Debug 指南](../DEBUG_GUIDE.md) 与既有 [浏览器兼容 ADR](../decisions/ADR-003-browser-compatibility.md)。
