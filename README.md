# 市场数据工作台

网页运行时使用 Supabase PostgreSQL，所有查询、编辑和刷新结果都持久保存到云端数据库。`data/market.db` 仅作为迁移前的本地备份，不再参与应用运行。

## 本地启动

需要 Node.js 22.5+。安装依赖后，从 `.env.example` 创建 `.env` 并填写 Supabase Session pooler 的连接地址：

```env
DATABASE_URL=postgresql://...
```

真实连接地址只能保存在 `.env` 或部署平台的 Secret/Environment Variables 中，不得提交到 Git。

启动服务：

```powershell
pnpm install
pnpm start
```

然后访问 `http://localhost:4173`。部署平台通常会自动提供 `PORT`。

## 数据库初始化与迁移

- `sql/001_initial_schema.sql`：Supabase PostgreSQL 表、约束和索引。
- `scripts/migrate-sqlite-to-postgres.js`：一次性 SQLite → PostgreSQL 迁移工具。
- `data/market.db`：只读备份，不再是运行时数据源。

应用启动时只检查 PostgreSQL 连接，不会自动建表、写入示例数据或覆盖现有数据。数据库初始化和一次性迁移需要显式执行。

## 功能

- 市场总览：代表性指标、涨跌方向、宏观日历
- 详细数据：九大品类、搜索和品类筛选
- 数据维护：编辑或新增手工指标、新增宏观事件
- 利率/利差按 bp 展示，其余资产按百分比展示
- 每个指标保留来源、数据日期、更新频率和手工标识

## 自动数据源

- 美国国债 2Y/10Y/30Y：U.S. Treasury 官方 XML
- 中国国债 10Y/30Y：ChinaBond（中央结算公司）官方日度曲线
- SOFR、RRP、SPX、NASDAQ 100、VIX、WTI、USDCNY、USDJPY、EURUSD：FRED 公共 CSV
- 服务启动时自动更新，也可以点击页面右上角“刷新”
- 所有没有稳定公开接口的指标（包括 IRS、信用利差、中国利率和国债期货等）统一在网页中手工维护
