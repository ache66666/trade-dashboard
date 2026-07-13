# 数据字典

本文记录稳定的数据定义和指标元数据，不记录会随市场变化的最新值。指标新增、重命名、换源或改变更新方式时必须同步更新。逐项来源与维护策略见 [数据源目录](12-DATA_SOURCE.md)。

## `indicators` 表

| 字段 | 中文含义 | 类型 | 约束/口径 |
| --- | --- | --- | --- |
| `id` | 指标 ID | bigint | 主键，identity |
| `symbol` | 指标代码 | text | 必填、唯一 |
| `name` | 指标名称 | text | 必填 |
| `category` | 分类 | text | 必填；当前为流动性、利率、国债期货、外汇、股票、商品、波动率、信用 |
| `value` | 最新值 | double precision | 必填，不得伪造 |
| `previous_value` | 前值 | double precision | 必填，用于计算变化 |
| `value_unit` | 数值单位 | text | 如 `%`、`bp`、美元/桶；可为空字符串 |
| `change_type` | 变化口径 | text | `bp` 或 `percent` |
| `source` | 数据来源 | text | 必填；待录入指标明确标记“待手工录入” |
| `as_of` | 数据日期 | date | 必填，表示业务数据所属日期 |
| `frequency` | 更新频率 | text | 如 `Daily`、`Daily Close`、`Manual` |
| `is_manual` | 手工维护 | boolean | `true` 表示可由人工维护 |
| `is_featured` | 首页代表指标 | boolean | 控制代表性标识；首页实际组合仍由产品配置决定 |
| `sort_order` | 排序 | integer | 同分类内的显示顺序 |
| `updated_at` | 记录更新时间 | timestamptz | 数据库记录最后更新时间 |

变化口径：利率、收益率和利差通常按 bp；价格型资产按百分比。颜色仅代表数值方向。

## 当前指标（32 项）

| 代码 | 名称（中文） | 分类 | 来源 | 更新方式 | 更新时间/频率 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `DR007` | DR007 | 流动性 | 待手工录入 | 手工 | Manual | 首页代表指标 |
| `R001` | R001 | 流动性 | 待手工录入 | 手工 | Manual | — |
| `SOFR` | SOFR | 流动性 | FRED · SOFR | 自动 | Daily | 首页代表指标 |
| `RRP` | 美联储隔夜逆回购 | 流动性 | FRED · RRPONTSYD | 自动 | Daily | 单位：十亿美元 |
| `CN10Y` | 中国国债 10Y | 利率 | ChinaBond · CCDC | 自动 | Daily Close | 首页代表指标，变化单位 bp |
| `CN30Y` | 中国国债 30Y | 利率 | ChinaBond · CCDC | 自动 | Daily Close | 变化单位 bp |
| `IRS1Y` | FR007 IRS 1Y | 利率 | Wind 手工 | 手工 | Daily Close | 变化单位 bp |
| `IRS5Y` | FR007 IRS 5Y | 利率 | Wind 手工 | 手工 | Daily Close | 首页代表指标，变化单位 bp |
| `US2Y` | 美国国债 2Y | 利率 | U.S. Treasury | 自动 | Daily Close | 首页代表指标，变化单位 bp |
| `US10Y` | 美国国债 10Y | 利率 | U.S. Treasury | 自动 | Daily Close | 首页代表指标，变化单位 bp |
| `US30Y` | 美国国债 30Y | 利率 | U.S. Treasury | 自动 | Daily Close | 变化单位 bp |
| `T.CFE` | 10Y 国债期货主力 | 国债期货 | 待手工录入 | 手工 | Manual | 首页代表指标 |
| `TL.CFE` | 30Y 国债期货主力 | 国债期货 | 待手工录入 | 手工 | Manual | — |
| `TF.CFE` | 5Y 国债期货主力 | 国债期货 | 待手工录入 | 手工 | Manual | — |
| `TS.CFE` | 2Y 国债期货主力 | 国债期货 | 待手工录入 | 手工 | Manual | — |
| `DXY` | 美元指数 | 外汇 | 待手工录入 | 手工 | Manual | 首页代表指标 |
| `USDCNY` | 美元/人民币 | 外汇 | FRED · DEXCHUS | 自动 | Daily | 首页代表指标 |
| `USDJPY` | 美元/日元 | 外汇 | FRED · DEXJPUS | 自动 | Daily | — |
| `EURUSD` | 欧元/美元 | 外汇 | FRED · DEXUSEU | 自动 | Daily | — |
| `CSI300` | 沪深 300 | 股票 | Wind 截图 | 手工 | Daily Close | 首页代表指标 |
| `HSTECH` | 恒生科技 | 股票 | 待手工录入 | 手工 | Manual | 首页代表指标 |
| `SPX` | 标普 500 | 股票 | FRED · SP500 | 自动 | Daily | 首页代表指标 |
| `NDX` | 纳斯达克 100 | 股票 | FRED · NASDAQ100 | 自动 | Daily | — |
| `GOLD` | 黄金 | 商品 | 待手工录入 | 手工 | Manual | 首页代表指标，美元/盎司 |
| `WTI` | WTI 原油 | 商品 | FRED · DCOILWTICO | 自动 | Daily | 首页代表指标，美元/桶 |
| `COPPER` | 伦铜 | 商品 | 待手工录入 | 手工 | Manual | 首页代表指标，美元/吨 |
| `SILVER` | 白银 | 商品 | 待手工录入 | 手工 | Manual | 美元/盎司 |
| `AAA3Y` | AAA 3Y 信用利差 | 信用 | Wind 手工 | 手工 | Daily Close | 首页代表指标，单位 bp |
| `AA+3Y` | AA+ 3Y 信用利差 | 信用 | Wind 手工 | 手工 | Daily Close | 单位 bp |
| `AA3Y` | AA 3Y 信用利差 | 信用 | Wind 手工 | 手工 | Daily Close | 单位 bp |
| `VIX` | VIX | 波动率 | FRED · VIXCLS | 自动 | Daily | 首页代表指标 |
| `MOVE` | MOVE | 波动率 | 待手工录入 | 手工 | Manual | 首页代表指标 |

## `macro_events` 表

| 字段 | 中文含义 | 类型 | 约束/口径 |
| --- | --- | --- | --- |
| `id` | 事件 ID | bigint | 主键，identity |
| `event_time` | 事件时间 | timestamp | 必填，不含时区；展示前需明确业务时区 |
| `region` | 地区 | text | 必填 |
| `name` | 事件名称 | text | 必填 |
| `importance` | 重要性 | integer | 1–5 |
| `previous` | 前值 | text | 可空，保留原始发布格式 |
| `forecast` | 预期值 | text | 可空 |
| `actual` | 实际值 | text | 可空 |
| `source` | 来源 | text | 必填 |
| `is_manual` | 手工维护 | boolean | 默认 `true` |
| `updated_at` | 记录更新时间 | timestamptz | 默认当前时间 |

## 新指标登记模板

| 名称 | 中文 | 分类 | 来源 | 更新方式 | 更新时间/频率 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `SYMBOL` | 指标中文名 | 分类 | 权威来源 | 自动/手工 | Daily/Manual | 单位、口径、使用限制 |

新增前需确认：代码唯一、来源许可、变化口径、缺失值策略、Production/Staging 数据准备和首页是否展示。
