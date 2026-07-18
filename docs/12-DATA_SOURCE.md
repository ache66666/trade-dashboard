# Data Source Catalog

本文是 Market Workbench 数据源登记入口。结论来自 `sql/001_initial_schema.sql`、`server.js`、`public/app.js`、Editor 表单、测试以及只读检查的本地 SQLite 基线，不以 README 代替实现。

机器可读版本见 [`data/data-source-catalog.csv`](data/data-source-catalog.csv)。来源评估、标准记录与批次计划分别见：

- [Source Evaluation](data/SOURCE_EVALUATION.md)
- [Connector Architecture](data/CONNECTOR_ARCHITECTURE.md)
- [Data Definition and Validation Rules](data/DATA_DEFINITIONS.md)
- [Batch Implementation Plan](data/BATCH_PLAN.md)
- [Open Questions / Manual Data List](data/OPEN_QUESTIONS.md)
- [FRED Connector MVP](data/FRED_CONNECTOR_MVP.md)

## 当前事实

- `indicators` 有 32 个唯一 `symbol`，分为流动性、利率、国债期货、外汇、股票、商品、信用、波动率 8 个数据库分类。
- Market Overview 将数据库分类重组为 Liquidity、Rates、FX、Equity、Commodity、Credit、Volatility 7 个首页板块。
- 当前表只保存最新值和前值，不保存历史序列；`change` 由前端按 `value` 与 `previous_value` 计算。
- 当前服务端刷新覆盖 14 项：FRED 9 项、U.S. Treasury 3 项、ChinaBond 网页解析 2 项。按本目录的可靠性标准，其中 12 项为 A，ChinaBond 2 项为 B。
- `macro_events` 当前为人工维护；官方发布日期可以自动化，但市场一致预期通常需要授权来源。

## 自动化等级

| 等级 | 定义 | 当前数量 |
| --- | --- | ---: |
| A | 稳定官方 API 或可靠程序化接口，可直接自动接入 | 12 |
| B | 可程序化获取，但依赖非官方接口、网页解析、主力合约规则或稳定性一般 | 14 |
| C | 暂时保留手工录入 | 6 |
| D | 当前无可接受来源 | 0 |

宏观事件不计入上述 32 项：发布日期/时间可做到 B 级自动化，`forecast` 仍为 C 级人工维护。

## 完整指标目录

