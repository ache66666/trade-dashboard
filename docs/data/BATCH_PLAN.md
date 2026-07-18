# Batch Implementation Plan

## Batch 1：官方全球日频快照

**指标（12）**：SOFR、RRP、US2Y、US10Y、US30Y、USDCNY、USDJPY、EURUSD、SPX、NDX、WTI、VIX。

- 来源：FRED、U.S. Treasury；ECB 仅作 EURUSD 交叉验证。
- 技术：Node 原生 HTTP/CSV/XML；不需要 Python。
- 数据库：第一步不改 Schema，统一 Repository 更新现有快照；历史表另开 PR。
- API：保持现有返回结构。
- 测试：Adapter 样本、日期/单位、前值、旧值保护、32/3 回归。
- 风险：FRED 发布延迟、假日错位、CSV/XML 格式变化。
- 自动化覆盖：12/32，37.5%。这是最推荐的第一个实施 Batch。

## Batch 2：中国官方与结构化候选

**指标（8）**：DR007、R001、CN10Y、CN30Y、T.CFE、TL.CFE、TF.CFE、TS.CFE。

- 来源：ChinaMoney/ChinaBond/CFFEX；AKShare 只作 adapter 或交叉验证。
- 技术：可能需要 Python sidecar，但优先验证直接 HTTP；不在确认前引入 Python。
- 数据库：主力期货需要保存真实合约代码时可能需要元数据/历史表。
- 测试：网页契约样本、交易日、主力切换、官方页面人工抽检。
- 风险：无稳定公开 API、页面变化、主力连续定义、交易所许可。
- 累计自动化上限：20/32，62.5%，但均属 B 级。

## Batch 3：补齐公开市场代理

**指标（6）**：DXY、CSI300、HSTECH、GOLD、COPPER、SILVER。

- 来源：Fuyao AI Cubes、Alpha Vantage、yfinance 备用。
- 技术：Fuyao/Alpha Vantage 可直接 Node REST；yfinance 需要 Python。
- 数据库：若使用期货代理，必须记录代理标的和换算，建议先有历史/来源表。
- 测试：双来源对账、许可确认、限频、单位换算、延迟标记。
- 风险：Yahoo 个人用途限制、免费额度、现货与期货口径不一致。
- 累计程序化覆盖上限：26/32，81.25%，上线前需逐项许可确认。

## Batch 4：受限数据与宏观事件

**指标（6）**：IRS1Y、IRS5Y、AAA3Y、AA+3Y、AA3Y、MOVE；另含 Macro Events。

- 来源：授权终端/官方日历/BLS/Fed/NBS。
- 技术：市场预期与商业指数继续人工；实际发布值可单独自动。
- 数据库：Macro Events 在自动化前需要明确时区和事件幂等键。
- 测试：口径审批、人工双录、发布修订、事件时区。
- 风险：许可、定义不统一、修订值、共识预期无免费权威来源。
- 自动化：不设强制目标，宁可保持 C 级。

## 每个 Batch 的完成门槛

1. 来源许可、单位和延迟书面确认。
2. 至少 10 个交易日并行对账。
3. 失败不覆盖最后有效值。
4. 无 Secret 进入前端、日志或 Git。
5. Staging 验收后再决定 Production 发布；数据库 Migration 单独审批。
