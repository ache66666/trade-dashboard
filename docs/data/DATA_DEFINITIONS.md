# Data Definition and Validation Rules

## 字段口径

| 字段 | 定义 |
| --- | --- |
| `indicator_code` | 稳定内部代码，等于当前 `indicators.symbol` |
| `observation_date` | 来源所属交易日/发布日期，不是抓取日期 |
| `value` | Catalog 指定口径的最新有效值 |
| `previous_value` | 同一来源、同一口径的前一有效观测 |
| `change` | `value - previous_value`；利率/利差展示时转换为 bp |
| `change_pct` | 价格型资产 `(value / previous_value - 1) * 100` |
| `source_timestamp` | 来源声明的时间；只有日期时记录日期和约定时区 |
| `fetched_at` | 服务端 UTC 抓取完成时间 |

## 单位与变化

- `%` 利率：数据库保存百分点值，例如 1.75；变化为 `(value - previous_value) * 100` bp。
- `bp` 利差：数据库保存 bp；变化为直接相减。
- 指数/期货/汇率：保存收盘/参考值；变化使用百分比。
- RRP：当前单位十亿美元；若来源返回百万美元必须在 Adapter 转换。
- Copper：当前定义为伦铜美元/吨；`HG=F` 是 COMEX 美分/磅代理，不得未经换算和标记直接写入。
- FX 报价方向必须固定：USDCNY、USDJPY、EURUSD，禁止自动倒数而不记录。

## 日期、时区与日历

- 中国市场：`Asia/Shanghai`，交易日按交易所/官方日历。
- 美国市场和 Treasury：来源日期为业务日期，抓取时间统一保存 UTC。
- FRED：使用观测日期，不以下载时间作为 `as_of`。
- ECB：参考汇率通常在欧洲工作日发布，不能当作实时纽约收盘价。
- 宏观事件 `event_time` 当前没有时区；接入前必须决定存 UTC 或增加显式时区，否则不能安全全自动。

## 校验规则

1. `value`、`previous_value` 必须是有限数值，拒绝 `NaN`、无穷大和空字符串。
2. 日期不得晚于来源当地“当前日期 + 1 天”，不得早于当前快照而覆盖。
3. 价格、收益率和利差使用按指标配置的合理范围，不设置全市场通用阈值。
4. 异常跳变进入 `validation_failed`，需要第二来源或人工确认。
5. 连续两个有效观测才能计算变化；不足时变化显示暂无数据。
6. 主力期货必须记录选约规则和合约代码，不能只保存连续代码。
7. 周末/节假日无新值是 `market_closed`，官方数据未到是 `not_released`，连接失败是 `fetch_failed`。

## 验证方法

- 每个 Adapter 使用固定样本契约测试。
- 上线前连续 10 个交易日与当前人工/官方页面对账。
- 单位、报价方向、前值选择和发布日期必须逐项断言。
- 首选与备用来源同日偏差超过阈值时不自动切换。
- Dashboard 回归必须确认 32 项数量、symbol 唯一和既有 API 结构不变。