| 分类 | 代码 | 显示名称 | 单位 | 变化 | 当前方式 | 首选来源 / 序列 | 备用来源 | 等级 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Liquidity | `DR007` | DR007 | % | bp | 手工 | ChinaMoney 官方页面，经 AKShare adapter | 授权终端人工 | B | P2 |
| Liquidity | `R001` | R001 | % | bp | 手工 | ChinaMoney 官方页面，经 AKShare adapter | 授权终端人工 | B | P2 |
| Liquidity | `SOFR` | SOFR | % | bp | FRED 自动 | FRED `SOFR` | New York Fed | A | P1 |
| Liquidity | `RRP` | 美联储隔夜逆回购 | 十亿美元 | percent | FRED 自动 | FRED `RRPONTSYD` | New York Fed | A | P1 |
| China Rates | `CN10Y` | 中国国债 10Y | % | bp | ChinaBond 解析 | ChinaBond/CCDC 收益率曲线 | 人工核对 | B | P2 |
| China Rates | `CN30Y` | 中国国债 30Y | % | bp | ChinaBond 解析 | ChinaBond/CCDC 收益率曲线 | 人工核对 | B | P2 |
| China Rates | `IRS1Y` | FR007 IRS 1Y | % | bp | Wind 手工 | 授权 Wind/CFETS 数据 | 人工双录核对 | C | P3 |
| China Rates | `IRS5Y` | FR007 IRS 5Y | % | bp | Wind 手工 | 授权 Wind/CFETS 数据 | 人工双录核对 | C | P3 |
| US Rates | `US2Y` | 美国国债 2Y | % | bp | Treasury 自动 | U.S. Treasury `BC_2YEAR` | FRED `DGS2` | A | P1 |
| US Rates | `US10Y` | 美国国债 10Y | % | bp | Treasury 自动 | U.S. Treasury `BC_10YEAR` | FRED `DGS10` | A | P1 |
| US Rates | `US30Y` | 美国国债 30Y | % | bp | Treasury 自动 | U.S. Treasury `BC_30YEAR` | FRED `DGS30` | A | P1 |
| Bond Futures | `T.CFE` | 10Y 国债期货主力 | — | percent | 手工 | CFFEX 日行情 + 主力规则 | Tushare/AKShare 核对 | B | P2 |
| Bond Futures | `TL.CFE` | 30Y 国债期货主力 | — | percent | 手工 | CFFEX 日行情 + 主力规则 | Tushare/AKShare 核对 | B | P2 |
| Bond Futures | `TF.CFE` | 5Y 国债期货主力 | — | percent | 手工 | CFFEX 日行情 + 主力规则 | Tushare/AKShare 核对 | B | P2 |
| Bond Futures | `TS.CFE` | 2Y 国债期货主力 | — | percent | 手工 | CFFEX 日行情 + 主力规则 | Tushare/AKShare 核对 | B | P2 |
| FX | `DXY` | 美元指数 | — | percent | 手工 | yfinance `DX-Y.NYB`（个人用途核验后） | 人工授权行情 | B | P2 |
| FX | `USDCNY` | 美元/人民币 | — | percent | FRED 自动 | FRED `DEXCHUS` | Alpha Vantage `FX_DAILY` | A | P1 |
| FX | `USDJPY` | 美元/日元 | — | percent | FRED 自动 | FRED `DEXJPUS` | Alpha Vantage `FX_DAILY` | A | P1 |
| FX | `EURUSD` | 欧元/美元 | — | percent | FRED 自动 | FRED `DEXUSEU` | ECB SDMX（交叉汇率） | A | P1 |
| Equity | `CSI300` | 沪深 300 | — | percent | Wind 截图 | Fuyao AI Cubes 指数行情 | Tushare/AKShare | B | P2 |
| Equity | `HSTECH` | 恒生科技 | — | percent | 手工 | yfinance `^HSTECH`（个人用途核验后） | 授权港股数据 | B | P2 |
| Equity | `SPX` | 标普 500 | — | percent | FRED 自动 | FRED `SP500` | Alpha Vantage / yfinance 核对 | A | P1 |
| Equity | `NDX` | 纳斯达克 100 | — | percent | FRED 自动 | FRED `NASDAQ100` | Nasdaq Data Link（授权数据集） | A | P1 |
| Commodity | `GOLD` | 黄金 | 美元/盎司 | percent | 手工 | Alpha Vantage `GOLD_SILVER_SPOT:GOLD` | yfinance `GC=F`（期货口径） | B | P2 |
| Commodity | `WTI` | WTI 原油 | 美元/桶 | percent | FRED 自动 | FRED `DCOILWTICO` | Alpha Vantage `WTI` | A | P1 |
| Commodity | `COPPER` | 伦铜 | 美元/吨 | percent | 手工 | yfinance `HG=F` 仅作代理，需口径换算 | 授权 LME 行情 | B | P2 |
| Commodity | `SILVER` | 白银 | 美元/盎司 | percent | 手工 | Alpha Vantage `GOLD_SILVER_SPOT:SILVER` | yfinance `SI=F`（期货口径） | B | P2 |
| Credit | `AAA3Y` | AAA 3Y 信用利差 | bp | bp | Wind 手工 | 授权中债曲线并按固定基准计算 | 人工双录核对 | C | P3 |
| Credit | `AA+3Y` | AA+ 3Y 信用利差 | bp | bp | Wind 手工 | 授权中债曲线并按固定基准计算 | 人工双录核对 | C | P3 |
| Credit | `AA3Y` | AA 3Y 信用利差 | bp | bp | Wind 手工 | 授权中债曲线并按固定基准计算 | 人工双录核对 | C | P3 |
| Volatility | `VIX` | VIX | — | percent | FRED 自动 | FRED `VIXCLS` | Cboe 授权数据 | A | P1 |
| Volatility | `MOVE` | MOVE | — | percent | 手工 | 授权 ICE BofA/MOVE 数据 | 人工核对 | C | P3 |

## 宏观事件目录

| 事件 | 日程首选来源 | 实际值首选来源 | 预期值 | 自动化建议 |
| --- | --- | --- | --- | --- |
| 中国 CPI | 国家统计局发布日历 | 国家统计局 | 人工/授权数据 | B：日程和实际值可抓取，预期人工 |
| 中国 PMI | 国家统计局/CFLP | 国家统计局/CFLP | 人工/授权数据 | B：口径与发布时间需固定 |
| 美国非农 | BLS Release Calendar | BLS Public Data API | 人工/授权数据 | A/B：实际值 A，事件记录 B |
| FOMC | Federal Reserve FOMC Calendar | Federal Reserve statement | 人工判断 | B：日程可自动，政策结果结构化需人工复核 |

## 当前数据库字段映射

所有指标当前都写入同一组字段：`symbol`、`name`、`category`、`value`、`previous_value`、`value_unit`、`change_type`、`source`、`as_of`、`frequency`、`is_manual`、`is_featured`、`sort_order`、`updated_at`。Catalog 中的 `indicator_code` 对应 `symbol`，标准记录的 `observation_date` 对应 `as_of`。

当前 Schema 无法安全保存历史序列、来源切换历史和抓取状态。本阶段不改 Schema；Batch 1 可以继续更新快照表，但进入历史回放前必须新增独立历史表，不能把多日数据塞进 `indicators`。
