# 运维手册

本文覆盖 Render、Supabase、密钥、双环境上线和回滚。部署参数见 [部署手册](05-DEPLOYMENT.md)，发布权限与分支规则见 [发布规范](06-RELEASE.md)，上线验收见 [测试规范](13-TESTING.md)。

## 运维原则

1. 先确认环境，再执行操作。
2. Production 与 Staging 使用不同服务、分支和数据库。
3. 先备份、再变更；先 Staging、再 Production。
4. 所有操作留下时间、操作者、commit、结果和回滚点。
5. 密钥不进入 Git、聊天截图、日志或任务文档。
6. 数据库写操作使用明确条件，执行前先用只读查询确认范围。

## Render 运维

### 部署流程

```text
push staging
  → Render Staging 自动构建
  → /api/health
  → 功能与数据验收
  → merge main
  → Render Production 自动构建
  → Production 冒烟验证
```

每次部署记录：Service、分支、commit、部署开始/完成时间、健康检查、验收结果和已知问题。

### 查看日志

1. 打开目标 Render Service，先核对名称和环境变量中的 `APP_ENV`。
2. 查看 Deploy Logs，确认依赖安装、启动命令和部署 commit。
3. 查看 Runtime Logs，按故障发生时间定位启动、数据库连接和刷新错误。
4. 使用 `LOG_LEVEL` 控制详细度；Production 通常为 `info`，Staging 可临时设 `debug`。
5. 复制日志前删除密钥、连接信息和不必要的数据内容。

日志排查顺序见 [Debug 手册](08-DEBUG.md)。

### Health Check

路径固定为 `/api/health`：

```json
{"status":"ok","environment":"production","database":"connected"}
```

运维判断：

- 200 + `connected`：应用和数据库基本可用。
- 503 + `disconnected`：优先检查数据库状态、Secret、网络和连接数。
- 环境字段不符：立即停止写操作，修正 `APP_ENV` 和 Service 配置。
- Health 正常不等于全部功能正常，仍需页面和关键 API 冒烟测试。

### 回滚

1. 确认当前故障 commit 和上一个稳定 commit。
2. 在 Staging 对故障提交创建 revert，避免改写共享历史。
3. 等待 Staging 自动部署并复测原故障。
4. 将已验证的 revert 合并到 `main`。
5. 验证 Production Health、首页、指标、事件和关键写操作。
6. 如涉及数据库，代码回滚前确认旧代码仍兼容当前 schema。

不使用强制推送、`reset --hard` 或删除 Production Service 作为常规回滚手段。

### 环境变量

| 变量 | 运维要求 |
| --- | --- |
| `APP_ENV` | 必须与 Service 身份一致 |
| `NODE_ENV` | Render 使用 `production` |
| `DATABASE_URL` | Secret；每套环境独立 |
| `DEBUG_PANEL_DEFAULT` | Production 默认 `false` |
| `LOG_LEVEL` | Production 避免长期 `debug` |
| `DATABASE_POOL_MAX` | 与 Supabase 连接限制协调 |
| `PORT` | 由 Render 管理，不硬编码 |

修改环境变量会触发或需要重新部署时，应按一次发布处理并完成验证。

## Supabase 运维

### 连接方式

- 应用通过当前环境的 Session pooler Secret 连接。
- 管理操作使用 Supabase Dashboard 或受控 SQL 客户端。
- 连接前核对 Project 名称、环境、主机标识和目标数据库。
- 本地开发不得默认连接 Production。
- 不在命令历史、脚本参数、截图或文档中保存完整连接信息。

### 备份

在执行迁移、批量更新、导入或清理前：

1. 确认 Supabase 当前备份能力和保留策略。
2. 创建或确认可用的逻辑备份/平台备份。
3. 记录备份时间、环境、schema 版本和行数。
4. 将备份存放在受控位置，限制访问并设置保留期限。
5. 在非 Production 环境定期验证备份可读取。

`data/market.db` 只是历史本地备份，不替代 PostgreSQL 正式备份策略。

### 恢复

1. 明确恢复目标、时间点和允许的数据损失窗口。
2. 优先恢复到隔离数据库验证，而不是直接覆盖 Production。
3. 核对表结构、记录数、最大 ID、symbol 唯一性和关键字段。
4. 验证 identity sequence、应用兼容性和 API 返回。
5. 获得明确批准后执行 Production 恢复。
6. 恢复后轮换可能暴露的凭据，并完成全链路验收。

### 数据库迁移

1. 创建递增编号 SQL，并记录目标、前置条件和影响。
2. 备份 Staging，执行迁移。
3. 验证 schema、约束、索引、数据量和应用行为。
4. 记录执行耗时、锁风险和回滚/前向修复方案。
5. Staging 验收后，在维护窗口对 Production 备份并执行。
6. 迁移后验证 Health、关键查询和写操作。

