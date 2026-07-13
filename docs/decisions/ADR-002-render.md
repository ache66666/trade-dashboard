# ADR-002：使用 Render 托管 Web 应用

- 状态：Accepted
- 日期：2026-07-11

## 背景

项目需要从本地 Node.js 应用转为公网可访问、无需本地电脑在线的云端服务，同时保持当前轻量架构。

## 问题

需要托管 Node.js HTTP 服务、静态页面和环境变量，并能与 GitHub 自动部署及 Supabase 连接。团队现阶段不需要自行维护服务器或容器集群。

## 方案

评估方向包括自管云主机、容器平台和托管 Web Service。选择 Render Web Service，通过 GitHub 分支自动构建和部署。

## 最终决定

使用 Render 运行 `npm start`，服务监听平台提供的 `PORT` 和 `0.0.0.0`。`/api/health` 作为健康检查。密钥通过 Render Environment 配置，不写入仓库。

## 影响

### 正面

- 部署流程简单，与 GitHub 分支直接关联。
- 平台负责 HTTPS、进程启动和基础运行管理。
- 可以用两个 Service 建立 Production/Staging。

### 代价与约束

- 依赖平台可用性、构建和网络行为。
- 必须关注冷启动、代理缓存和运行日志。
- 平台配置属于外部状态，需要文档化并定期核对。