应用启动不得隐式执行 schema 迁移。

### Identity Sequence

导入保留原始 ID 的数据后，identity sequence 可能落后于最大 ID。先只读检查：

```sql
SELECT MAX(id) FROM indicators;
SELECT MAX(id) FROM macro_events;
SELECT pg_get_serial_sequence('public.indicators', 'id');
SELECT pg_get_serial_sequence('public.macro_events', 'id');
```

只有在 Staging 验证、完成备份并确认 sequence 不同步时，才执行受控同步。同步语句必须引用实际 sequence，并在事务中执行；完成后新增测试记录验证无 ID 冲突。Production 不得为“试试看”直接调整 sequence。

## Secret 管理

### 必须作为 Secret 的内容

- `DATABASE_URL`
- Supabase 数据库密码、Service Role Key、JWT Secret
- 第三方付费数据源 Token/API Key
- Render Deploy Hook、GitHub Token
- 备份加密密钥和任何可写凭据

### 可以公开的配置

- `APP_ENV`
- `NODE_ENV`
- `DEBUG_PANEL_DEFAULT`
- `LOG_LEVEL`
- 连接池数值和 Health Check 路径

公开配置仍不得包含域名中的账号、密码或 Token 参数。

### 禁止提交 Git

- `.env`、`.env.*`（示例文件除外）
- 数据库文件和备份
- Render/Supabase 导出的 Secret
- 日志、Network HAR、截图中携带的凭据
- 临时 URL 文本文件和命令输出

### 密码轮换流程

1. 确认需要轮换的 Secret、使用者和两个环境的边界。
2. 在目标平台生成新凭据，不覆盖另一环境。
3. 先在 Staging 更新 Secret、重新部署并验证。
4. 在 Production 维护窗口更新 Secret 并部署。
5. 验证 Health、查询、写入、刷新和重启持久性。
6. 撤销旧凭据，确认旧凭据不能连接。
7. 检查 Git、日志、任务和聊天记录是否曾暴露；必要时扩大轮换范围。
8. 记录轮换日期和下一次复查时间，但不记录 Secret 值。

## Staging 运维

- 跟踪 `staging` 分支并使用独立数据库。
- 页面必须显示 `STAGING`，Health 返回 `staging`。
- 测试写入只使用可删除的测试数据。
- 可临时提高日志级别和启用 `?debug=1`。
- 兼容测试页面或工具至少保留到相关多设备验收完成。
- 定期检查 Staging 配置是否与 Production 架构一致但密钥不同。

### Staging Seed 运维

Seed 只用于独立 Staging 数据库，不自动随部署执行。运行前核对 Staging URL、Health 环境和数据库基线，并在当前 shell 显式设置：

```powershell
$env:APP_ENV='staging'
$env:STAGING_SEED_CONFIRM='staging'
npm run seed:staging
```

连接信息仍通过受控的 `DATABASE_URL` 提供，不写入命令、日志或文档。脚本在加载数据库模块前验证环境与确认值；Production 会立即退出。

清理只删除来源为 `STAGING SEED` 的专用记录：

```powershell
$env:APP_ENV='staging'
$env:STAGING_SEED_CONFIRM='staging'
npm run seed:staging:clean
```

Seed/cleanup 都不会清空数据库。执行后验证记录数、测试名称和 Production 基线。

## Production 运维

- 只跟踪 `main`，只接受已在 Staging 验收的 commit。
- 页面不显示测试标识，默认关闭调试面板。
- 不在 Production 进行探索性数据修改或兼容实验。
- 批量写入、迁移和恢复必须有备份、批准与回滚方案。
- 发布后立即完成 Health 和关键业务冒烟验证。
- 发布前后记录正式指标/事件数量，任何非预期变化立即停止并调查。

## 上线检查

- [ ] Staging commit、环境、数据库和页面标识正确
- [ ] Staging 验收记录完整
- [ ] Secret 扫描通过
- [ ] Production 备份和回滚点确认
- [ ] `main` 只包含已验收变更
- [ ] Render Production 部署 commit 正确
- [ ] `/api/health` 返回 production/connected
- [ ] Health Commit 与 main 发布 commit 一致
- [ ] 页面、指标、事件、刷新和维护功能正常
- [ ] 日志无新增高优先级错误
- [ ] Production 数据条数与发布前基线一致

## 事故记录

生产事故使用 [任务模板](tasks/TEMPLATE.md) 建档，并记录时间线、影响、证据、修复、回滚和后续行动。形成长期技术决策时新增 ADR。
